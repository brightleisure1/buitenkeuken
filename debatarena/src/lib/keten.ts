import "server-only";
import { attachmentImages, attachmentText, runAttachments } from "./attachments";
import { overBudget } from "./budget";
import { MODELS, PROVIDERS, resolveModel, type ModelConfig } from "./config";
import { friendly } from "./errors";
import { generateJson } from "./llm";
import { niveauOf, turnModel } from "./niveau";
import { getRun, updateRun } from "./runs";
import { AdviesDocSchema, HerzieningSchema, ReviewSchema, SlotcheckSchema } from "./schemas";
import { availableKeys } from "./settings";
import { recordUsage } from "./usage-db";
import type { AdviesDoc, JuryResult, Keten, KetenRonde, Review, Role, Run } from "./types";

/**
 * De review-keten: één adviesdocument dat in rondes beter wordt.
 * 1. Versie 1 door het slimste model (auteur).
 * 2. Reviews vanuit elke persona, plus een tegenlezer van een ánder model.
 * 3. De auteur beoordeelt elk punt (overnemen, deels, niet — met reden) en schrijft de volgende versie.
 * 4. Herhalen tot er niets wezenlijks meer te verbeteren valt, of tot het maximum aantal rondes.
 * 5. Slotcheck door de voorzitter, die ook nog niet gehoorde perspectieven overweegt.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PREP_WAIT_MS = 120_000;
export const MAX_RONDES = 3;

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

/** Wie schrijft (het slimste Claude-model) en wie leest tegen (het slimste model van een andere AI). */
export async function kiesModellen(): Promise<{ auteur: ModelConfig; kruis: ModelConfig | null }> {
  const keys = await availableKeys();
  const strong = (p: string) => MODELS.find((m) => m.provider === p && m.tier === "sterk" && keys[m.provider]);
  const auteur = strong("anthropic") ?? strong("openai") ?? strong("google") ?? MODELS.find((m) => keys[m.provider]);
  if (!auteur) throw friendly(new Error("geen sleutel"));
  const kruis = ["openai", "google", "anthropic", "xai"].filter((p) => p !== auteur.provider).map(strong).find(Boolean) ?? null;
  return { auteur, kruis };
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

// Eén keten per run tegelijk (de app draait als één server).
const running = new Set<string>();

export async function runKeten(id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    await stap(id, "De rollen doen hun huiswerk…", "huiswerk");
    let run = await wachtOpHuiswerk(id);
    const { auteur, kruis } = await kiesModellen();
    const attachments = await runAttachments(id);
    const att = attachmentText(attachments);
    const images = await attachmentImages(attachments);
    const ctx = context(run, att);
    const systeem = `Je bent een ervaren, nuchtere adviseur voor Nederlandse bedrijven. Je adviseert de baas, die zelf besluit. ${NL} Denk grondig na en wees concreet.`;

    // 1. Versie 1
    let keten = run.keten ?? leeg();
    if (!keten.rondes.length) {
      await patchKeten(id, (k) => {
        k.auteur = { ai: ai(auteur), model: auteur.model };
        k.kruis = kruis ? { ai: ai(kruis), model: kruis.model } : null;
        k.stap = `${ai(auteur)} schrijft versie 1…`;
        k.fase = "versie1";
      });
      const v1 = await generateJson(AdviesDocSchema, { model: auteur, system: systeem, images, instruction: `${ctx}\nSchrijf het adviesdocument. Regels:\n${DOC_REGELS}`, maxTokens: 8000, deep: true }, 1);
      const eur = await recordUsage(id, "versie", v1.usage);
      keten = await patchKeten(id, (k) => {
        k.rondes = [{ nr: 1, doc: v1.data, reviews: [], oordelen: [], wijzigingen: [] }];
        k.kostenVersie1 = eur;
      });
    }

    if (!keten.maxRondes) {
      keten = await patchKeten(id, (k) => {
        k.maxRondes = Math.min(MAX_RONDES, Math.max(1, run.cast.rondes || 2));
      });
    }
    // 2–4. Rondes van review en herziening
    for (;;) {
      run = await getRun(id);
      keten = run.keten!;
      const ronde = keten.rondes.at(-1)!;
      // Alle rondes gedaan: de laatste versie is de eindversie.
      if (ronde.nr > (keten.maxRondes ?? 2)) break;
      if (overBudget(run)) {
        await patchKeten(id, (k) => {
          k.budgetOp = true;
        });
        break;
      }
      if (!ronde.reviews.length) {
        await stap(id, `Ronde ${ronde.nr}: de rollen en de tegenlezer lezen versie ${ronde.nr}…`, "review");
        const reviews = await reviewRonde(run, ronde, kruis, ctx);
        keten = await patchKeten(id, (k) => {
          k.rondes.at(-1)!.reviews = reviews;
        });
      }
      const r = keten.rondes.at(-1)!;
      const wezenlijk = r.reviews.flatMap((x) => x.punten).filter((p) => p.zwaarte !== "laag");
      const baasOpen = keten.baas.opmerkingen.some((o) => !o.verwerkt) || Object.keys(keten.baas.overrides).length > 0;
      // Niets wezenlijks meer te verbeteren en niets van de baas: klaar.
      if (!wezenlijk.length && !baasOpen) break;
      run = await getRun(id);
      if (overBudget(run)) {
        await patchKeten(id, (k) => {
          k.budgetOp = true;
        });
        break;
      }
      await stap(id, `Ronde ${r.nr}: ${ai(auteur)} beoordeelt de feedback en schrijft versie ${r.nr + 1}…`, "herschrijven");
      const herz = await herzien(run, keten, r, auteur, systeem, ctx, images);
      await patchKeten(id, (k) => {
        const cur = k.rondes.at(-1)!;
        cur.oordelen = herz.oordelen;
        cur.wijzigingen = herz.wijzigingen;
        k.baas.opmerkingen = k.baas.opmerkingen.map((o) => ({ ...o, verwerkt: true }));
        k.baas.overrides = {};
        k.rondes.push({ nr: cur.nr + 1, doc: herz.document, reviews: [], oordelen: [], wijzigingen: [] });
      });
    }

    // 5. Slotcheck
    run = await getRun(id);
    keten = run.keten!;
    const eind = keten.rondes.at(-1)!.doc;
    await stap(id, "De voorzitter doet de slotcheck…", "slotcheck");
    const slot = await slotcheck(run, keten, eind, ctx);
    await patchKeten(id, (k) => {
      k.eind = eind;
      k.slot = slot ?? undefined;
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

async function stap(id: string, tekst: string, fase: NonNullable<Keten["fase"]>) {
  await patchKeten(id, (k) => {
    k.stap = tekst;
    k.fase = fase;
    k.status = "bezig";
    k.fout = undefined;
  });
}

/** Alle punten die al eerder zijn afgehandeld, zodat reviewers niet in herhaling vallen. */
function eerderePunten(keten: Keten) {
  return keten.rondes
    .slice(0, -1)
    .flatMap((r) => r.reviews.flatMap((rv) => rv.punten.map((p) => ({ p, o: r.oordelen.find((x) => x.id === p.id) }))))
    .map(({ p, o }) => `- ${p.punt} → ${o ? `${o.oordeel}: ${o.reden}` : "niet beoordeeld"}`)
    .join("\n");
}

async function reviewRonde(run: Run, ronde: KetenRonde, kruis: ModelConfig | null, ctx: string): Promise<Review[]> {
  const keten = run.keten!;
  const eerder = eerderePunten(keten);
  const doc = docText(ronde.doc);
  const niveau = niveauOf(run.cast);
  const personas = run.cast.rollen.filter((r) => !r.isJury);
  const tasks: Promise<Review | null>[] = personas.map(async (role, i) => {
    const model = turnModel(resolveModel(role.modelKey, role.customModel), niveau);
    const r = await generateJson(
      ReviewSchema,
      {
        model,
        system: personaSysteem(role),
        instruction: `${ctx}\nHIER IS HET ADVIESDOCUMENT (versie ${ronde.nr}):\n\n${doc}\n${eerder ? `\nAL EERDER BESPROKEN (niet herhalen):\n${eerder}\n` : ""}
Lees dit vanuit jouw rol en jouw belang. Geef maximaal 4 punten die het advies beter maken voor het besluit: wat mis je, wat klopt er vanuit jouw praktijk niet, wat zou jou of jouw mensen tegenhouden, welke voorwaarde stel je. Wees concreet en gebruik je vakkennis. Is het stuk vanuit jouw blik goed genoeg, geef dan 0 of 1 punt. Geen complimenten.`,
        maxTokens: 1500,
      },
      1,
    ).catch(() => null);
    if (!r) return null;
    await recordUsage(run.id, "review", r.usage, role.id);
    return {
      van: role.id,
      naam: role.naam,
      functie: role.functie,
      soort: "persona" as const,
      ai: PROVIDERS[model.provider].naam,
      punten: r.data.punten.slice(0, 4).map((p, j) => ({ ...p, id: `r${ronde.nr}-p${i}-${j}` })),
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
            instruction: `${ctx}\nHIER IS HET ADVIESDOCUMENT (versie ${ronde.nr}), geschreven door een andere AI:\n\n${doc}\n${eerder ? `\nAL EERDER BESPROKEN (niet herhalen):\n${eerder}\n` : ""}
Geef maximaal 6 reviewpunten: fouten, zwakke of ontbrekende redeneringen, gemiste opties of risico's, cijfers zonder onderbouwing, interne tegenspraak, en stappen die in de praktijk niet uitvoerbaar zijn. Per punt een concreet voorstel. Geen punten over stijl.`,
            maxTokens: 2500,
            deep: true,
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
          punten: r.data.punten.slice(0, 6).map((p, j) => ({ ...p, id: `r${ronde.nr}-k-${j}` })),
        };
      })(),
    );
  }
  const reviews = (await Promise.all(tasks)).filter((x): x is Review => !!x);
  if (!reviews.length) throw friendly(new Error("Geen enkele review lukte"));
  return reviews;
}

function personaSysteem(role: Role) {
  return `Je bent ${role.naam}, ${role.functie}. ${NL}
Waar jij op let: ${role.perspectief}
Over jou: ${role.instructie}
Je leest een adviesdocument voor de directie en geeft feedback vanuit jouw rol, belang en praktijkervaring. Kort, concreet en eerlijk.`;
}

async function herzien(run: Run, keten: Keten, ronde: KetenRonde, auteur: ModelConfig, systeem: string, ctx: string, images: Awaited<ReturnType<typeof attachmentImages>>) {
  const punten = ronde.reviews
    .flatMap((rv) => rv.punten.map((p) => `[${p.id}] (${p.zwaarte}) ${rv.soort === "kruis" ? `Tegenlezer (${rv.ai})` : `${rv.naam}, ${rv.functie}`}: ${p.punt} → voorstel: ${p.voorstel}`))
    .join("\n");
  const baas = keten.baas.opmerkingen.filter((o) => !o.verwerkt);
  const overrides = Object.entries(keten.baas.overrides).map(([id, v]) => {
    const p = keten.rondes.flatMap((r) => r.reviews.flatMap((rv) => rv.punten)).find((x) => x.id === id);
    return p ? `- ${v === "over" ? "ALSNOG OVERNEMEN" : "NIET OVERNEMEN"}: ${p.punt}` : null;
  });
  const r = await generateJson(
    HerzieningSchema,
    {
      model: auteur,
      system: systeem,
      images,
      instruction: `${ctx}\nJOUW HUIDIGE VERSIE (versie ${ronde.nr}):\n\n${docText(ronde.doc)}\n\nREVIEWPUNTEN:\n${punten}\n${baas.length ? `\nOPMERKINGEN VAN DE BAAS (altijd verwerken):\n${baas.map((o) => `- ${o.tekst}`).join("\n")}\n` : ""}${overrides.filter(Boolean).length ? `\nBESLISSINGEN VAN DE BAAS OVER EERDERE PUNTEN (altijd volgen):\n${overrides.filter(Boolean).join("\n")}\n` : ""}
Beoordeel elk reviewpunt op zijn merites en geef per id een oordeel: "over" (overnemen), "deels" of "niet", met één zin reden. Neem over wat het besluit echt beter maakt. Wijs af wat onjuist is, niet relevant, of al gedekt, ook als het van een belangrijke rol komt. Wees niet volgzaam: alles overnemen om iedereen tevreden te houden maakt het stuk vager en slechter. Houd het document compact.
Schrijf daarna de nieuwe versie van het document, met dezelfde regels:
${DOC_REGELS}
En som kort op wat er veranderde.`,
      maxTokens: 12000,
      deep: true,
    },
    1,
  );
  await recordUsage(run.id, "herschrijven", r.usage);
  return r.data;
}

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
          .map(({ rv, p, o }) => `- ${rv.soort === "kruis" ? "Tegenlezer" : rv.functie}: ${p.punt} → ${o?.oordeel ?? "?"} (${o?.reden ?? ""})`)
          .join("\n")}`,
    )
    .join("\n\n");
  const gehoord = run.cast.rollen.filter((r) => !r.isJury).map((r) => r.functie).join(", ");
  const r = await generateJson(
    SlotcheckSchema,
    {
      model,
      system: `Je bent de voorzitter: een slimme, nuchtere en scherpe denker met overzicht. Je toetst of een advies klaar is om op te besluiten. ${NL}`,
      instruction: `${ctx}\nHET EINDADVIES:\n\n${docText(eind)}\n\nHOE HET TOT STAND KWAM (reviewpunten en oordelen):\n${geschiedenis || "(geen herzieningen nodig)"}\n
Al gehoorde perspectieven: ${gehoord}, en een tegenlezer van een ander model.
Doe de slotcheck: is dit klaar om op te besluiten? Denk ook aan perspectieven die nog niet aan bod kwamen (bijvoorbeeld de klant, de werkvloer, de financier, de toezichthouder) en noem hooguit 3 laatste aanvullingen. Noem de belangrijkste punten die bewust niet zijn overgenomen, en of je dat terecht vindt. Kies het review-inzicht dat het advies het meest verbeterde.`,
      maxTokens: 4000,
      deep: true,
    },
    1,
  ).catch(() => null);
  if (!r) return null;
  await recordUsage(run.id, "slotcheck", r.usage, voorzitter!.id);
  return r.data;
}

/** Het eindadvies ook als 'result' bewaren: dan werken geschiedenis, export en de vergelijking gewoon. */
function naarResult(run: Run): JuryResult {
  const k = run.keten!;
  const d = k.eind!;
  const v1 = k.rondes[0].doc;
  const besluiten = run.cast.randvoorwaarden ?? [];
  const bronnen = run.cast.rollen.flatMap((r) => (run.prep[r.id]?.facts ?? []).map((f) => ({ naam: f.bron, gebruiktDoor: r.functie })));
  return {
    uitslag: d.besluit,
    samenvatting: d.samenvatting,
    besluitenVanDeBaas: besluiten,
    strategie: d.stappen.map((s) => ({ stap: s.stap, waarom: s.waarom, eersteActie: `${s.eersteActie} (${s.eigenaar}, ${s.termijn})` })),
    aannames: d.aannames.map((a) => ({ ...a, onbewezen: false })),
    onenigheid: [],
    bronnen,
    volgendeStappen: d.stappen.map((s) => s.eersteActie),
    besteQuote: k.slot?.besteInzicht ? { tekst: k.slot.besteInzicht.tekst, rol: k.slot.besteInzicht.van } : { tekst: d.besluit, rol: "Voorzitter" },
    // Versie 1 is in feite één vraag aan het slimste model: automatisch blind vergelijken met de eindversie.
    vergelijking: {
      label: `${k.auteur.ai}, versie 1 zonder review`,
      model: k.auteur.model,
      advies: { uitslag: v1.besluit, samenvatting: v1.samenvatting, strategie: v1.stappen.map((s) => ({ stap: s.stap, waarom: s.waarom, eersteActie: s.eersteActie })), aannames: v1.aannames },
      kosten_eur: k.kostenVersie1 ?? 0,
      aIs: Math.random() < 0.5 ? "debat" : "enkel",
    },
  };
}
