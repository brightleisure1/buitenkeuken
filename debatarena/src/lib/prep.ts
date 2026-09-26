import "server-only";
import { toFile } from "openai";
import { FAST_MODEL_KEY, IMAGE, getModel, resolveModel, supportsWebSearch } from "./config";
import { attachmentImages, attachmentsFor, runAttachments } from "./attachments";
import { extractJson, openaiClient, research } from "./llm";
import { homeworkInstruction, roleSystem } from "./prompts";
import { getRun, mergePrep } from "./runs";
import { emptyUsage } from "./usage";
import { recordUsage } from "./usage-db";
import { HomeworkSchema } from "./schemas";
import { availableKeys } from "./settings";
import { upload } from "./supabase";
import type { Attachment, Cast, Mood, Role, Run } from "./types";
import { isFun } from "./cliches";

const STALE_MS = 4 * 60_000;

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Sleutel van het portret: verandert die, dan wordt er opnieuw getekend.
 * Oude debatten (zonder fun-schakelaar) houden precies hun oude sleutel.
 */
export function portraitKey(r: Role, cast: Pick<Cast, "fun" | "cliches">) {
  const base = `v2|${r.naam}|${r.functie}|${r.uiterlijk}|`;
  if (cast.fun === true) return hash(`${base}${r.cliche ?? ""}|fun`);
  if (cast.fun === undefined && cast.cliches) return hash(`${base}${r.cliche ?? ""}`);
  return hash(base);
}

export const homeworkKey = (r: Role, run: Run) =>
  hash(`${r.perspectief}|${r.instructie}|${r.webzoeken}|${r.modelKey}|${r.customModel ?? ""}|${JSON.stringify(run.cast.bijlages)}`);

/** Een grappig attribuut per vergadertype, alleen in de fun-modus. */
const CLICHE_PROP: Record<string, string> = {
  dominator: "holding a megaphone, chest puffed out",
  "stille-aanwezigheid": "hiding half behind a coffee cup, tiny speech bubble with three dots",
  vergaderverlenger: "holding up one finger with a sheepish grin, clock showing 5 to the hour",
  parkeerder: "carrying a blue parking sign with a big P under the arm",
  actiepuntenontwijker: "pointing at someone else while sweating",
  "vorige-keer": "holding a dusty old binder labeled 2021",
  "advocaat-duivel": "wearing tiny devil horns and a mischievous grin",
  samenvatter: "holding a notepad, speaking very slowly with half-closed eyes",
  managementtaal: "surrounded by buzzword speech bubbles, pointing at a flipchart",
  bilaatjesman: "holding a calendar full of one-on-one meetings",
  "cc-manager": "with an overflowing email inbox icon floating above the head",
  multitasker: "juggling three phones and a laptop at once",
  "late-binnenkomer": "out of breath, coat half on, holding a to-go coffee",
  voorzitter: "holding a gavel limply, nervous smile",
  agenda: "clutching a printed agenda with a highlighter",
  procesbewaker: "holding a huge flowchart",
  consultant: "presenting a whiteboard with three boxes and two arrows",
  enthousiasteling: "double thumbs up, confetti around",
  realist: "arms crossed, one eyebrow sky high",
  cynicus: "eye roll, holding a mug that says 'sinds 2019'",
  besluituitsteller: "wearing a sleep mask on the forehead, holding a pillow",
  alignment: "holding a spirit level",
  stuurgroepman: "surrounded by tiny org charts",
  rondvraagterrorist: "hand raised with a thick stack of papers",
  laptopdichtklapper: "slamming a laptop shut while looking at a wristwatch",
  "even-een-ding": "holding up one finger, with a very long list trailing to the floor",
  koffieautomaat: "whispering next to a coffee machine",
};


function portraitPrompt(r: Role, fun: boolean) {
  if (fun) {
    const prop = r.cliche ? CLICHE_PROP[r.cliche] : null;
    return `${IMAGE.funStyle}. A funny, affectionate caricature of ${r.uiterlijk}. Profession: ${r.functie}, with an exaggerated, recognizable attribute of that job${prop ? `, ${prop}` : ""}. Personality: ${r.perspectief}. Big expressive face, playful and humorous, like a Dutch office cartoon. Single person, centered, facing the viewer. No text, no letters, no logos.`;
  }
  return `${IMAGE.style}. Portrait of ${r.uiterlijk}. Profession: ${r.functie}, with one subtle, recognizable detail of that job. Personality: ${r.perspectief}. Believable, like a real colleague in a Dutch company. Single person, centered, facing the viewer. No text, no letters, no logos.`;
}

const MOOD_EDIT: Record<"serieus" | "fun", Record<Exclude<Mood, "neutraal">, string>> = {
  serieus: {
    sceptisch:
      "Same person, same face, same outfit, same illustration style and background. Change only the expression to mildly skeptical: one eyebrow slightly raised, lips pressed together, thoughtful look.",
    enthousiast:
      "Same person, same face, same outfit, same illustration style and background. Change only the expression to positive and engaged: a warm, genuine smile, bright eyes.",
  },
  fun: {
    sceptisch:
      "Same person, same face, same outfit, same cartoon style and background. Change only the expression to comically skeptical: one eyebrow raised sky-high, lips pressed sideways, squinting eyes, arms crossed if visible.",
    enthousiast:
      "Same person, same face, same outfit, same cartoon style and background. Change only the expression to over-the-top enthusiastic: huge grin, sparkling wide eyes, eyebrows way up.",
  },
};

async function makePortraits(run: Run, role: Role) {
  const key = portraitKey(role, run.cast);
  const fun = isFun(run.cast);
  // Hergebruik bewaarde portretten uit een template.
  if (role.portraits?.neutraal && role.portraits.sceptisch && role.portraits.enthousiast) {
    await mergePrep(run.id, role.id, { portraitKey: key, portraitStatus: "klaar", portraits: role.portraits });
    return;
  }
  // Oude portretten blijven staan tot de nieuwe klaar zijn.
  await mergePrep(run.id, role.id, { portraitKey: key, portraitStatus: "bezig", portraitStarted: Date.now() });
  try {
    const client = await openaiClient();
    const gen = await client.images.generate({
      model: IMAGE.model,
      prompt: portraitPrompt(role, fun),
      size: IMAGE.size,
      quality: IMAGE.quality,
      output_format: "jpeg",
      output_compression: 85,
      n: 1,
    });
    const b64 = gen.data?.[0]?.b64_json;
    if (!b64) throw new Error("geen afbeelding");
    const neutralBuf = Buffer.from(b64, "base64");
    const base = `${run.id}/${role.id}-${key}`;
    const neutraal = await upload("portraits", `${base}-neutraal.jpg`, neutralBuf, "image/jpeg");
    await mergePrep(run.id, role.id, { portraits: { ...(run.prep[role.id]?.portraits ?? {}), neutraal } });
    let cost = IMAGE.priceUsd;

    // Alleen in de fun-modus tekenen we ook een sceptisch en enthousiast gezicht; serieus volstaat één portret.
    const moods = await Promise.allSettled(
      (fun ? (Object.keys(MOOD_EDIT.serieus) as Exclude<Mood, "neutraal">[]) : []).map(async (mood) => {
        const edit = await client.images.edit({
          model: IMAGE.model,
          image: await toFile(neutralBuf, "neutraal.jpg", { type: "image/jpeg" }),
          prompt: MOOD_EDIT[fun ? "fun" : "serieus"][mood],
          size: IMAGE.size,
          quality: IMAGE.quality,
          output_format: "jpeg",
          output_compression: 85,
        });
        const eb64 = edit.data?.[0]?.b64_json;
        if (!eb64) throw new Error("geen afbeelding");
        cost += IMAGE.priceUsd;
        return [mood, await upload("portraits", `${base}-${mood}.jpg`, Buffer.from(eb64, "base64"), "image/jpeg")] as const;
      }),
    );
    const portraits: Partial<Record<Mood, string>> = { neutraal };
    for (const m of moods) if (m.status === "fulfilled") portraits[m.value[0]] = m.value[1];
    await mergePrep(run.id, role.id, { portraitStatus: "klaar", portraits });
    const u = emptyUsage("openai", IMAGE.model);
    u.units = Object.keys(portraits).length;
    u.costUsd = cost;
    await recordUsage(run.id, "portret", u, role.id);
  } catch (e) {
    console.error("portret mislukt", role.naam, e);
    await mergePrep(run.id, role.id, { portraitStatus: "mislukt" });
  }
}

async function doHomework(run: Run, role: Role, all: Attachment[]) {
  const key = homeworkKey(role, run);
  const mine = attachmentsFor(all, run.cast.bijlages, role.id);
  const looking: string[] = mine.map((a) => `Leest: ${a.name}`);
  await mergePrep(run.id, role.id, {
    homeworkKey: key,
    homeworkStatus: "bezig",
    homeworkStarted: Date.now(),
    looking: looking.slice(-6),
    facts: [],
  });
  try {
    // Huiswerk (lezen en zoeken) doet het snelle model van dezelfde AI: veel goedkoper, en het zijn maar vijf feiten.
    const own = resolveModel(role.modelKey, role.customModel);
    const fast = getModel(FAST_MODEL_KEY[own.provider]);
    const model = !role.customModel && fast && (!role.webzoeken || supportsWebSearch(fast)) ? fast : own;
    let pending: Promise<unknown> = Promise.resolve();
    const { text, usage } = await research(
      {
        model,
        system: roleSystem(run, role, mine, { withFacts: false }),
        images: await attachmentImages(mine),
        instruction: homeworkInstruction(role, mine.length > 0),
        webSearch: role.webzoeken,
        maxTokens: 3000,
        cacheKey: `${run.id}:${role.id}`,
      },
      (label) => {
        looking.push(label);
        pending = pending.then(() => mergePrep(run.id, role.id, { looking: looking.slice(-6) }));
      },
    );
    await pending;
    await recordUsage(run.id, "huiswerk", usage, role.id);
    let facts: { feit: string; bron: string }[] = [];
    try {
      facts = HomeworkSchema.parse(extractJson(text)).feiten;
    } catch {
      facts = [];
    }
    await mergePrep(run.id, role.id, { homeworkStatus: "klaar", facts: facts.slice(0, 5) });
  } catch (e) {
    console.error("huiswerk mislukt", role.naam, e);
    await mergePrep(run.id, role.id, { homeworkStatus: "mislukt" });
  }
}

/**
 * Start wat nog nodig is: portretten voor nieuwe/gewijzigde rollen en huiswerk.
 * Idempotent: kan na elke wijziging opnieuw worden aangeroepen.
 */
export async function prepare(runId: string) {
  const run = await getRun(runId);
  const keys = await availableKeys();
  const all = await runAttachments(runId);
  const jobs: Promise<void>[] = [];
  const now = Date.now();

  for (const role of run.cast.rollen) {
    const p = run.prep[role.id] ?? {};
    const pk = portraitKey(role, run.cast);
    const portraitBusy = p.portraitStatus === "bezig" && now - (p.portraitStarted ?? 0) < STALE_MS;
    if (keys.openai && (p.portraitKey !== pk || p.portraitStatus === "mislukt" || (!p.portraitStatus)) && !(p.portraitKey === pk && portraitBusy)) {
      jobs.push(makePortraits(run, role));
    }
    if (role.isJury) continue;
    const hk = homeworkKey(role, run);
    const homeworkBusy = p.homeworkStatus === "bezig" && now - (p.homeworkStarted ?? 0) < STALE_MS;
    const needsHomework = role.webzoeken || attachmentsFor(all, run.cast.bijlages, role.id).length > 0;
    if (!needsHomework) {
      if (p.homeworkStatus !== "klaar" || p.homeworkKey !== hk) {
        jobs.push(mergePrep(run.id, role.id, { homeworkKey: hk, homeworkStatus: "klaar", facts: [], looking: [] }));
      }
      continue;
    }
    if ((p.homeworkKey !== hk || p.homeworkStatus === "mislukt") && !(p.homeworkKey === hk && homeworkBusy)) {
      jobs.push(doHomework(run, role, all));
    }
  }
  await Promise.allSettled(jobs);
}
