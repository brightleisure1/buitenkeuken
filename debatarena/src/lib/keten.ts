import "server-only";
import { attachmentImages, attachmentText, runAttachments } from "./attachments";
import { overBudget } from "./budget";
import { FAST_MODEL_KEY, MODELS, PROVIDERS, getModel, resolveModel, type ModelConfig } from "./config";
import { friendly } from "./errors";
import { generateJson } from "./llm";
import { niveauOf, turnModel } from "./niveau";
import { getRun, updateRun } from "./runs";
import {
  BeoordelingSchema,
  ConceptSchema,
  ControleSchema,
  HerschrijfSchema,
  RedactieSchema,
  ReviewSchema,
  SamenvoegSchema,
  SlotcheckSchema,
} from "./schemas";
import { availableKeys } from "./settings";
import { recordUsage } from "./usage-db";
import type { AdviesDoc, Concept, JuryResult, Keten, KetenRonde, Oordeel, Review, Role, Run } from "./types";

/**
 * De review-keten: één adviesdocument dat in rondes beter wordt.
 * 1. Verbreden: twee of drie modellen schrijven onafhankelijk een eerste versie.
 * 2. Samenvoegen tot versie 1, met per inzicht de herkomst.
 * 3. Rondes: reviews vanuit de rollen (waaronder een bouwende rol die kansen zoekt) en een tegenlezer van een ander model;
 *    eerst apart beoordelen, dan alleen het overgenomene verwerken.
 * 4. Slotcheck door de voorzitter.
 * 5. Eindredactie: leesbaar, besluit bovenaan, en elk label klopt met de tekst (met een onafhankelijke controle erna).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PREP_WAIT_MS = 120_000;
export const MAX_RONDES = 3;
const LABELS = ["A", "B", "C"];

const NL = `Het gaat om Nederlandse bedrijven: denk in euro's, de Nederlandse markt, wet- en regelgeving (cao's, AVG, Belastingdienst) en Nederlandse omgangsvormen.`;

const DOC_REGELS = `- besluit: het besluit dat je adviseert, in één zin.
- samenvatting: 3 tot 5 zinnen: wat de baas moet doen, waarom, en onder welke voorwaarde.
- opties: 2 tot 4 serieuze opties met voor en tegen (ook "niets doen" als dat reëel is).
- analyse: de onderbouwing in gewone alinea's, max 600 woorden. Concreet: bedragen, percentages, termijnen.
- aannames: 3 tot 6 dingen waar het advies op leunt, met risico als het niet klopt en hoe je het goedkoop en snel test.
- stappen: 3 tot 6 stappen, elk met waarom, een eerste actie die morgen kan beginnen, een eigenaar (functie) en een termijn.
- Verzin geen cijfers of bronnen; noem een schatting een schatting.
- Gewone taal, geen jargon, geen opsommingstekens in de analyse.`;

export function docText(d: AdviesDoc): string {
  return [
    `BESLUIT: ${d.besluit}`,
    `SAMENVATTING: ${d.samenvatting}`,
    `OPTIES:\n${d.opties.map((o) => `- ${o.optie} | voor: ${o.voor} | tegen: ${o.tegen}`).join("\n")}`,
    `ANALYSE:\n${d.analyse}`,
    `AANNAMES:\n${d.aannames.map((a) => `- ${a.aanname} | risico: ${a.risico} | test: ${a.hoeTesten}`).join("\n")}`,
    `STAPPEN:\n${d.stappen.map((s, i) => `${i + 1}. ${s.stap} — ${s.waarom} (eerste actie: ${s.eersteActie}; eigenaar: ${s.eigenaar}; termijn: ${s.termijn})`).join("\n")}`,
  ].join("\n\n");
}

/** De keten veilig bijwerken: altijd op de nieuwste versie uit de database. */
export async function patchKeten(id: string, fn: (k: Keten) => Keten | void): Promise<Keten> {
  const run = await getRun(id);
  const cur: Keten = structuredClone(run.keten ?? leeg());
  const next = fn(cur) ?? cur;
  await updateRun(id, { keten: next });
  return next;
}

function leeg(): Keten {
  return { status: "bezig", stap: "Voorbereiden…", auteur: { ai: "", model: "" }, kruis: null, rondes: [], baas: { opmerkingen: [], overrides: {} } };
}

/** Wie schrijft (het slimste Claude-model), wie leest tegen, en wie schrijven de onafhankelijke eerste versies. */
export async function kiesModellen(): Promise<{ auteur: ModelConfig; kruis: ModelConfig | null; concepten: ModelConfig[]; snel: ModelConfig }> {
  const keys = await availableKeys();
  const strong = (p: string) => MODELS.find((m) => m.provider === p && m.tier === "sterk" && keys[m.provider]);
  const auteur = strong("anthropic") ?? strong("openai") ?? strong("google") ?? MODELS.find((m) => keys[m.provider]);
  if (!auteur) throw friendly(new Error("geen sleutel"));
  const kruis = ["openai", "google", "anthropic", "xai"].filter((p) => p !== auteur.provider).map(strong).find(Boolean) ?? null;
  // Claude eerst (die wordt ook de losse vraag in de vergelijking), dan GPT, dan Gemini.
  const concepten = [auteur, ...["openai", "google"].filter((p) => p !== auteur.provider).map(strong)].filter((m): m is ModelConfig => !!m).slice(0, 3);
  const snel = getModel(FAST_MODEL_KEY[auteur.provider]) ?? auteur;
  return { auteur, kruis, concepten, snel };
}

const ai = (m: ModelConfig) => `${PROVIDERS[m.provider].naam}`;

function context(run: Run, att: string) {
  const intake = (run.cast.intake ?? []).filter((x) => x.antwoord.trim());
  const rv = (run.cast.randvoorwaarden ?? []).filter((x) => x.trim());
  const facts = run.cast.rollen
    .flatMap((r) => (run.prep[r.id]?.facts ?? []).map((f) => `- ${f.feit} (bron: ${f.bron}; opgezocht door ${r.functie})`))
    .join("\n");
  return `HET VRAAGSTUK VAN DE BAAS:
${run.question}
${intake.length ? `\nAANVULLING VAN DE BAAS:\n${intake.map((x) => `- ${x.vraag} → ${x.antwoord}`).join("\n")}\n` : ""}${rv.length ? `\nVASTE RANDVOORWAARDEN (staan vast, niet ter discussie):\n${rv.map((x) => `- ${x}`).join("\n")}\n` : ""}${facts ? `\nOPGEZOCHTE FEITEN:\n${facts}\n` : ""}${att ? `\nBIJLAGES:\n${att}\n` : ""}`;
}

async function wachtOpHuiswerk(id: string) {
  const start = Date.now();
  for (;;) {
    const run = await getRun(id);
    const klaar = run.cast.rollen.every((r) => r.isJury || ["klaar", "mislukt"].includes(run.prep[r.id]?.homeworkStatus ?? ""));
    if (klaar || Date.now() - start > PREP_WAIT_MS) return run;
    await sleep(2000);
  }
}

async function stap(id: string, tekst: string, fase: NonNullable<Keten["fase"]>) {
  await patchKeten(id, (k) => {
    k.stap = tekst;
    k.fase = fase;
    k.sinds = Date.now();
    k.status = "bezig";
    k.fout = undefined;
  });
}

// Eén keten per run tegelijk (de app draait als één server).
const running = new Set<string>();

export async function runKeten(id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    await stap(id, "De rollen doen hun huiswerk…", "huiswerk");
    let run = await wachtOpHuiswerk(id);
    const modellen = await kiesModellen();
    const { auteur, kruis } = modellen;
    const attachments = await runAttachments(id);
    const images = await attachmentImages(attachments);
    const ctx = context(run, attachmentText(attachments));
    const systeem = `Je bent een ervaren, nuchtere adviseur voor Nederlandse bedrijven. Je adviseert de baas, die zelf besluit. ${NL} Denk grondig na en wees concreet.`;

    await patchKeten(id, (k) => {
      k.auteur = { ai: ai(auteur), model: auteur.model };
      k.kruis = kruis ? { ai: ai(kruis), model: kruis.model } : null;
      k.maxRondes ??= Math.min(MAX_RONDES, Math.max(1, run.cast.rondes || 2));
    });

    // 1. Verbreden: onafhankelijke eerste versies, parallel
    run = await getRun(id);
    if (!run.keten?.concepten?.length && !run.keten?.rondes.length) {
      await stap(id, `${modellen.concepten.map(ai).join(", ")} schrijven elk onafhankelijk een eerste versie…`, "verbreden");
      const concepten = await verbreden(run, modellen.concepten, systeem, ctx, images);
      await patchKeten(id, (k) => {
        k.concepten = concepten.map((c) => c.concept);
        k.kostenVersie1 = concepten[0]?.eur ?? 0;
      });
    }

    // 2. Samenvoegen tot versie 1
    run = await getRun(id);
    if (!run.keten!.rondes.length) {
      const cs = run.keten!.concepten ?? [];
      if (cs.length > 1) {
        await stap(id, `${ai(auteur)} voegt de ${cs.length} versies samen tot versie 1…`, "samenvoegen");
        const s = await samenvoegen(run, cs, auteur, systeem, ctx);
        await patchKeten(id, (k) => {
          k.rondes = [{ nr: 1, doc: s.document, reviews: [], oordelen: [], wijzigingen: [] }];
          k.herkomst = s.herkomst;
        });
      } else {
        await patchKeten(id, (k) => {
          k.rondes = [{ nr: 1, doc: cs[0].doc, reviews: [], oordelen: [], wijzigingen: [] }];
          k.herkomst = cs[0].inzichten.map((x) => ({ inzicht: x.tekst, bron: [cs[0].label], status: "opgenomen" as const, reden: "Enige eerste versie" }));
        });
      }
    }

    // 3. Rondes van review, beoordeling en herschrijven
    for (;;) {
      run = await getRun(id);
      const keten = run.keten!;
      const ronde = keten.rondes.at(-1)!;
      if (ronde.nr > (keten.maxRondes ?? 2)) break;
      if (overBudget(run)) {
        await patchKeten(id, (k) => {
          k.budgetOp = true;
        });
        break;
      }
      let r = ronde;
      if (!r.reviews.length) {
        await stap(id, `Ronde ${r.nr}: de rollen, de bouwer en de tegenlezer lezen versie ${r.nr}…`, "review");
        const reviews = await reviewRonde(run, r, kruis, ctx);
        const k2 = await patchKeten(id, (k) => {
          k.rondes.at(-1)!.reviews = reviews;
        });
        r = k2.rondes.at(-1)!;
      }
      const wezenlijk = r.reviews.flatMap((x) => x.punten).filter((p) => p.zwaarte !== "laag");
      const baasOpen = keten.baas.opmerkingen.some((o) => !o.verwerkt) || Object.keys(keten.baas.overrides).length > 0;
      if (!wezenlijk.length && !baasOpen) break;
      run = await getRun(id);
      if (overBudget(run)) {
        await patchKeten(id, (k) => {
          k.budgetOp = true;
        });
        break;
      }
      await stap(id, `Ronde ${r.nr}: ${ai(auteur)} beoordeelt elk punt…`, "herschrijven");
      const oordelen = r.oordelen.length ? r.oordelen : await beoordelen(run, run.keten!, r, auteur, systeem, ctx);
      await patchKeten(id, (k) => {
        k.rondes.at(-1)!.oordelen = oordelen;
      });
      await stap(id, `Ronde ${r.nr}: ${ai(auteur)} verwerkt de overgenomen punten in versie ${r.nr + 1}…`, "herschrijven");
      run = await getRun(id);
      const h = await herschrijven(run, run.keten!, { ...r, oordelen }, auteur, systeem, ctx, images);
      await patchKeten(id, (k) => {
        const cur = k.rondes.at(-1)!;
        cur.changelog = h.changelog;
        cur.wijzigingen = h.changelog.map((c) => c.wijziging);
        k.baas.opmerkingen = k.baas.opmerkingen.map((o) => ({ ...o, verwerkt: true }));
        k.baas.overrides = {};
        k.rondes.push({ nr: cur.nr + 1, doc: h.document, reviews: [], oordelen: [], wijzigingen: [] });
      });
    }

    // 4. Slotcheck
    run = await getRun(id);
    const laatste = run.keten!.rondes.at(-1)!.doc;
    await stap(id, "De voorzitter doet de slotcheck…", "slotcheck");
    const slot = await slotcheck(run, run.keten!, laatste, ctx);
    await patchKeten(id, (k) => {
      k.slot = slot ?? undefined;
    });

    // 5. Eindredactie en controle
    await stap(id, "De eindredacteur maakt het leesbaar en controleert elk label tegen de tekst…", "redactie");
    run = await getRun(id);
    const eind = await eindredactie(run, run.keten!, laatste, auteur, modellen.snel, systeem, ctx);
    await patchKeten(id, (k) => {
      k.eind = eind.doc;
      k.redactie = eind.redactie;
      // Labels die de controle niet in de tekst terugvond, zijn teruggezet: nooit iets claimen wat er niet staat.
      for (const r of k.rondes) {
        r.oordelen = r.oordelen.map((o) => (eind.teruggezet.has(o.id) ? { ...o, oordeel: "niet", gecorrigeerd: true, reden: `${o.reden} (Niet teruggevonden in de eindtekst; label teruggezet.)` } : o));
      }
      k.herkomst = (k.herkomst ?? []).map((h, i) => (eind.teruggezet.has(`h${i}`) ? { ...h, status: "weggelaten", gecorrigeerd: true, reden: `${h.reden} (Niet teruggevonden in de eindtekst.)` } : h));
      k.status = "klaar";
      k.stap = "Klaar";
      k.fase = "klaar";
    });
    run = await getRun(id);
    await updateRun(id, { status: "done", result: naarResult(run) });
  } catch (e) {
    const err = friendly(e);
    await patchKeten(id, (k) => {
      k.status = "fout";
      k.fout = { error: err.message, oplossing: err.oplossing };
      k.stap = "Vastgelopen";
    }).catch(() => {});
  } finally {
    running.delete(id);
  }
}

// ---------- 1. Verbreden ----------

async function verbreden(run: Run, modellen: ModelConfig[], systeem: string, ctx: string, images: Awaited<ReturnType<typeof attachmentImages>>) {
  const res = await Promise.all(
    modellen.map(async (m, i) => {
      const r = await generateJson(
        ConceptSchema,
        { model: m, system: systeem, images, instruction: `${ctx}\nSchrijf je eigen adviesdocument. Regels:\n${DOC_REGELS}\n- inzichten: de 5 tot 8 belangrijkste inzichten in jouw advies, elk in één zin.`, maxTokens: 8000, effort: "medium" },
        1,
      ).catch(() => null);
      if (!r) return null;
      const eur = await recordUsage(run.id, "concept", r.usage);
      const label = LABELS[i];
      const concept: Concept = {
        label,
        ai: ai(m),
        model: m.model,
        doc: r.data.document,
        inzichten: r.data.inzichten.slice(0, 8).map((t, j) => ({ id: `${label}${j + 1}`, tekst: t })),
      };
      return { concept, eur };
    }),
  );
  const ok = res.filter((x): x is { concept: Concept; eur: number } => !!x);
  if (!ok.length) throw friendly(new Error("Geen enkele eerste versie lukte"));
  // Labels opnieuw A, B, C op volgorde van wat gelukt is.
  return ok.map((x, i) => ({ ...x, concept: { ...x.concept, label: LABELS[i], inzichten: x.concept.inzichten.map((z, j) => ({ ...z, id: `${LABELS[i]}${j + 1}` })) } }));
}

// ---------- 2. Samenvoegen ----------

async function samenvoegen(run: Run, cs: Concept[], auteur: ModelConfig, systeem: string, ctx: string) {
  const versies = cs.map((c) => `=== VERSIE ${c.label} ===\n${docText(c.doc)}\n\nKERNINZICHTEN ${c.label}:\n${c.inzichten.map((x) => `- ${x.tekst}`).join("\n")}`).join("\n\n");
  const r = await generateJson(
    SamenvoegSchema,
    {
      model: auteur,
      system: systeem,
      instruction: `${ctx}\nDrie adviseurs schreven onafhankelijk van elkaar een advies. Voeg ze samen tot één beter advies (versie 1).
Neem de sterkste inzichten uit elke versie over, ook als maar één versie ze had. Haal dubbelingen weg. Maak een keuze waar ze elkaar tegenspreken en leg die uit in de analyse. Laat zwakke of onjuiste punten weg.
Geef in 'herkomst' alle wezenlijke inzichten (samengevoegd als ze hetzelfde zeggen), met uit welke versie(s) ze komen en of je ze hebt opgenomen of weggelaten, met reden.

${versies}

Regels voor het document:
${DOC_REGELS}`,
      maxTokens: 10000,
      effort: "medium",
    },
    1,
  );
  await recordUsage(run.id, "samenvoegen", r.usage);
  return r.data;
}

// ---------- 3. Reviews ----------

/** Alle punten die al eerder zijn afgehandeld, zodat reviewers niet in herhaling vallen. */
function eerderePunten(keten: Keten) {
  return keten.rondes
    .slice(0, -1)
    .flatMap((r) => r.reviews.flatMap((rv) => rv.punten.map((p) => ({ p, o: r.oordelen.find((x) => x.id === p.id) }))))
    .map(({ p, o }) => `- ${p.punt} → ${o ? `${o.oordeel}: ${o.reden}` : "niet voorgelegd"}`)
    .join("\n");
}

function personaSysteem(role: Role) {
  return `Je bent ${role.naam}, ${role.functie}. ${NL}
Waar jij op let: ${role.perspectief}
Over jou: ${role.instructie}
Je leest een adviesdocument voor de directie en geeft feedback vanuit jouw rol, belang en praktijkervaring. Kort, concreet en eerlijk.`;
}

async function reviewRonde(run: Run, ronde: KetenRonde, kruis: ModelConfig | null, ctx: string): Promise<Review[]> {
  const keten = run.keten!;
  const eerder = eerderePunten(keten);
  const doc = docText(ronde.doc);
  const niveau = niveauOf(run.cast);
  const personas = run.cast.rollen.filter((r) => !r.isJury);
  const eerderBlok = eerder ? `\nAL EERDER BESPROKEN (niet herhalen):\n${eerder}\n` : "";
  const tasks: Promise<Review | null>[] = personas.map(async (role, i) => {
    const model = turnModel(resolveModel(role.modelKey, role.customModel), niveau);
    const bouwer = !!role.isBouwer;
    const opdracht = bouwer
      ? `Jij verdedigt de ambitieuze variant. Zoek gemiste kansen en upside: waar kan dit groter, slimmer of meer waard worden (bijvoorbeeld schaal, extra overnames, nieuwe markten, betere exit, hogere prijs)? Geen risico's; die brengen anderen al in.
Lever 1 tot 3 NIEUWE inzichten die nog niet in de tekst staan. Controleer dat echt: wat al in het document staat, telt niet. Per inzicht: zwaarte (hoog = verandert de uitkomst wezenlijk), het inzicht, en concreet hoe het in het advies moet (met een eerste stap of voorwaarde, zodat het ook verantwoord blijft).`
      : `Lees dit vanuit jouw rol en jouw belang. Geef maximaal 3 punten die het advies beter maken voor het besluit: wat mis je, wat klopt er vanuit jouw praktijk niet, wat zou jou of jouw mensen tegenhouden, welke voorwaarde stel je. Wees concreet en gebruik je vakkennis. Is het stuk vanuit jouw blik goed genoeg, geef dan 0 of 1 punt. Geen complimenten.`;
    const vraag = (extra = "") =>
      generateJson(
        ReviewSchema,
        { model, system: personaSysteem(role), instruction: `${ctx}\nHIER IS HET ADVIESDOCUMENT (versie ${ronde.nr}):\n\n${doc}\n${eerderBlok}\n${opdracht}${extra}`, maxTokens: 1500 },
        1,
      ).catch(() => null);
    let r = await vraag();
    // De bouwer levert elke ronde minstens één nieuw inzicht.
    if (bouwer && r && !r.data.punten.length) {
      await recordUsage(run.id, "review", r.usage, role.id);
      r = await vraag("\n\nJe leverde geen inzicht. Lever er minstens één: een kans die nog niet in de tekst staat.");
    }
    if (!r) return null;
    await recordUsage(run.id, "review", r.usage, role.id);
    return {
      van: role.id,
      naam: role.naam,
      functie: role.functie,
      soort: bouwer ? ("bouwer" as const) : ("persona" as const),
      ai: PROVIDERS[model.provider].naam,
      punten: r.data.punten.slice(0, 3).map((p, j) => ({
        ...p,
        // Een kans van de bouwer gaat altijd naar de schrijver.
        zwaarte: bouwer && p.zwaarte === "laag" ? ("midden" as const) : p.zwaarte,
        id: `r${ronde.nr}-${bouwer ? "b" : "p"}${i}-${j}`,
      })),
    };
  });
  if (kruis) {
    tasks.push(
      (async () => {
        const r = await generateJson(
          ReviewSchema,
          {
            model: kruis,
            system: `Je bent een scherpe, onafhankelijke tegenlezer. Je beoordeelt het werk van een andere AI voor een directie die er een besluit op neemt. ${NL} Je bent kritisch, maar alleen waar het ertoe doet.`,
            instruction: `${ctx}\nHIER IS HET ADVIESDOCUMENT (versie ${ronde.nr}), geschreven door een andere AI:\n\n${doc}\n${eerderBlok}
Geef maximaal 5 reviewpunten: fouten, zwakke of ontbrekende redeneringen, gemiste opties of risico's, cijfers zonder onderbouwing, interne tegenspraak, en stappen die in de praktijk niet uitvoerbaar zijn. Per punt een concreet voorstel. Geen punten over stijl.`,
            maxTokens: 2500,
            effort: "medium",
          },
          1,
        ).catch(() => null);
        if (!r) return null;
        await recordUsage(run.id, "kruisreview", r.usage);
        return {
          van: "kruis",
          naam: `Tegenlezer`,
          functie: `${PROVIDERS[kruis.provider].naam}, ander model`,
          soort: "kruis" as const,
          ai: PROVIDERS[kruis.provider].naam,
          punten: r.data.punten.slice(0, 5).map((p, j) => ({ ...p, id: `r${ronde.nr}-k-${j}` })),
        };
      })(),
    );
  }
  const reviews = (await Promise.all(tasks)).filter((x): x is Review => !!x);
  if (!reviews.length) throw friendly(new Error("Geen enkele review lukte"));
  return reviews;
}

const wie = (rv: Review) => (rv.soort === "kruis" ? `Tegenlezer (${rv.ai})` : rv.soort === "bouwer" ? `${rv.naam}, bouwende rol` : `${rv.naam}, ${rv.functie}`);

// ---------- 3b. Beoordelen (apart van herschrijven: dat maakt minder volgzaam) ----------

async function beoordelen(run: Run, keten: Keten, ronde: KetenRonde, auteur: ModelConfig, systeem: string, ctx: string): Promise<Oordeel[]> {
  const punten = ronde.reviews.flatMap((rv) => rv.punten.filter((p) => p.zwaarte !== "laag").map((p) => `[${p.id}] (${p.zwaarte}) ${wie(rv)}: ${p.punt} → voorstel: ${p.voorstel}`)).join("\n");
  if (!punten) return [];
  const r = await generateJson(
    BeoordelingSchema,
    {
      model: auteur,
      system: systeem,
      instruction: `${ctx}\nHET HUIDIGE ADVIES (versie ${ronde.nr}):\n\n${docText(ronde.doc)}\n\nREVIEWPUNTEN:\n${punten}\n
Beoordeel elk punt kritisch. Je herschrijft nu nog niets; je beslist alleen.
Neem een punt alleen over ("over") of deels ("deels") als het één van deze dingen doet, en noem dat als criterium:
- fout: herstelt een echte fout of onjuiste aanname;
- besluit: verandert het besluit, de voorwaarden of de volgorde van stappen wezenlijk;
- risico: voegt een risico toe dat het besluit kan laten mislukken;
- kans: voegt een kans toe die het advies wezenlijk meer waard maakt (van de bouwende rol of een ander), mits die verantwoord in te passen is.
Anders: "niet", criterium "geen" (al gedekt, detail, dient alleen één belang, maakt het stuk langer zonder het scherper te maken).
Weeg tegenstrijdige punten tegen elkaar af en kies. Het is normaal dat een flink deel 'niet' of 'deels' krijgt. Geef per id één zin reden.`,
      maxTokens: 4000,
      effort: "medium",
    },
    1,
  );
  await recordUsage(run.id, "beoordelen", r.usage);
  const bekend = new Set(ronde.reviews.flatMap((rv) => rv.punten.map((p) => p.id)));
  return r.data.oordelen.filter((o) => bekend.has(o.id));
}

// ---------- 3c. Herschrijven: alleen wat overgenomen is ----------

async function herschrijven(run: Run, keten: Keten, ronde: KetenRonde, auteur: ModelConfig, systeem: string, ctx: string, images: Awaited<ReturnType<typeof attachmentImages>>) {
  const alle = ronde.reviews.flatMap((rv) => rv.punten.map((p) => ({ rv, p })));
  const overgenomen = ronde.oordelen
    .filter((o) => o.oordeel !== "niet")
    .map((o) => {
      const x = alle.find((a) => a.p.id === o.id);
      return x ? `[${o.id}] ${o.oordeel === "deels" ? "DEELS" : "OVER"} (${o.criterium ?? "?"}) ${wie(x.rv)}: ${x.p.punt} → voorstel: ${x.p.voorstel} | jouw oordeel: ${o.reden}` : null;
    })
    .filter(Boolean);
  const baas = keten.baas.opmerkingen.filter((o) => !o.verwerkt);
  const overrides = Object.entries(keten.baas.overrides)
    .map(([id, v]) => {
      const p = keten.rondes.flatMap((r) => r.reviews.flatMap((rv) => rv.punten)).find((x) => x.id === id);
      return p ? `[${id}] ${v === "over" ? "ALSNOG OVERNEMEN" : "NIET OVERNEMEN"}: ${p.punt}` : null;
    })
    .filter(Boolean);
  const r = await generateJson(
    HerschrijfSchema,
    {
      model: auteur,
      system: systeem,
      images,
      instruction: `${ctx}\nJOUW HUIDIGE VERSIE (versie ${ronde.nr}):\n\n${docText(ronde.doc)}\n
TE VERWERKEN PUNTEN (alleen deze):\n${overgenomen.join("\n") || "(geen)"}\n${baas.length ? `\nOPMERKINGEN VAN DE BAAS (altijd verwerken, id = baas):\n${baas.map((o) => `[${o.id}] ${o.tekst}`).join("\n")}\n` : ""}${overrides.length ? `\nBESLISSINGEN VAN DE BAAS (altijd volgen):\n${overrides.join("\n")}\n` : ""}
Schrijf versie ${ronde.nr + 1}. Verwerk elk punt hierboven zichtbaar in de tekst: bij DEELS alleen het deel dat in jouw oordeel staat. Verander verder niets wezenlijks en houd het compact.
Geef in 'changelog' per id precies wat er in de tekst veranderde, in één zin.
Regels voor het document:
${DOC_REGELS}`,
      maxTokens: 9000,
      effort: "medium",
    },
    1,
  );
  await recordUsage(run.id, "herschrijven", r.usage);
  return r.data;
}

// ---------- 4. Slotcheck ----------

async function slotcheck(run: Run, keten: Keten, eind: AdviesDoc, ctx: string) {
  const voorzitter = run.cast.rollen.find((r) => r.isJury);
  const model = voorzitter ? resolveModel(voorzitter.modelKey, voorzitter.customModel) : null;
  if (!model) return null;
  const geschiedenis = keten.rondes
    .filter((r) => r.oordelen.length)
    .map(
      (r) =>
        `Ronde ${r.nr}:\n${r.reviews
          .flatMap((rv) => rv.punten.map((p) => ({ rv, p, o: r.oordelen.find((x) => x.id === p.id) })))
          .filter((x) => x.o)
          .map(({ rv, p, o }) => `- ${wie(rv)}: ${p.punt} → ${o!.oordeel} (${o!.reden})`)
          .join("\n")}`,
    )
    .join("\n\n");
  const gehoord = run.cast.rollen.filter((r) => !r.isJury).map((r) => r.functie).join(", ");
  const r = await generateJson(
    SlotcheckSchema,
    {
      model,
      system: `Je bent de voorzitter: een slimme, nuchtere en scherpe denker met overzicht. Je toetst of een advies klaar is om op te besluiten. ${NL}`,
      instruction: `${ctx}\nHET ADVIES:\n\n${docText(eind)}\n\nHOE HET TOT STAND KWAM (reviewpunten en oordelen):\n${geschiedenis || "(geen herzieningen nodig)"}\n
Al gehoorde perspectieven: ${gehoord}, en een tegenlezer van een ander model.
Doe de slotcheck: is dit klaar om op te besluiten? Controleer ook de rekensommen en of de conclusie echt volgt uit de onderbouwing.
Geef je bevindingen (max 5) met hun gevolg: 'conclusie' als de bevinding het besluit of de voorwaarden moet veranderen, 'aanvulling' als het erbij hoort maar het besluit niet verandert, 'geen' als het alleen een opmerking is.
Denk ook aan perspectieven die nog niet aan bod kwamen en noem hooguit 3 laatste aanvullingen. Noem de belangrijkste punten die bewust niet zijn overgenomen. Kies het review-inzicht dat het advies het meest verbeterde.`,
      maxTokens: 4000,
      effort: "medium",
    },
    1,
  ).catch(() => null);
  if (!r) return null;
  await recordUsage(run.id, "slotcheck", r.usage, voorzitter!.id);
  return r.data;
}

// ---------- 5. Eindredactie en controle ----------

type Claim = { id: string; claim: string };

function claimsVan(keten: Keten): Claim[] {
  const alle = keten.rondes.flatMap((r) => r.reviews.flatMap((rv) => rv.punten));
  const uitRondes = keten.rondes.flatMap((r) =>
    r.oordelen
      .filter((o) => o.oordeel !== "niet")
      .map((o) => {
        const p = alle.find((x) => x.id === o.id);
        const log = r.changelog?.find((c) => c.id === o.id)?.wijziging;
        return { id: o.id, claim: `${o.oordeel === "deels" ? "(deels) " : ""}${log ?? p?.voorstel ?? p?.punt ?? ""}` };
      }),
  );
  const uitHerkomst = (keten.herkomst ?? []).map((h, i) => ({ h, i })).filter(({ h }) => h.status === "opgenomen").map(({ h, i }) => ({ id: `h${i}`, claim: h.inzicht }));
  const uitSlot = (keten.slot?.bevindingen ?? []).map((b, i) => ({ b, i })).filter(({ b }) => b.impact === "conclusie").map(({ b, i }) => ({ id: `s${i}`, claim: `Verwerkt in besluit of voorwaarden: ${b.tekst}` }));
  return [...uitRondes, ...uitHerkomst, ...uitSlot];
}

async function eindredactie(run: Run, keten: Keten, doc: AdviesDoc, auteur: ModelConfig, snel: ModelConfig, systeem: string, ctx: string) {
  const claims = claimsVan(keten);
  const slotConclusie = (keten.slot?.bevindingen ?? []).filter((b) => b.impact === "conclusie");
  const slotAanvulling = (keten.slot?.bevindingen ?? []).filter((b) => b.impact === "aanvulling");
  const redigeer = async (huidig: AdviesDoc, lijst: Claim[], extra = "") => {
    const r = await generateJson(
      RedactieSchema,
      {
        model: auteur,
        system: `${systeem} Je bent nu de eindredacteur.`,
        instruction: `${ctx}\nHET ADVIES NA ALLE RONDES:\n\n${docText(huidig)}\n
CLAIMS DIE IN DE TEKST MOETEN STAAN (overgenomen punten, opgenomen inzichten, conclusies van de voorzitter):\n${lijst.map((c) => `[${c.id}] ${c.claim}`).join("\n") || "(geen)"}\n
${slotConclusie.length ? `BEVINDINGEN VAN DE VOORZITTER DIE DE CONCLUSIE RAKEN (vertrouwen: ${keten.slot?.vertrouwen}):\n${slotConclusie.map((b) => `- ${b.tekst}`).join("\n")}\n` : ""}${slotAanvulling.length ? `AANVULLINGEN VAN DE VOORZITTER (verwerk ze als ze kort passen):\n${slotAanvulling.map((b) => `- ${b.tekst}`).join("\n")}\n` : ""}
Maak de eindversie:
1. Leesbaar voor een directeur: het besluit in de eerste zin en de besluitregel; korte zinnen; geen jargon (een onvermijdelijke vakterm leg je in een bijzin uit); geen herhaling. De analyse max 500 woorden.
2. Controleer elke claim hierboven. Staat hij niet (herkenbaar) in de tekst, voeg hem dan kort toe als hij klopt; past hij niet meer, markeer hem dan als niet aanwezig. Geef per id in 'controle' of hij er nu in staat.
3. Verandert een bevinding van de voorzitter de conclusie, pas dan de besluitregel en de samenvatting aan, en leg dat uit in 'besluitAangepast'. Het stuk mag niet eindigen met een gat dat de voorzitter signaleerde.
4. Controleer de interne consistentie: cijfers, termijnen en drempels mogen elkaar niet tegenspreken. Zet tegenstrijdigheden recht en noem ze in 'consistentie'.
Voeg geen nieuwe inhoud toe buiten de claims en de bevindingen.${extra}
Regels voor het document:
${DOC_REGELS}`,
        maxTokens: 9000,
        effort: "medium",
      },
      1,
    );
    await recordUsage(run.id, "redactie", r.usage);
    return r.data;
  };
  const controleer = async (d: AdviesDoc, lijst: Claim[]) => {
    if (!lijst.length) return new Set<string>();
    const r = await generateJson(
      ControleSchema,
      {
        model: snel,
        system: "Je bent een nauwkeurige controleur. Je kijkt alleen of iets inhoudelijk in een tekst staat, niet of het klopt.",
        instruction: `TEKST:\n\n${docText(d)}\n\nCLAIMS:\n${lijst.map((c) => `[${c.id}] ${c.claim}`).join("\n")}\n\nGeef per id of de inhoud van de claim herkenbaar in de tekst staat (andere woorden mogen). Bij twijfel: niet aanwezig.`,
        maxTokens: 3000,
      },
      1,
    );
    await recordUsage(run.id, "controle", r.usage);
    return new Set(r.data.resultaten.filter((x) => !x.aanwezig).map((x) => x.id));
  };

  let red = await redigeer(doc, claims);
  let doc2 = red.document;
  let ontbreekt = await controleer(doc2, claims);
  // Eén herkansing voor de redacteur met alleen wat nog ontbreekt.
  if (ontbreekt.size) {
    const rest = claims.filter((c) => ontbreekt.has(c.id));
    const tweede = await redigeer(doc2, rest, "\nLET OP: deze claims ontbraken nog na de vorige redactie. Verwerk ze kort, of zeg dat ze niet aanwezig zijn.");
    doc2 = tweede.document;
    red = { ...red, consistentie: [...red.consistentie, ...tweede.consistentie], besluitAangepast: tweede.besluitAangepast || red.besluitAangepast };
    ontbreekt = await controleer(doc2, rest);
  }
  const teruggezet = new Set([...ontbreekt].filter((id) => !id.startsWith("s")));
  return {
    doc: doc2,
    teruggezet,
    redactie: {
      besluitAangepast: red.besluitAangepast,
      consistentie: red.consistentie,
      gecorrigeerd: claims.filter((c) => ontbreekt.has(c.id)).map((c) => ({ id: c.id, claim: c.claim })),
      gecontroleerd: claims.length,
    },
  };
}

/** Het eindadvies ook als 'result' bewaren: dan werken geschiedenis, export en de vergelijking gewoon. */
function naarResult(run: Run): JuryResult {
  const k = run.keten!;
  const d = k.eind!;
  // De losse vraag in de vergelijking: de eerste versie van Claude alleen (of anders versie 1).
  const basis = k.concepten?.[0];
  const v1 = basis?.doc ?? k.rondes[0].doc;
  const bronnen = run.cast.rollen.flatMap((r) => (run.prep[r.id]?.facts ?? []).map((f) => ({ naam: f.bron, gebruiktDoor: r.functie })));
  return {
    uitslag: d.besluit,
    samenvatting: d.samenvatting,
    besluitenVanDeBaas: run.cast.randvoorwaarden ?? [],
    strategie: d.stappen.map((s) => ({ stap: s.stap, waarom: s.waarom, eersteActie: `${s.eersteActie} (${s.eigenaar}, ${s.termijn})` })),
    aannames: d.aannames.map((a) => ({ ...a, onbewezen: false })),
    onenigheid: [],
    bronnen,
    volgendeStappen: d.stappen.map((s) => s.eersteActie),
    besteQuote: k.slot?.besteInzicht ? { tekst: k.slot.besteInzicht.tekst, rol: k.slot.besteInzicht.van } : { tekst: d.besluit, rol: "Voorzitter" },
    vergelijking: {
      label: basis ? `${basis.ai} alleen, één vraag` : `${k.auteur.ai}, versie 1 zonder review`,
      model: basis?.model ?? k.auteur.model,
      advies: { uitslag: v1.besluit, samenvatting: v1.samenvatting, strategie: v1.stappen.map((s) => ({ stap: s.stap, waarom: s.waarom, eersteActie: s.eersteActie })), aannames: v1.aannames },
      kosten_eur: k.kostenVersie1 ?? 0,
      aIs: Math.random() < 0.5 ? "debat" : "enkel",
    },
  };
}
