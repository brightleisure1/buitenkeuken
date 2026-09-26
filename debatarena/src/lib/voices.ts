import "server-only";
import { TTS } from "./config";
import { AppError, friendly } from "./errors";
import { getKey, getSetting, requireKey, setSetting } from "./settings";

export interface Voice {
  id: string;
  naam: string;
  omschrijving: string;
}

const API = "https://api.elevenlabs.io/v1";

interface ElVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  description?: string | null;
}

export async function fetchVoices(key: string): Promise<Voice[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key } });
  if (!res.ok) throw friendly({ status: res.status }, "ElevenLabs");
  const json = (await res.json()) as { voices: ElVoice[] };
  return json.voices.map((v) => ({
    id: v.voice_id,
    naam: v.name,
    omschrijving: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description ?? v.labels?.descriptive, v.labels?.use_case]
      .filter(Boolean)
      .join(", "),
  }));
}

/** Stemmenlijst, een uur gecachet. Leeg als er geen ElevenLabs-sleutel is. */
export async function listVoices(): Promise<Voice[]> {
  const key = await getKey("elevenlabs");
  if (!key) return [];
  const cached = await getSetting<{ at: number; voices: Voice[] }>("voices_cache");
  if (cached && Date.now() - cached.at < 3600_000 && cached.voices.length) return cached.voices;
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
