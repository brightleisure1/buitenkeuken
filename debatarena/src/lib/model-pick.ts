import type { ModelConfig } from "./config";

/**
 * Kiest uit de modellen die een sleutel echt mag gebruiken het model dat het best past
 * bij wat we in de config vroegen. Staat het gevraagde model in de lijst, dan blijft het.
 */

const SKIP = /(image|imagen|tts|audio|live|embed|vision|realtime|transcribe|search|computer|robotics|guard|moderation|dall|whisper|codex|instruct|aqa|learnlm|gemma|native|thinking-exp|customtools)/i;

function familyOf(m: ModelConfig): { want: RegExp; avoid?: RegExp } {
  switch (m.provider) {
    case "google":
      return m.tier === "snel" ? { want: /^gemini-[\d.]+-flash/, avoid: /lite/ } : { want: /^gemini-[\d.]+-pro/ };
    case "xai":
      return m.tier === "snel" ? { want: /^grok-[\d.]+.*(fast|mini)/ } : { want: /^grok-[\d.]+/, avoid: /(mini|fast|code|beta)/ };
    case "openai":
      return m.tier === "snel" ? { want: /^gpt-[\d.]+-mini$/ } : { want: /^gpt-[\d.]+$/ };
    case "anthropic":
      return m.tier === "snel" ? { want: /^claude-haiku/ } : m.tier === "midden" ? { want: /^claude-sonnet/ } : { want: /^claude-opus/ };
  }
}

function version(id: string): number[] {
  const m = id.match(/-(\d+(?:[.-]\d+)*)/);
  return m ? m[1].split(/[.-]/).map(Number).filter((n) => n < 1000) : [0];
}

function cmpVersion(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Hoe 'rommelig' is een id: preview/exp/datum maken hem minder aantrekkelijk. */
function messiness(id: string) {
  return (/(preview|exp|beta)/i.test(id) ? 2 : 0) + (/-\d{4}-?\d{2}-?\d{2}|-\d{3,4}$/.test(id) ? 1 : 0) + (/latest/.test(id) ? 0.5 : 0);
}

export function cleanId(id: string) {
  return id.replace(/^models\//, "");
}

export function pickModel(available: string[], m: ModelConfig): string {
  const ids = available.map(cleanId);
  if (ids.includes(m.model)) return m.model;
  const fam = familyOf(m);
  let cands = ids.filter((id) => fam.want.test(id) && !SKIP.test(id) && !(fam.avoid && fam.avoid.test(id)));
  // Geen snelle variant? Neem dan de sterke familie van dezelfde aanbieder.
  if (!cands.length && m.tier !== "sterk") {
    return pickModel(available, { ...m, tier: "sterk", model: "__geen__" });
  }
  if (!cands.length) return m.model;
  cands = cands.sort((a, b) => cmpVersion(version(b), version(a)) || messiness(a) - messiness(b) || a.length - b.length);
  // Liever een nette versie dan een preview, tenzij de preview echt nieuwer is.
  return cands[0];
}
