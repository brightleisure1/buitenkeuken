import { clicheOf } from "./cliches";
import type { Role } from "./types";

/** Zinnetjes voor tijdens het wachten, in plaats van saaie laadbalkjes. */

const voornaam = (r: Pick<Role, "naam">) => r.naam.replace(/^(mr\.|dr\.|drs\.|ir\.|prof\.)\s*/i, "").split(" ")[0];

const ALGEMEEN = [
  "schraapt de keel",
  "zoekt de juiste woorden",
  "bladert door de aantekeningen",
  "neemt nog snel een slok koffie",
  "zet de bril recht",
  "leunt naar voren",
  "tikt met een pen op tafel",
  "kijkt even de kring rond",
  "haalt diep adem",
  "fronst de wenkbrauwen",
];

const PER_CLICHE: Record<string, string[]> = {
  dominator: ["haalt diep adem voor een lang verhaal", "schuift de stoel wat naar voren", "wil 'even scherp neerzetten'"],
  "stille-aanwezigheid": ["knikt instemmend", "kijkt naar de koekjesschaal", "zegt nog even niks"],
  vergaderverlenger: ["heeft nog 'een klein puntje'", "kijkt op de klok en denkt: kan nog wel"],
  parkeerder: ["zoekt een parkeerplek voor dit onderwerp", "pakt het parkeerbord erbij 🅿️"],
  actiepuntenontwijker: ["kijkt heel geïnteresseerd naar het plafond", "vermijdt oogcontact met de actielijst"],
  "vorige-keer": ["duikt in het archief van 2021", "weet zeker dat dit al eens geprobeerd is"],
  "advocaat-duivel": ["trekt de toga van de duivel aan 😈"],
  samenvatter: ["schrijft op wat de vorige spreker zei", "zet het nog even rustig op een rijtje"],
  managementtaal: ["zoekt een nog groter woord dan 'borgen'", "laat de woorden eerst even landen"],
  bilaatjesman: ["plant alvast een bilaatje in", "trekt de agenda erbij 📅"],
  "cc-manager": ["leest de mailthread nog even door", "zet zichzelf in de cc"],
  multitasker: ["typt nog even een mailtje af", "kijkt op van het scherm: 'wat was de vraag?'"],
  "late-binnenkomer": ["hangt de jas op", "zoekt nog een stoel 🪑", "is er bijna"],
  voorzitter: ["kijkt zorgelijk op de klok", "laat het nog even lopen"],
  agenda: ["checkt de agenda nog een keer", "zoekt dit punt op de agenda"],
  procesbewaker: ["tekent een stroomschema", "vraagt zich af wie er mandaat heeft"],
  consultant: ["tekent drie vakjes en twee pijlen", "bedenkt een Engelse naam voor het framework"],
  enthousiasteling: ["kan niet stilzitten van enthousiasme", "heeft al drie ideeën"],
  realist: ["rekent uit wie dat allemaal moet doen"],
  cynicus: ["zucht diep", "denkt terug aan 2019"],
  besluituitsteller: ["slaapt er alvast een nachtje over 😴"],
  alignment: ["checkt of iedereen aligned is"],
  stuurgroepman: ["richt alvast een werkgroep op"],
  rondvraagterrorist: ["wacht geduldig op de rondvraag"],
  laptopdichtklapper: ["kijkt op de klok", "legt de oplader alvast klaar"],
  "even-een-ding": ["heeft 'even één ding' (of vier)"],
  koffieautomaat: ["bewaart het echte verhaal voor bij de koffieautomaat ☕"],
};

/** "Markus zoekt een parkeerplek voor dit onderwerp…" */
export function turnWaitLines(role: Role): string[] {
  const naam = voornaam(role);
  const extra = PER_CLICHE[clicheOf(role)?.id ?? ""] ?? [];
  const eigen = role.isJury ? ["legt de hamer klaar 🔨", "ordent de aantekeningen", "kijkt de tafel rond"] : [];
  const pool = [...extra, ...extra, ...eigen, ...ALGEMEEN];
  const start = [...naam].reduce((s, c) => s + c.charCodeAt(0), 0) % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)].map((a) => `${naam} ${a}…`);
}

export const CASTING_LINES = [
  "📋 De castingdirecteur bladert door stapels cv's…",
  "🔍 We zoeken een kritische klant met een scherpe pen…",
  "🎭 De rollen worden verdeeld…",
  "☕ Iemand zet alvast koffie…",
  "🪑 De stoelen worden rechtgezet…",
  "🗂️ Naambordjes worden geprint…",
  "📎 De bijlages worden geniet…",
  "🍪 Er wordt een schaaltje koekjes neergezet…",
];

/** Zinnetjes over wie er nog bezig is met de voorbereiding (alleen die mensen). */
export function prepLines(pending: Role[]): string[] {
  if (!pending.length) return ["✅ Iedereen is klaar, we beginnen…"];
  const lines = (n: string) => [
    `🔎 ${n} zoekt nog iets op internet…`,
    `📚 ${n} leest de stukken nog even door…`,
    `🗒️ ${n} maakt spiekbriefjes…`,
    `🧮 ${n} rekent iets uit op de achterkant van een envelop…`,
  ];
  const per = pending.map((r) => lines(voornaam(r)));
  // Om en om, zodat je iedereen die nog bezig is voorbij ziet komen.
  return per[0].flatMap((_, i) => per.map((l) => l[i]));
}

export const JURY_LINES = [
  "🗒️ De voorzitter bladert door de aantekeningen…",
  "🔨 De hamer wordt gepoetst…",
  "📜 De notulen worden uitgetikt…",
  "🧮 De voorzitter weegt de argumenten…",
  "🍪 Er wordt nog één koekje gegeten…",
  "🗳️ De stemmen worden geteld…",
  "📎 Alles wordt netjes aan elkaar geniet…",
];

export const LOADING_LINES = ["🪑 De vergaderzaal wordt klaargezet…", "💡 Het licht gaat aan…", "☕ Het koffieapparaat warmt op…"];

export const AUDIO_LINES = [
  "🎙️ De microfoons worden getest…",
  "🎧 De opname wordt gemonteerd…",
  "🔊 Iedereen spreekt zijn tekst in…",
  "✂️ De stiltes worden eruit geknipt…",
];
