export type KeyProvider = "anthropic" | "openai" | "google" | "xai" | "elevenlabs";

export const KEY_INFO: Record<KeyProvider, { naam: string; waarvoor: string; waar: string; url: string; ai: boolean; begin: string }> = {
  anthropic: {
    naam: "Anthropic (Claude)",
    waarvoor: "Claude-rollen, het samenstellen van het team en de Jury.",
    waar: "console.anthropic.com → API Keys",
    url: "https://console.anthropic.com/settings/keys",
    ai: true,
    begin: "sk-ant-",
  },
  openai: {
    begin: "sk-",
    naam: "OpenAI (ChatGPT)",
    waarvoor: "ChatGPT-rollen, de portretten en inspreken als je browser dat niet zelf kan.",
    waar: "platform.openai.com → API keys",
    url: "https://platform.openai.com/api-keys",
    ai: true,
  },
  google: {
    naam: "Google (Gemini)",
    waarvoor: "Gemini-rollen.",
    waar: "aistudio.google.com → Get API key",
    url: "https://aistudio.google.com/apikey",
    ai: true,
    begin: "AIza",
  },
  xai: {
    begin: "xai-",
    naam: "xAI (Grok)",
    waarvoor: "Grok-rollen, gecensureerd of ongecensureerd.",
    waar: "console.x.ai → API Keys",
    url: "https://console.x.ai",
    ai: true,
  },
  elevenlabs: {
    naam: "ElevenLabs (stemmen)",
    waarvoor: "De rollen praten hardop. Optioneel.",
    waar: "elevenlabs.io → Profiel → API Keys",
    url: "https://elevenlabs.io/app/settings/api-keys",
    ai: false,
    begin: "sk_",
  },
};

/** Herkent de aanbieder aan de vorm van de sleutel. */
export function detectProvider(raw: string): KeyProvider | null {
  const k = raw.trim();
  if (/^sk-ant-/i.test(k)) return "anthropic";
  if (/^xai-/i.test(k)) return "xai";
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return "google";
  if (/^sk_[0-9a-f]{32,}$/i.test(k) || /^[0-9a-f]{32}$/i.test(k)) return "elevenlabs";
  if (/^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/.test(k)) return "openai";
  return null;
}

/** Past deze sleutel bij de gekozen aanbieder? Geeft een waarschuwing in gewone taal, of null. */
export function keyWarning(provider: KeyProvider, raw: string): string | null {
  const k = raw.trim();
  if (!k) return null;
  const found = detectProvider(k);
  if (found === provider) return null;
  const info = KEY_INFO[provider];
  if (found) return `Dit lijkt een sleutel van ${KEY_INFO[found].naam}, niet van ${info.naam}. Een sleutel van ${info.naam.split(" (")[0]} begint met "${info.begin}".`;
  return `Dit ziet er niet uit als een sleutel van ${info.naam}. Die begint meestal met "${info.begin}". Je haalt hem op ${info.waar}.`;
}

export interface KeyStatus {
  ok: boolean;
  at: string;
  melding: string;
}
