import "server-only";
import { toFile } from "openai";
import { IMAGE, resolveModel } from "./config";
import { attachmentImages, attachmentsFor, runAttachments } from "./attachments";
import { extractJson, openaiClient, research } from "./llm";
import { homeworkInstruction, roleSystem } from "./prompts";
import { getRun, mergePrep } from "./runs";
import { emptyUsage } from "./usage";
import { recordUsage } from "./usage-db";
import { HomeworkSchema } from "./schemas";
import { availableKeys } from "./settings";
import { upload } from "./supabase";
import type { Attachment, Mood, Role, Run } from "./types";

const STALE_MS = 4 * 60_000;

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Het cliché hoort niet meer bij het portret; het lege laatste veld houdt bestaande sleutels gelijk.
export const portraitKey = (r: Role) => hash(`v2|${r.naam}|${r.functie}|${r.uiterlijk}|`);

export const homeworkKey = (r: Role, run: Run) =>
  hash(`${r.perspectief}|${r.instructie}|${r.webzoeken}|${r.modelKey}|${r.customModel ?? ""}|${JSON.stringify(run.cast.bijlages)}`);

function portraitPrompt(r: Role) {
  return `${IMAGE.style}. Portrait of ${r.uiterlijk}. Profession: ${r.functie}, with one subtle, recognizable detail of that job. Personality: ${r.perspectief}. Believable, like a real colleague in a Dutch company. Single person, centered, facing the viewer. No text, no letters, no logos.`;
}

const MOOD_EDIT: Record<Exclude<Mood, "neutraal">, string> = {
  sceptisch:
    "Same person, same face, same outfit, same illustration style and background. Change only the expression to mildly skeptical: one eyebrow slightly raised, lips pressed together, thoughtful look.",
  enthousiast:
    "Same person, same face, same outfit, same illustration style and background. Change only the expression to positive and engaged: a warm, genuine smile, bright eyes.",
};

async function makePortraits(run: Run, role: Role) {
  const key = portraitKey(role);
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
      prompt: portraitPrompt(role),
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

    const moods = await Promise.allSettled(
      (Object.keys(MOOD_EDIT) as (keyof typeof MOOD_EDIT)[]).map(async (mood) => {
        const edit = await client.images.edit({
          model: IMAGE.model,
          image: await toFile(neutralBuf, "neutraal.jpg", { type: "image/jpeg" }),
          prompt: MOOD_EDIT[mood],
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
    const model = resolveModel(role.modelKey, role.customModel);
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
    const pk = portraitKey(role);
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
