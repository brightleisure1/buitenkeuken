import "server-only";
import { db } from "./supabase";
import { decrypt, encrypt } from "./crypto";
import { AppError } from "./errors";

export type KeyName = "anthropic" | "openai" | "elevenlabs";

const ENV: Record<KeyName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};

export const PROVIDER_LABEL: Record<KeyName, "Anthropic" | "OpenAI" | "ElevenLabs"> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};

let cache: { at: number; keys: Partial<Record<KeyName, string>> } | null = null;

export async function getSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) {
    throw new AppError(
      "We kunnen de database niet bereiken.",
      "Controleer SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY, en of de SQL-migratie is uitgevoerd.",
      503,
    );
  }
  return (data?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown) {
  const { error } = await db()
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new AppError("Opslaan van de instelling lukte niet.", "Controleer of de SQL-migratie is uitgevoerd.");
}

async function loadKeys(): Promise<Partial<Record<KeyName, string>>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.keys;
  const stored = (await getSetting<Partial<Record<KeyName, string>>>("api_keys")) ?? {};
  const keys: Partial<Record<KeyName, string>> = {};
  for (const name of Object.keys(ENV) as KeyName[]) {
    const enc = stored[name];
    const dec = enc ? decrypt(enc) : null;
    const val = dec || process.env[ENV[name]];
    if (val) keys[name] = val;
  }
  cache = { at: Date.now(), keys };
  return keys;
}

export async function getKey(name: KeyName): Promise<string | undefined> {
  return (await loadKeys())[name];
}

export async function requireKey(name: KeyName): Promise<string> {
  const k = await getKey(name);
  if (!k) {
    throw new AppError(
      `Er is nog geen sleutel voor ${PROVIDER_LABEL[name]} ingesteld.`,
      "Ga naar Instellingen en plak je API-sleutel. Klik daarna op 'Test verbinding'.",
    );
  }
  return k;
}

export async function availableKeys(): Promise<Record<KeyName, boolean>> {
  const k = await loadKeys();
  return { anthropic: !!k.anthropic, openai: !!k.openai, elevenlabs: !!k.elevenlabs };
}

export async function saveKeys(input: Partial<Record<KeyName, string | null>>) {
  const stored = (await getSetting<Partial<Record<KeyName, string>>>("api_keys")) ?? {};
  for (const name of Object.keys(input) as KeyName[]) {
    const v = input[name];
    if (v === null || v === "") delete stored[name];
    else if (typeof v === "string") stored[name] = encrypt(v.trim());
  }
  await setSetting("api_keys", stored);
  cache = null;
}

export function mask(key: string | undefined) {
  if (!key) return null;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export async function maskedKeys() {
  const k = await loadKeys();
  return {
    anthropic: mask(k.anthropic),
    openai: mask(k.openai),
    elevenlabs: mask(k.elevenlabs),
  };
}
