import type { Cast, Message, Mood, Role, ShareSettings, Tag } from "./types";

export const TAGS: Tag[] = ["bezwaar", "akkoord", "voorstel"];

export const TAG_MOOD: Record<Tag, Mood> = {
  bezwaar: "sceptisch",
  akkoord: "enthousiast",
  voorstel: "neutraal",
};

export const TAG_LABEL: Record<Tag, string> = {
  bezwaar: "Bezwaar",
  akkoord: "Akkoord",
  voorstel: "Voorstel",
};

/**
 * Leest de tag aan het begin van een (streamende) tekst.
 * Geeft `pending: true` zolang we nog niet zeker weten of er een tag komt.
 */
export function splitTag(text: string): { tag: Tag | null; rest: string; pending: boolean } {
  const trimmed = text.replace(/^\s+/, "");
  const m = trimmed.match(/^\[\s*(bezwaar|akkoord|voorstel)\s*\]\s*/i);
  if (m) return { tag: m[1].toLowerCase() as Tag, rest: trimmed.slice(m[0].length), pending: false };
  if (trimmed.length < 14 && /^\[?[a-z\s]*\]?$/i.test(trimmed)) return { tag: null, rest: "", pending: true };
  return { tag: null, rest: trimmed, pending: false };
}

const SOURCE_RE = /\s*\((?:bron|bronnen):\s*([^)]+)\)/gi;

/** Haalt "(bron: naam)" uit de tekst en geeft de namen apart terug. */
export function extractSources(text: string): { clean: string; sources: string[] } {
  const sources: string[] = [];
  const clean = text.replace(SOURCE_RE, (_, s: string) => {
    for (const part of s.split(/;|,(?![^,]*\d{4})/)) {
      const name = part.trim();
      if (name && !sources.includes(name)) sources.push(name);
    }
    return "";
  });
  return { clean: clean.replace(/[ \t]+([.,!?])/g, "$1").trim(), sources };
}

export function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Splitst tekst op zinsgrenzen; `rest` is het nog onafgemaakte stuk. */
export function splitSentences(buffer: string): { done: string[]; rest: string } {
  const done: string[] = [];
  // Een grens is leesteken + spatie: pas dan weten we zeker dat de zin af is (niet "3.5").
  const re = /[.!?…]+["')\]]*\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buffer))) {
    const end = m.index + m[0].length;
    const sentence = buffer.slice(last, end).trim();
    if (sentence) done.push(sentence);
    last = end;
  }
  return { done, rest: buffer.slice(last) };
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

// ---------- delen: wegpoetsen en anonimiseren ----------

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redact(text: string, words: string[] | undefined) {
  if (!words?.length) return text;
  let out = text;
  for (const w of words) {
    const word = w.trim();
    if (!word) continue;
    out = out.replace(new RegExp(escapeRe(word), "gi"), (m) => "█".repeat(Math.min(12, Math.max(4, m.length))));
  }
  return out;
}

export function anonName(role: Role) {
  return role.isJury ? "De Jury" : `De ${role.functie.replace(/^(de|het)\s+/i, "").toLowerCase()}`;
}

/** Past de deel-instellingen toe op cast, berichten en losse teksten. */
export function applyShare(cast: Cast, messages: Message[], share: ShareSettings) {
  const nameMap = new Map<string, string>();
  const rollen = cast.rollen.map((r) => {
    const naam = share.anonymous ? anonName(r) : r.naam;
    nameMap.set(r.naam, naam);
    for (const part of r.naam.split(/\s+/)) if (part.length > 2) nameMap.set(part, naam);
    return { ...r, naam, zin: fix(r.zin) };
  });
  function fix(t: string) {
    let out = t;
    if (share.anonymous) {
      const keys = [...nameMap.keys()].sort((a, b) => b.length - a.length);
      for (const k of keys) out = out.replace(new RegExp(`\\b${escapeRe(k)}\\b`, "g"), nameMap.get(k)!);
    }
    return redact(out, share.redactions);
  }
  return {
    cast: { ...cast, rollen },
    messages: messages.map((m) => ({ ...m, content: fix(m.content), sources: m.sources.map(fix) })),
    fix,
  };
}
