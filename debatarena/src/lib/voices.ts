import "server-only";
import { TTS } from "./config";
import { AppError, friendly } from "./errors";
import { getKey, getSetting, requireKey, setSetting } from "./settings";

export interface Voice {
  id: string;
  naam: string;
  omschrijving: string;
  /** Spreekt (ook) Nederlands */
  nl: boolean;
  /** Eigen/toegevoegde stem (geen standaard ElevenLabs-stem) */
  eigen: boolean;
  gender: "man" | "vrouw" | null;
  preview: string | null;
}

const API = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1";

interface ElVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string | null;
  preview_url?: string | null;
  verified_languages?: { language?: string; accent?: string; locale?: string }[];
  fine_tuning?: { language?: string | null } | null;
}

const NL = /\b(nl|nl-nl|nl-be|dutch|nederlands|netherlands|flemish|vlaams|belgian)\b/i;

export function isDutch(v: ElVoice) {
  const l = v.labels ?? {};
  return (
    NL.test(`${l.language ?? ""} ${l.accent ?? ""} ${l.description ?? ""}`) ||
    (v.verified_languages ?? []).some((x) => /^nl/i.test(x.language ?? "") || /^nl/i.test(x.locale ?? "") || NL.test(x.accent ?? "")) ||
    /^nl/i.test(v.fine_tuning?.language ?? "") ||
    NL.test(v.name) ||
    NL.test(v.description ?? "")
  );
}

export async function fetchVoices(key: string): Promise<Voice[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key } });
  if (!res.ok) throw friendly({ status: res.status }, "ElevenLabs");
  const json = (await res.json()) as { voices: ElVoice[] };
  return json.voices
    .map((v) => {
      const g = (v.labels?.gender ?? "").toLowerCase();
      return {
        id: v.voice_id,
        naam: v.name,
        omschrijving: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description ?? v.labels?.descriptive, v.labels?.use_case]
          .filter(Boolean)
          .join(", "),
        nl: isDutch(v),
        eigen: (v.category ?? "premade") !== "premade",
        gender: g.startsWith("m") ? ("man" as const) : g.startsWith("f") || g.startsWith("v") ? ("vrouw" as const) : null,
        preview: v.preview_url ?? null,
      };
    })
    .sort((a, b) => Number(b.nl) - Number(a.nl) || Number(b.eigen) - Number(a.eigen) || a.naam.localeCompare(b.naam));
}

/** Alle stemmen uit je ElevenLabs-bibliotheek, een uur gecachet. Leeg zonder sleutel. */
export async function listVoices(): Promise<Voice[]> {
  const key = await getKey("elevenlabs");
  if (!key) return [];
  const cached = await getSetting<{ at: number; voices: Voice[] }>("voices_cache");
  if (cached && Date.now() - cached.at < 3600_000 && cached.voices.length && "nl" in cached.voices[0]) return cached.voices;
  try {
    const voices = await fetchVoices(key);
    await setSetting("voices_cache", { at: Date.now(), voices });
    return voices;
  } catch (e) {
    if (cached?.voices.length) return cached.voices;
    console.error("stemmen ophalen mislukt", e);
    return [];
  }
}

export async function refreshVoices(): Promise<Voice[]> {
  await setSetting("voices_cache", { at: 0, voices: [] });
  return listVoices();
}

/**
 * De stemmen die de Debatarena mag gebruiken:
 * je eigen keuze bij Instellingen, anders je Nederlandse stemmen, anders je eigen stemmen, anders alles.
 */
export async function debateVoices(): Promise<Voice[]> {
  const all = await listVoices();
  const chosen = await getSetting<string[]>("voice_selection");
  if (chosen?.length) {
    const picked = all.filter((v) => chosen.includes(v.id));
    if (picked.length) return picked;
  }
  const nl = all.filter((v) => v.nl);
  if (nl.length) return nl;
  const eigen = all.filter((v) => v.eigen);
  return eigen.length ? eigen : all;
}

/** Start een ElevenLabs-stream voor één zin. */
export async function ttsStream(voiceId: string, text: string): Promise<Response> {
  const key = await requireKey("elevenlabs");
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${TTS.outputFormat}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: TTS.model, language_code: "nl" }),
  });
  if (!res.ok || !res.body) {
    if (res.status === 422 || res.status === 400) {
      throw new AppError("Deze stem kon de zin niet uitspreken.", "Kies bij Geavanceerd een andere stem voor deze rol.");
    }
    throw friendly({ status: res.status }, "ElevenLabs");
  }
  return res;
}
