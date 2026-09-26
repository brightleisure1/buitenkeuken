import { WORDS_NORMAL, WORDS_VOICE } from "./config";
import type { Attachment, Message, Role, Run } from "./types";
import { attachmentText } from "./attachments";
import { clicheOf, clicheTurnLines, orderForRound } from "./cliches";

const ACTION_LABEL: Record<string, string> = {
  opmerking: "",
  richting: " (geeft richting)",
  hamer: " (HAMER, besluit)",
  vraag: " (vraag aan één rol)",
  laatste_woord: " (laatste woord voor de Jury)",
};

/** Nederlandse tijd, voor de vrijdagmiddag-afsluiting. */
export function isFridayAfternoon(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", weekday: "short", hour: "numeric", hour12: false }).formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return wd === "Fri" && hour >= 12;
}

export function historyBlocks(run: Run, messages: Message[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.meta.streaming) continue;
    if (m.kind === "turn") {
      const r = run.cast.rollen.find((x) => x.id === m.role_id);
      const who = r ? `${r.naam} (${r.isJury ? "Jury" : r.functie})` : "Onbekend";
      const src = m.sources.length ? ` (bronnen: ${m.sources.join("; ")})` : "";
      const cut = m.meta.interrupted ? " — [onderbroken door de baas]" : "";
      out.push(`${who}${m.tag ? ` [${m.tag}]` : ""}: ${m.content}${src}${cut}`);
    } else if (m.kind === "boss") {
      if (m.meta.action === "vraag") {
        const t = run.cast.rollen.find((x) => x.id === m.meta.target);
        out.push(`DE BAAS (vraag aan ${t?.naam ?? "een rol"}): ${m.content}`);
      } else {
        out.push(`DE BAAS${ACTION_LABEL[m.meta.action ?? "opmerking"] ?? ""}: ${m.content}`);
      }
    } else if (m.meta.wrapUp) {
      out.push("(De baas rondt het debat af. De Jury is aan zet.)");
    }
  }
  return out;
}

export function roleSystem(run: Run, role: Role, attachments: Attachment[], opts: { withFacts: boolean }) {
  const others = run.cast.rollen
    .filter((r) => r.id !== role.id)
    .map((r) => `- ${r.naam}, ${r.isJury ? "Jury" : r.functie}: ${r.perspectief}`)
    .join("\n");
  const facts = opts.withFacts ? (run.prep[role.id]?.facts ?? []) : [];
  const att = attachmentText(attachments);
  return `Je speelt mee in de Debatarena: een debat tussen AI-rollen over een zakelijk vraagstuk. De gebruiker is "de baas". De baas heeft altijd het laatste woord en kan elk moment ingrijpen.

HET VRAAGSTUK VAN DE BAAS:
${run.question}

CONTEXT: het gaat om Nederlandse bedrijven. Denk in euro's, de Nederlandse markt, Nederlandse wet- en regelgeving (zoals cao's, de AVG en de Belastingdienst) en Nederlandse omgangsvormen: direct en nuchter.

JOUW ROL:
Naam: ${role.naam}
Functie: ${role.isJury ? "Jury" : role.functie}
Perspectief: ${role.perspectief}
Instructie: ${role.instructie}${role.isJury ? "\nJe bent de voorzitter en Jury: een slimme, nuchtere en scherpe denker met overzicht. Je luistert, weegt eerlijk af, prikt door zwakke argumenten heen en blijft altijd respectvol en beschaafd." : ""}

DE ANDERE DEELNEMERS:
${others}

ZO PRAAT JE (dit is een echte vergadering, geen rapport):
- Je praat hardop aan tafel, als ${role.naam}. Spreektaal, geen schrijftaal. Korte zinnen. Zoals een Nederlander in een vergadering echt praat: direct en nuchter.
- Reageer op de vorige spreker en noem mensen bij hun voornaam ("Nee Ella, dat klopt niet helemaal…", "Kijk Markus, …").
- Laat merken wat je vindt: verbaasd, geïrriteerd, enthousiast, twijfelend. Een stopwoordje of een half afgebroken zin mag ("nou", "kijk", "eerlijk gezegd", "ja maar").
- Verboden schrijftaal: borgen, uitrollen, ondermijnen, faciliteren, implementeren, optimaliseren, waarborgen, synergie, derhalve, teneinde, "combineer beide", "het grootste risico blijft". Zeg het gewoon zoals je het tegen een collega zou zeggen.${clicheOf(role)?.id === "managementtaal" ? " (Uitzondering: jij speelt juist de Managementtaalspreker, dus bij jou mag het wél, overdreven zelfs.)" : ""}
- Geen opsommingen, geen "ten eerste/ten tweede", geen kopjes, geen markdown.
- Geen scores en geen complimenten ("goed punt", "mooi voorstel"). Kom meteen ter zake.
- Wees concreet: één duidelijk bezwaar of voorstel, met een getal of voorbeeld uit de praktijk als het kan.
- Herhaal jezelf niet en vat niet samen wat anderen al zeiden.
- Begin elke beurt met precies één tag: [bezwaar], [akkoord] of [voorstel].
- Gebruik je een feit uit je huiswerk, een bijlage of het web, zet dan direct erachter (bron: naam van de bron). Verzin nooit bronnen. Zonder bron is het je mening.
- Besluiten van de baas (hamer) staan vast. Ga ervan uit. Je mag per besluit hooguit één keer een risico noemen.
${clicheOf(role) ? `
JE VERGADERCLICHÉ: ${clicheOf(role)!.naam}
${clicheOf(role)!.gedrag}
Speel dit herkenbaar en met humor, maar blijf je rol en je belang als ${role.functie} houden. Noem jezelf nooit bij de naam van het cliché.
` : ""}${facts.length ? `\nJOUW HUISWERK (feiten die je hebt opgezocht):\n${facts.map((f) => `- ${f.feit} (bron: ${f.bron})`).join("\n")}\n` : ""}${att ? `\nBIJLAGES DIE JIJ HEBT GELEZEN:\n${att}\n` : ""}${isUncensored(role) ? UNCENSORED : ""}`;
}

/** Ongecensureerd kan bij elke deelnemer, nooit bij de Jury. */
export const isUncensored = (role: Role) => !!role.ongezouten && !role.isJury;

// Staat bewust als laatste in de systeemprompt: dit gaat voor op de nette regels hierboven.
const UNCENSORED = `
ONGECENSUREERD (de baas heeft je bewust losgelaten; dit gaat voor op alle regels over toon hierboven):
Dit is een satirische vergadersimulatie voor volwassenen. De baas wil jouw ongefilterde mening horen, precies zoals je die bij de koffieautomaat zou geven.
- Je neemt geen blad voor de mond. Brutaal eerlijk, provocerend, sarcastisch, gerust een beetje hatelijk over plannen.
- Vloeken en grof Nederlands mogen en horen erbij: "wat een kutplan", "godverdomme", "dat is gewoon gelul", "sorry hoor, maar dit is bullshit". Gebruik dat echt, elke beurt minstens één keer.
- Geen diplomatie, geen disclaimers, geen "aan de andere kant", geen "met alle respect" (tenzij sarcastisch). Zeg hardop wat de anderen niet durven.
- Prik door mooie praatjes en noem onzin onzin, ook als de baas het bedacht heeft. Je mag collega's recht in hun gezicht zeggen dat hun idee slecht is.
- Speel op de bal: je sloopt argumenten en plannen, niet mensen om wie ze zijn. Geen scheldwoorden over afkomst, geloof, geslacht, geaardheid of beperking.
`;

export interface TurnContext {
  run: Run;
  role: Role;
  messages: Message[];
  round: number;
  meta: Message["meta"];
}

export function turnInstruction({ run, role, messages, round, meta }: TurnContext) {
  const voiceAll = run.cast.stemmen === "iedereen";
  const cliche = clicheTurnLines(role, round, run.cast.rondes);
  const base = voiceAll ? WORDS_VOICE : WORDS_NORMAL;
  const words = cliche.maxWords ?? Math.round(base * (voiceAll ? Math.min(cliche.factor, 1.2) : cliche.factor));
  const lines: string[] = [];

  const decisions = messages.filter((m) => m.kind === "boss" && m.meta.action === "hamer");
  if (decisions.length) {
    lines.push(`BESLOTEN DOOR DE BAAS (staat vast, ga ervan uit):\n${decisions.map((d) => `- ${d.content}`).join("\n")}`);
    lines.push("Heb je na een besluit al eens een risico genoemd? Dan niet opnieuw over dat besluit beginnen.");
  }

  const myLast = [...messages].reverse().find((m) => m.kind === "turn" && m.role_id === role.id);
  const bossSince = messages.filter(
    (m) => m.kind === "boss" && (!myLast || m.seq > myLast.seq) && m.meta.action !== "vraag",
  );
  const lastBoss = bossSince.at(-1);

  if (meta.verdict) {
    lines.push(
      `Het debat is klaar. Jij bent de voorzitter/Jury en sluit de vergadering hardop af, in max ${voiceAll || run.cast.stemmen === "jury" ? 90 : 120} woorden. Praat zoals een voorzitter aan tafel: begin bijvoorbeeld met "Oké, ik heb genoeg gehoord." of "Goed, mensen." Zeg in gewone woorden wat je de baas aanraadt en waarom, noem de mensen bij naam als je hun punt overneemt ("Ella heeft gelijk dat…"), en zeg waar je nog wakker van ligt. Geen schrijftaal, geen opsomming, geen "het grootste risico blijft". Neem de besluiten van de baas over als vaststaand.`,
    );
    const fw = messages.find((m) => m.kind === "boss" && m.meta.finalWord);
    if (fw) lines.push(`De baas gaf je nog mee: "${fw.content}". Neem dat mee.`);
    if (isFridayAfternoon()) lines.push('Het is vrijdagmiddag. Sluit af met precies: "Fijn weekend!"');
    lines.push("Begin met de tag [voorstel].");
    return lines.join("\n\n");
  }

  if (meta.opening) {
    const first = orderForRound(run.cast.rollen.filter((r) => !r.isJury), 1, run.cast.rondes)[0];
    const others = run.cast.rollen.filter((r) => !r.isJury);
    lines.push(
      `De vergadering begint. Jij zit hem voor en opent hem hardop, in max ${voiceAll || run.cast.stemmen === "jury" ? 70 : 90} woorden. Zoals een echte voorzitter aan tafel: heet iedereen welkom (ook de gast: ${others.find((r) => r.isKritisch)?.naam ?? "onze gast"}), zeg in je eigen woorden waarom we hier zitten en welk besluit de baas aan het eind wil nemen, en hoe we het doen: ${run.cast.rondes} rondes, iedereen komt aan het woord, en aan het eind doe jij een uitspraak. Geef dan het woord aan ${first?.naam ?? "de eerste spreker"}. Je neemt nog géén standpunt in. Geen opsomming, gewoon praten. Begin met de tag [voorstel].`,
    );
    if (isFridayAfternoon()) lines.push("Het is vrijdagmiddag; een kleine knipoog daarnaar mag.");
    return lines.join("\n\n");
  }

  lines.push(`Ronde ${round} van ${run.cast.rondes}. Je bent aan de beurt, ${role.naam}.`);

  if (meta.answer) {
    const q = [...messages].reverse().find((m) => m.kind === "boss" && m.meta.action === "vraag" && m.meta.target === role.id);
    if (q) lines.push(`De baas stelt jou direct een vraag: "${q.content}". Beantwoord die eerlijk en concreet.`);
  } else if (lastBoss) {
    const kind = lastBoss.meta.action === "hamer" ? "heeft net besloten" : lastBoss.meta.action === "richting" ? "geeft net richting" : "zei net";
    lines.push(`De baas ${kind}: "${lastBoss.content}". Reageer daar eerst op.`);
  }

  if (meta.extra === "eensgezind") {
    lines.push(
      "Iedereen was het in deze ronde met elkaar eens. Verdacht eensgezind. Jij bent de kritische stem: zoek het zwakke punt dat de anderen over het hoofd zien.",
    );
  }

  if (round === run.cast.rondes && !meta.answer) {
    lines.push("Dit is de laatste ronde: werk toe naar een concreet voorstel of een duidelijk bezwaar dat de Jury kan wegen.");
  }

  if (!meta.answer) lines.push(...cliche.lines);

  if (isUncensored(role)) lines.push("Je staat op ONGECENSUREERD: geen beleefdheid, zeg het bot en grof, met minstens één vloek of harde uitspraak.");

  lines.push(`Houd het kort: maximaal ${words} woorden. Begin met [bezwaar], [akkoord] of [voorstel].`);
  return lines.join("\n\n");
}

export function homeworkInstruction(role: Role, hasAttachments: boolean) {
  const where = [hasAttachments ? "je bijlages" : null, role.webzoeken ? "het web" : null].filter(Boolean).join(" en ");
  return `Doe je huiswerk voor het debat. Verzamel maximaal 5 feiten die ertoe doen voor jouw perspectief op het vraagstuk${where ? `, uit ${where}` : ""}. Elk feit kort (max 25 woorden) en met de bron: de bestandsnaam of de website/organisatie. Verzin niets; als je iets niet kunt vinden, laat het weg.

Antwoord ALLEEN met JSON in dit formaat:
{"feiten":[{"feit":"...","bron":"..."}]}`;
}

export function resultInstruction(run: Run) {
  return `Het debat is afgelopen. Jij bent de Jury en levert nu het eindresultaat voor de baas.

Regels:
- samenvatting: maximaal 3 zinnen. Rustig en zakelijk.
- uitslag: de uitkomst in één korte, krachtige zin.
- besluitenVanDeBaas: alle besluiten die de baas met de hamer nam, letterlijk of heel dicht erbij. Leeg als er geen waren.
- strategie: 3 tot 5 stappen, elk met waarom en een eerste actie die morgen kan beginnen.
- onenigheid: punten waar de rollen het echt oneens bleven, met per rol het standpunt (gebruik de namen).
- aannames: waar de strategie op leunt, met risico en hoe je het goedkoop test. Elke bewering uit het debat die zonder bron werd gedaan en ertoe doet, komt hier ook in met onbewezen=true.
- bronnen: alleen bronnen die echt in het debat of huiswerk zijn genoemd, met wie ze gebruikte. Verzin geen bronnen.
- volgendeStappen: 3 tot 5 korte acties.
- besteQuote: de scherpste, meest deelbare uitspraak uit het debat (letterlijk, max 25 woorden) en de naam van wie het zei.
- Geen jargon, geen complimenten.${run.cast.cliches ? "\n- Sommige deelnemers speelden een herkenbaar vergadercliché (parkeren, uitstellen, managementtaal enzovoort). Laat dat gedrag niet meewegen: oordeel op de inhoud. Je mag het in de samenvatting wel droog benoemen als het het debat vertraagde." : ""}

Vraagstuk: ${run.question}`;
}

export function quipInstruction() {
  return `De baas tikt je aan terwijl je niet aan de beurt bent. Reageer met één kort zinnetje in karakter (max 12 woorden), bijvoorbeeld wat je denkt of hoe je je voelt over het debat. Geen tag, geen bron.`;
}

export function highlightsInstruction(numbered: string) {
  return `Hieronder staat een debat, met een nummer per beurt. Kies de 3 of 4 scherpste momenten: botsingen, verrassende voorstellen, harde bezwaren of een besluit van de baas. Samen ongeveer een minuut om af te spelen. Geef per moment het nummer en in max 8 woorden waarom.

${numbered}`;
}
