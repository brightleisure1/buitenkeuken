/**
 * Alle modellen en prijzen op één plek.
 *
 * Prijzen zijn in US-dollars per miljoen tokens (zoals de aanbieders ze publiceren)
 * en worden in de app omgerekend naar euro's met USD_TO_EUR.
 * Controleer ze af en toe; aanbieders passen prijzen aan.
 */

export type Provider = "anthropic" | "openai" | "google" | "xai";

/** Hoe de aanbieder in de UI heet, met een eigen kleur zodat je ziet wie wie is. */
export const PROVIDERS: Record<Provider, { naam: string; kleur: string; tekst: string }> = {
  anthropic: { naam: "Claude", kleur: "#D97757", tekst: "#ffffff" },
  openai: { naam: "ChatGPT", kleur: "#10A37F", tekst: "#ffffff" },
  google: { naam: "Gemini", kleur: "#4285F4", tekst: "#ffffff" },
  xai: { naam: "Grok", kleur: "#111111", tekst: "#ffffff" },
};

/** Gemini en Grok praten we aan via hun OpenAI-compatibele API. */
export const COMPAT_BASE_URL: Partial<Record<Provider, string>> = {
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
  xai: "https://api.x.ai/v1",
};

export interface ModelConfig {
  key: string;
  /** Vriendelijke naam in de UI */
  label: string;
  provider: Provider;
  /** Modelnaam zoals de aanbieder hem kent */
  model: string;
  /** USD per 1M tokens */
  inputPrice: number;
  outputPrice: number;
  /** Anthropic: web search tool-type (OpenAI zoekt altijd; Gemini/Grok niet) */
  webSearchTool?: string;
  /** Anthropic: effort-niveau voor debatbeurten (null = niet ondersteund) */
  effort?: "low" | "medium" | "high" | null;
  /** OpenAI/Gemini: reasoning-effort voor debatbeurten (null = niet meesturen) */
  reasoning?: "minimal" | "low" | "medium" | "high" | null;
  /** Deel van de inputprijs dat gecachete input kost (standaard 10%) */
  cachedFactor?: number;
  tier: "sterk" | "midden" | "snel";
}

export const MODELS: ModelConfig[] = [
  {
    key: "claude-sterk",
    label: "Claude, sterkste",
    provider: "anthropic",
    model: "claude-opus-5",
    inputPrice: 5,
    outputPrice: 25,
    webSearchTool: "web_search_20260209",
    effort: "low",
    tier: "sterk",
  },
  {
    key: "claude-midden",
    label: "Claude, snel en slim",
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputPrice: 2,
    outputPrice: 10,
    webSearchTool: "web_search_20260209",
    effort: "low",
    tier: "midden",
  },
  {
    key: "claude-snel",
    label: "Claude, bliksemsnel",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    inputPrice: 1,
    outputPrice: 5,
    webSearchTool: "web_search_20250305",
    effort: null,
    tier: "snel",
  },
  {
    key: "gpt-sterk",
    label: "GPT, sterkste",
    provider: "openai",
    model: "gpt-5.5",
    inputPrice: 5,
    outputPrice: 30,
    reasoning: "low",
    tier: "sterk",
  },
  {
    key: "gpt-snel",
    label: "GPT, bliksemsnel",
    provider: "openai",
    model: "gpt-5.4-mini",
    inputPrice: 0.75,
    outputPrice: 4.5,
    reasoning: "low",
    tier: "snel",
  },
  // Prijzen Gemini en Grok: stand september 2026, controleer ze af en toe.
  {
    key: "gemini-sterk",
    label: "Gemini, sterkste",
    provider: "google",
    model: "gemini-3.1-pro",
    inputPrice: 2,
    outputPrice: 12,
    reasoning: "low",
    tier: "sterk",
  },
  {
    key: "gemini-snel",
    label: "Gemini, bliksemsnel",
    provider: "google",
    model: "gemini-3.8-flash",
    inputPrice: 0.75,
    outputPrice: 3.75,
    reasoning: "low",
    tier: "snel",
  },
  {
    key: "grok-sterk",
    label: "Grok, sterkste",
    provider: "xai",
    model: "grok-4.7",
    inputPrice: 2,
    outputPrice: 6,
    cachedFactor: 0.25,
    reasoning: null,
    tier: "sterk",
  },
  {
    key: "grok-snel",
    label: "Grok, bliksemsnel",
    provider: "xai",
    model: "grok-4.3",
    inputPrice: 1.25,
    outputPrice: 2.5,
    reasoning: null,
    tier: "snel",
  },
];

/** Het snelle model dat de cast samenstelt, de chat afhandelt en hoogtepunten kiest. */
export const FAST_MODEL_KEY: Record<Provider, string> = { anthropic: "claude-snel", openai: "gpt-snel", google: "gemini-snel", xai: "grok-snel" };

/** Anthropic prompt caching: lezen kost 10%, schrijven 125% van de inputprijs. */
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;
/** OpenAI rekent gecachte input tegen ongeveer 10% van de inputprijs. */
export const OPENAI_CACHED_FACTOR = 0.1;

/** Anthropic web search: $10 per 1000 zoekopdrachten. */
export const WEB_SEARCH_PRICE_USD = 0.01;

export const IMAGE = {
  model: "gpt-image-1",
  size: "1024x1024" as const,
  quality: "low" as const,
  /** USD per portret (lage kwaliteit, vierkant) */
  priceUsd: 0.011,
  style:
    "flat illustration, bold outlines, pastel background, head and shoulders, expressive face. Funny exaggerated caricature in the style of a newspaper cartoon: oversized head on a small body, comically exaggerated signature features",
};

export const TTS = {
  /** Snelste ElevenLabs-model */
  model: "eleven_flash_v2_5",
  outputFormat: "mp3_44100_64",
  /** USD per 1000 tekens (schatting o.b.v. gangbare bundels) */
  pricePer1kChars: 0.05,
};

/**
 * Uitspraak: het snelle model laat Nederlands soms Vlaams klinken;
 * het multilingual-model houdt het accent van de stem beter vast.
 */
export const TTS_MODELS = {
  nederlands: { naam: "Beste Nederlands", model: "eleven_multilingual_v2", pricePer1kChars: 0.1 },
  snel: { naam: "Snelst", model: "eleven_flash_v2_5", pricePer1kChars: 0.05 },
} as const;
export type TtsKeuze = keyof typeof TTS_MODELS;
export const DEFAULT_TTS: TtsKeuze = "nederlands";

export const STT = {
  model: "gpt-4o-mini-transcribe",
  /** USD per minuut audio */
  pricePerMinute: 0.003,
};

export const USD_TO_EUR = 0.86;

export const DEFAULT_ROUNDS = 3;
export const MAX_ROUNDS = 6;
/** Beurtlengte in woorden */
export const WORDS_NORMAL = 130;
export const WORDS_VOICE = 80;

export function getModel(key: string | null | undefined): ModelConfig | undefined {
  return MODELS.find((m) => m.key === key);
}

/** Bepaalt het model voor een rol: vrij veld (Geavanceerd) wint van de vriendelijke keuze. */
export function resolveModel(modelKey: string, customModel?: string | null): ModelConfig {
  const base = getModel(modelKey) ?? MODELS[0];
  const custom = customModel?.trim();
  if (!custom) return base;
  const provider: Provider = /^(gpt|o\d|chatgpt)/i.test(custom)
    ? "openai"
    : /^claude/i.test(custom)
      ? "anthropic"
      : /^gemini/i.test(custom)
        ? "google"
        : /^grok/i.test(custom)
          ? "xai"
          : base.provider;
  const known = MODELS.find((m) => m.model === custom);
  if (known) return known;
  return {
    ...base,
    key: `custom:${custom}`,
    label: custom,
    provider,
    model: custom,
    webSearchTool: provider === "anthropic" ? "web_search_20250305" : undefined,
    effort: null,
    reasoning: (provider === "openai" && /^(gpt-5|o\d)/i.test(custom)) || provider === "google" ? "low" : null,
  };
}

/** Kan dit model zelf op het web zoeken? (Gemini en Grok via de compatibele API niet.) */
export function supportsWebSearch(m: ModelConfig) {
  return m.provider === "openai" || (m.provider === "anthropic" && !!m.webSearchTool);
}

/** Welke AI speelt deze rol? Voor het label in de UI. */
export function providerOf(role: { modelKey: string; customModel?: string | null }) {
  return PROVIDERS[resolveModel(role.modelKey, role.customModel).provider];
}

export function usdToEur(usd: number) {
  return usd * USD_TO_EUR;
}
