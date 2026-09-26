import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { COMPAT_BASE_URL, MODELS, type ModelConfig, type Provider } from "./config";
import { cleanId, pickModel } from "./model-pick";
import { getKey, getSetting, setSetting } from "./settings";

const TTL = 6 * 3600_000;
type Cache = { at: number; ids: string[] };
const mem = new Map<Provider, Cache>();

function baseURL(provider: "google" | "xai") {
  return (provider === "google" ? process.env.GEMINI_BASE_URL : process.env.XAI_BASE_URL) || COMPAT_BASE_URL[provider];
}

/** Haalt op welke modellen deze sleutel mag gebruiken. */
export async function fetchModelIds(provider: Provider, key: string): Promise<string[]> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: key, maxRetries: 1 });
    const ids: string[] = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  }
  const client = new OpenAI({ apiKey: key, maxRetries: 1, ...(provider === "openai" ? {} : { baseURL: baseURL(provider) }) });
  const ids: string[] = [];
  for await (const m of client.models.list()) ids.push(cleanId(m.id));
  return ids;
}

export async function refreshModels(provider: Provider, key?: string) {
  const k = key ?? (await getKey(provider));
  if (!k) return null;
  const ids = await fetchModelIds(provider, k);
  const c = { at: Date.now(), ids };
  mem.set(provider, c);
  await setSetting(`models_${provider}`, c).catch(() => {});
  return ids;
}

export function forgetModels(provider: Provider) {
  mem.delete(provider);
}

async function modelIds(provider: Provider): Promise<string[] | null> {
  const m = mem.get(provider);
  if (m && Date.now() - m.at < TTL) return m.ids;
  const stored = await getSetting<Cache>(`models_${provider}`).catch(() => null);
  if (stored && Date.now() - stored.at < TTL && stored.ids.length) {
    mem.set(provider, stored);
    return stored.ids;
  }
  try {
    return await refreshModels(provider);
  } catch (e) {
    console.error("modellijst ophalen mislukt", provider, e);
    return stored?.ids ?? null;
  }
}

/** Vervangt een config-model dat deze sleutel niet kent door het best passende beschikbare model. */
export async function liveModel(m: ModelConfig): Promise<ModelConfig> {
  if (m.key.startsWith("custom:")) return m;
  const ids = await modelIds(m.provider);
  if (!ids?.length) return m;
  const picked = pickModel(ids, m);
  return picked === m.model ? m : { ...m, model: picked };
}

/** Welk echt model er per vriendelijke naam gebruikt wordt (voor Instellingen). */
export async function modelMapping(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const m of MODELS) {
    const ids = mem.get(m.provider)?.ids ?? (await getSetting<Cache>(`models_${m.provider}`).catch(() => null))?.ids;
    out[m.key] = ids?.length ? pickModel(ids, m) : m.model;
  }
  return out;
}
