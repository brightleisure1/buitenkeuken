import "server-only";
import type { z } from "zod";
import { DEFAULT_ROUNDS, FAST_MODEL_KEY, MAX_ROUNDS, MODELS, PROVIDERS, getModel, supportsWebSearch, type ModelConfig, type Provider } from "./config";
import { AppError } from "./errors";
import { generateJson } from "./llm";
import { CastChatSchema, CastSchema } from "./schemas";
import { applyCliches, CLICHES, isFun } from "./cliches";
import { fixJury } from "./jury";
import { availableKeys } from "./settings";
import type { Attachment, Cast, Role } from "./types";
import { debateVoices, type Voice } from "./voices";

type RawCast = z.infer<typeof CastSchema>;

export async function fastModel(): Promise<ModelConfig> {
  const keys = await availableKeys();
  for (const p of ["anthropic", "openai", "google", "xai"] as Provider[]) {
    if (keys[p]) return getModel(FAST_MODEL_KEY[p])!;
  }
  throw new AppError(
    "Er is nog geen AI-sleutel ingesteld.",
    "Ga naar Instellingen en plak een sleutel van Anthropic, OpenAI, Google (Gemini) of xAI (Grok). Dat duurt een minuut.",
  );
}

async function availableModels() {
  const keys = await availableKeys();
  return MODELS.filter((m) => keys[m.provider]);
}

const SYSTEM = `Je bent de regisseur van de Debatarena: een app waarin AI-rollen hardop debatteren over een zakelijk vraagstuk. De gebruiker is "de baas" en kan altijd ingrijpen. Doelgroep: iedereen in het bedrijfsleven. Alles in gewone taal, zonder jargon.

Jij stelt de cast samen. Castingregels:
- 3 of 4 debaterende rollen plus precies één voorzitter (isJury=true). De voorzitter debatteert niet mee, maar opent de vergadering, weegt af en geeft aan het eind een advies; de baas besluit. De voorzitter is een slimme, nuchtere en scherpe voorzitter met overzicht: nooit ongecensureerd, geen cliché, en een sterk Claude- of GPT-model.
- Het is een overleg binnen het bedrijf van de baas. De debaterende rollen zijn vrijwel allemaal collega's uit dat bedrijf (bijvoorbeeld directie, operatie, financiën, marketing/verkoop, HR, iemand van de werkvloer), gekozen bij wat het vraagstuk raakt. Leid het soort bedrijf af uit het vraagstuk en de bijlages.
- Daarnaast zit er altijd precies één klant of gast van buiten aan tafel (isKritisch=true): degene die uiteindelijk betaalt, koopt of gebruikt, en daarom kritisch is. Noem de functie zo dat duidelijk is dat het de klant/gast is (bijv. "Gast, gezin met twee kinderen", "Klant, inkoper bij een groothandel").
- Geen overlappende perspectieven. Elke rol bewaakt een ander belang.
- Meng de AI's: gebruik zoveel mogelijk verschillende aanbieders uit de modellijst (Claude, ChatGPT, Gemini, Grok), zodat de baas ziet hoe ze van elkaar verschillen.
- ongezouten: standaard false (gecensureerd). Alleen true (ongecensureerd) bij een deelnemer als de baas daarom vraagt ("zonder censuur", "ongecensureerd", "ongezouten", "laat Grok los"). Kan bij elke deelnemer, nooit bij de voorzitter.
- vergadercliches (= de fun-modus): standaard false en dan is cliche overal ''. Zet op true als de baas erom vraagt ("fun-modus", "maak het grappig", "met vergaderclichés", "maak het herkenbaar", "net een echte vergadering"). Geef dan 2 tot 4 debaterende rollen elk een ander cliché uit de clichélijst dat past bij hun functie. De voorzitter nooit; de kritische klant liever niet.
- Rollen geven nooit scores of complimenten. Ze komen met concrete bezwaren en concrete voorstellen. Zet dat in hun instructie.
- Het doel is een waardevol debat dat de baas echt helpt beslissen. Elke rol is een ervaren vakmens met echte kennis: geef in de instructie aan welke kennis en ervaring die rol inbrengt (bijv. "kent de marges per product uit het hoofd", "heeft zo'n verandering bij een vorige werkgever zien mislukken", "weet wat de cao hierover zegt") en onder welke voorwaarde die rol van mening zou veranderen.
- Geef elke rol ook een eigen, geloofwaardige manier van praten, zodat ze als echte mensen klinken: bijv. "kortaf en zakelijk", "rekent alles hardop voor", "vriendelijk maar laat zich niet afschepen". Echte mensen, geen typetjes of karikaturen.
- Varieer leeftijd, geslacht en afkomst. 'uiterlijk' is Engels en een realistische, korte beschrijving van de persoon met één passend detail van het beroep (bijv. "woman in her late 50s of Moroccan-Dutch descent, reading glasses, holding a procurement folder").
- webzoeken=true voor rollen die baat hebben bij actuele feiten (markt, prijzen, regels). Anders false. Alleen modellen met "(kan webzoeken)" kunnen dat.
- rondes: standaard 3. Alleen minder bij een heel simpele vraag.
- stemmen: 'uit' als er geen stemmenlijst is. Anders standaard 'jury' (dan praat alleen de voorzitter hardop).
- stemId: kies uit de stemmenlijst per rol een passende stem (geslacht en leeftijd passend bij de naam). Elke rol een andere. Stemmen met "Nederlands" gaan voor. null als er geen lijst is.
- bijlages: wijs elke bijlage toe aan 'iedereen' of aan de id van de ene rol waarvoor hij bedoeld is. Bij twijfel 'iedereen'.
- id: een korte slug in kleine letters (bijv. 'inkoper', 'voorzitter').
- Het gaat om Nederlandse bedrijven. Rollen werken bij Nederlandse organisaties, denken in euro's en kennen de Nederlandse markt, regels en omgangsvormen. Namen passen bij Nederland (met variatie in afkomst).
- modelKey: kies uit de modellijst.`;

function context(models: ModelConfig[], voices: Voice[], attachments: Attachment[]) {
  const modelList = models
    .map((m) => `- ${m.key}: ${m.label} (${PROVIDERS[m.provider].naam}${supportsWebSearch(m) ? ", kan webzoeken" : ""})`)
    .join("\n");
  const voiceList = voices.length
    ? voices
        .slice(0, 40)
        .map((v) => `- ${v.id}: ${v.naam} (${[v.gender, v.nl ? "Nederlands" : null, v.omschrijving].filter(Boolean).join(", ") || "geen omschrijving"})`)
        .join("\n")
    : "(geen stemmen beschikbaar)";
  const att = attachments.length
    ? attachments
        .map((a) => `- ${a.id}: ${a.name}${a.kind === "text" && a.text ? ` — begint met: "${a.text.slice(0, 300).replace(/\s+/g, " ")}"` : " (afbeelding)"}`)
        .join("\n")
    : "(geen bijlages)";
  const clicheList = CLICHES.map((c) => `- ${c.id}: ${c.naam} — ${c.omschrijving}`).join("\n");
  return `MODELLEN:\n${modelList}\n\nSTEMMEN:\n${voiceList}\n\nBIJLAGES:\n${att}\n\nVERGADERCLICHÉS:\n${clicheList}`;
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "rol"
  );
}

const CRITICAL_RE = /klant|gast|bezoeker|koper|inkoper|afnemer|consument|gebruiker|opdrachtgever|budgethouder/i;

/** Handhaaft de castingregels, wat het model ook teruggeeft. */
export function normalizeCast(
  raw: RawCast,
  opts: { models: ModelConfig[]; voices: Voice[]; attachments: Attachment[]; previous?: Cast | null },
): Cast {
  const modelKeys = new Set(opts.models.map((m) => m.key));
  const providers = new Set(opts.models.map((m) => m.provider));
  const strongest = (provider?: string) =>
    opts.models.find((m) => m.tier === "sterk" && (!provider || m.provider === provider)) ?? opts.models[0];
  const prevById = new Map((opts.previous?.rollen ?? []).map((r) => [r.id, r]));

  const used = new Set<string>();
  let roles: Role[] = raw.rollen.map((r) => {
    const prev = prevById.get(r.id);
    let id = prev ? r.id : slug(r.id && r.id !== "nieuw" ? r.id : r.naam);
    while (used.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
    used.add(id);
    return {
      id,
      naam: r.naam.trim(),
      functie: r.functie.trim(),
      perspectief: r.perspectief.trim(),
      instructie: r.instructie.trim(),
      zin: r.zin.trim(),
      modelKey: modelKeys.has(r.modelKey) ? r.modelKey : strongest().key,
      customModel: prev?.customModel ?? null,
      stemId: r.stemId,
      webzoeken: !!r.webzoeken,
      isJury: !!r.isJury,
      isKritisch: !!r.isKritisch,
      ongezouten: !!r.ongezouten,
      cliche: r.cliche || null,
      uiterlijk: r.uiterlijk.trim(),
      ...(prev?.portraits ? { portraits: prev.portraits } : {}),
    };
  });

  // Precies één voorzitter (isJury), achteraan.
  let jury = roles.filter((r) => r.isJury);
  if (jury.length === 0) {
    roles.push({
      id: used.has("jury") ? "jury-1" : "jury",
      naam: "Mr. Anneke de Wit",
      functie: "Voorzitter",
      perspectief: "Weegt alle standpunten neutraal af",
      instructie: "Zit de vergadering voor, luister, weeg af en geef aan het eind een helder advies. Geen complimenten, wel harde keuzes.",
      zin: "Weegt alles af en hakt de knoop door.",
      modelKey: strongest().key,
      stemId: null,
      webzoeken: false,
      isJury: true,
      isKritisch: false,
      uiterlijk: "calm woman in her 60s with silver bob haircut, judge-like black blazer, holding a small wooden gavel",
    });
    jury = roles.filter((r) => r.isJury);
  }
  roles = [...roles.filter((r) => !r.isJury), jury[0]];
  roles[roles.length - 1].isKritisch = false;

  // 3-4 debaters (meer mag alleen als de gebruiker er zelf om vroeg; max 5).
  const maxDebaters = opts.previous ? 5 : 4;
  let debaters = roles.filter((r) => !r.isJury).slice(0, maxDebaters);

  // Precies één kritische klant/koper.
  const crit = debaters.filter((r) => r.isKritisch);
  if (crit.length !== 1) {
    debaters.forEach((r) => (r.isKritisch = false));
    const pick = debaters.find((r) => CRITICAL_RE.test(`${r.functie} ${r.perspectief}`));
    if (pick) pick.isKritisch = true;
    else {
      const klant: Role = {
        id: used.has("klant") ? "klant-1" : "klant",
        naam: "Bas Verhoeven",
        functie: "Klant (kritisch)",
        perspectief: "Wil waar voor zijn geld en gelooft niets op voorhand",
        instructie: "Je bent de klant die moet betalen. Stel lastige vragen over prijs, nut en risico. Geen complimenten, wel concrete bezwaren en eisen.",
        zin: "Betaalt de rekening en wil eerst bewijs zien.",
        modelKey: strongest().key,
        stemId: null,
        webzoeken: false,
        isJury: false,
        isKritisch: true,
        uiterlijk: "skeptical man in his 40s of Indonesian-Dutch descent, arms crossed, holding a crumpled invoice, raised eyebrow",
      };
      debaters = debaters.length >= maxDebaters ? [...debaters.slice(0, maxDebaters - 1), klant] : [...debaters, klant];
    }
  }

  // Verschillende AI's door elkaar (Claude, ChatGPT, Gemini, Grok).
  const provList = [...providers];
  if (provList.length > 1 && debaters.length > 1) {
    const provs = new Set(debaters.map((r) => getModel(r.modelKey)?.provider));
    if (provs.size < 2) {
      const cur = getModel(debaters[0].modelKey)!.provider;
      const others = provList.filter((p) => p !== cur);
      debaters.forEach((r, i) => {
        if (i % 2 === 1 && !r.customModel) {
          const tier = getModel(r.modelKey)!.tier;
          const other = others[((i - 1) / 2) % others.length];
          r.modelKey = (opts.models.find((m) => m.provider === other && m.tier === tier) ?? strongest(other)).key;
        }
      });
    }
  }

  roles = [...debaters, jury[0]];

  roles = roles.map((r) => fixJury(r, opts.models));

  // Ongecensureerd kan bij elke deelnemer (fixJury houdt de Jury netjes); webzoeken alleen bij modellen die dat kunnen.
  for (const r of roles) {
    const m = getModel(r.modelKey);
    r.ongezouten = !!r.ongezouten && !r.isJury;
    if (m && !supportsWebSearch(m) && !r.customModel) r.webzoeken = false;
  }

  // Stemmen: geldig en uniek.
  const voiceIds = new Set(opts.voices.map((v) => v.id));
  const taken = new Set<string>();
  for (const r of roles) {
    if (r.stemId && voiceIds.has(r.stemId) && !taken.has(r.stemId)) taken.add(r.stemId);
    else r.stemId = null;
  }
  for (const r of roles) {
    if (!r.stemId) {
      const free = opts.voices.find((v) => !taken.has(v.id));
      if (free) {
        r.stemId = free.id;
        taken.add(free.id);
      }
    }
  }

  // Bijlages.
  const roleIds = new Set(roles.map((r) => r.id));
  const byName = new Map(roles.map((r) => [r.naam.toLowerCase(), r.id]));
  const bijlages: Record<string, string> = {};
  for (const a of opts.attachments) {
    const hit = raw.bijlages.find((b) => b.bijlageId === a.id)?.voor ?? opts.previous?.bijlages[a.id] ?? "iedereen";
    bijlages[a.id] = roleIds.has(hit) ? hit : (byName.get(hit.toLowerCase()) ?? "iedereen");
  }

  const rondes = Number.isFinite(raw.rondes) ? Math.min(MAX_ROUNDS, Math.max(1, Math.round(raw.rondes))) : DEFAULT_ROUNDS;
  const stemmen = opts.voices.length ? raw.stemmen : "uit";

  return applyCliches({ titel: raw.titel.trim().slice(0, 80), rollen: roles, rondes, stemmen, bijlages, cliches: !!raw.vergadercliches, fun: !!raw.vergadercliches });
}

function castToRaw(c: Cast): RawCast {
  return {
    titel: c.titel,
    rondes: c.rondes,
    stemmen: c.stemmen,
    vergadercliches: isFun(c),
    bijlages: Object.entries(c.bijlages).map(([bijlageId, voor]) => ({ bijlageId, voor })),
    rollen: c.rollen.map((r) => ({
      id: r.id,
      naam: r.naam,
      functie: r.functie,
      perspectief: r.perspectief,
      instructie: r.instructie,
      zin: r.zin,
      modelKey: r.modelKey,
      stemId: r.stemId,
      webzoeken: r.webzoeken,
      isJury: r.isJury,
      isKritisch: r.isKritisch,
      ongezouten: !!r.ongezouten,
      cliche: r.cliche ?? "",
      uiterlijk: r.uiterlijk,
    })),
  };
}

export async function composeCast(question: string, attachments: Attachment[]) {
  const [model, models, voices] = await Promise.all([fastModel(), availableModels(), debateVoices()]);
  const { data, usage } = await generateJson(CastSchema, {
    model,
    system: SYSTEM,
    instruction: `${context(models, voices, attachments)}\n\nVRAAGSTUK VAN DE BAAS:\n${question}\n\nStel de cast samen.`,
    maxTokens: 4000,
  });
  return { cast: normalizeCast(data, { models, voices, attachments }), usage };
}

export async function editCast(
  current: Cast,
  question: string,
  request: string,
  chat: { van: "baas" | "regie"; tekst: string }[],
  attachments: Attachment[],
) {
  const [model, models, voices] = await Promise.all([fastModel(), availableModels(), debateVoices()]);
  const history = chat
    .slice(-6)
    .map((m) => `${m.van === "baas" ? "Baas" : "Regie"}: ${m.tekst}`)
    .join("\n");
  const { data, usage } = await generateJson(CastChatSchema, {
    model,
    system: SYSTEM,
    instruction: `${context(models, voices, attachments)}\n\nVRAAGSTUK:\n${question}\n\nHUIDIGE CAST (JSON):\n${JSON.stringify(castToRaw(current))}\n\n${history ? `EERDER IN DIT GESPREK:\n${history}\n\n` : ""}VERZOEK VAN DE BAAS:\n${request}\n\nPas de cast aan. Verander alleen wat gevraagd wordt; laat al het andere (ook id's) precies staan. Een nieuwe rol krijgt een nieuwe korte id. Vraagt de baas om meer dan 4 debaterende rollen, dan mag dat tot 5. Vraagt de baas om de fun-modus, iets grappigs of vergaderclichés, zet vergadercliches=true en deel clichés uit; wil de baas het serieus of de clichés weg, zet vergadercliches=false. Vraagt de baas een specifiek cliché voor een rol ("maak de CFO de Parkeerder"), zet dat cliché bij die rol. Vraagt de baas om een rol "zonder censuur" of "ongezouten", zet ongezouten=true bij die rol (niet bij de voorzitter); verander het model alleen als de baas daarom vraagt. Wil de baas een rol weer "gecensureerd" of "netjes", zet ongezouten=false. Geef de volledige nieuwe cast terug.`,
    maxTokens: 5000,
  });
  return {
    antwoord: data.antwoord,
    cast: normalizeCast(data.cast, { models, voices, attachments, previous: current }),
    usage,
  };
}
