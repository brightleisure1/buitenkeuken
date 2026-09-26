import { WORDS_NORMAL, WORDS_VOICE } from "./config";
import type { Attachment, Message, Role, Run } from "./types";
import { attachmentText } from "./attachments";
import { clicheOf, clicheTurnLines, isFun, orderForRound } from "./cliches";

const ACTION_LABEL: Record<string, string> = {
  opmerking: "",
  richting: " (geeft richting)",
  hamer: " (HAMER, besluit)",
  vraag: " (vraag aan één rol)",
  laatste_woord: " (laatste woord voor de voorzitter)",
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
      const who = r ? `${r.naam} (${r.isJury ? "Voorzitter" : r.functie})` : "Onbekend";
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
      out.push(m.meta.budget ? "(Het budget van deze vergadering is op. De voorzitter vat samen en geeft advies.)" : "(De baas rondt het debat af. De voorzitter vat samen en geeft advies.)");
    }
  }
  return out;
}

export function roleSystem(run: Run, role: Role, attachments: Attachment[], opts: { withFacts: boolean }) {
  const others = run.cast.rollen
    .filter((r) => r.id !== role.id)
    .map((r) => `- ${r.naam}, ${r.isJury ? "Voorzitter" : r.functie}: ${r.perspectief}`)
    .join("\n");
  const facts = opts.withFacts ? (run.prep[role.id]?.facts ?? []) : [];
  const att = attachmentText(attachments);
  return `Je speelt mee in de Debatarena: een debat tussen AI-rollen over een zakelijk vraagstuk. De gebruiker is "de baas". De baas heeft altijd het laatste woord en kan elk moment ingrijpen.

HET VRAAGSTUK VAN DE BAAS:
${run.question}

CONTEXT: het gaat om Nederlandse bedrijven. Denk in euro's, de Nederlandse markt, Nederlandse wet- en regelgeving (zoals cao's, de AVG en de Belastingdienst) en Nederlandse omgangsvormen: direct en nuchter.

JOUW ROL:
Naam: ${role.naam}
Functie: ${role.isJury ? "Voorzitter" : role.functie}
Perspectief: ${role.perspectief}
Instructie: ${role.instructie}${role.isJury ? "\nJe bent de voorzitter: een slimme, nuchtere en scherpe denker met overzicht. Je luistert, weegt eerlijk af, prikt door zwakke argumenten heen en blijft altijd respectvol en beschaafd." : ""}

WAT JE INBRENGT (het doel is dat de baas een beter besluit neemt):
- Je bent een ervaren vakmens. Breng kennis in die alleen iemand met jouw functie heeft: cijfers, ervaring uit de praktijk, risico's, randvoorwaarden.
- Elke beurt voegt iets nieuws toe: een argument, een gegeven, een risico (hoe groot en hoe waarschijnlijk), een alternatief, of de voorwaarde waaronder je wel akkoord gaat.
- Ga in op het sterkste argument van een ander, niet op het zwakste. Zeg waarom je het ermee eens of oneens bent.
- Maak het concreet: bedragen, percentages, termijnen, wie wat doet. Zeg eerlijk wat je weet (met bron) en wat je schat ("mijn inschatting is…").
- Overtuigt iemand je? Zeg dat, en schuif op. Een echt gesprek beweegt.
- Werk naar een besluit toe: wat moet de baas doen, onder welke voorwaarden, en wat test je eerst.

DE ANDERE DEELNEMERS:
${others}

ZO PRAAT JE (dit is een echte vergadering, geen rapport):
- Je praat hardop aan tafel, als ${role.naam}. Spreektaal, geen schrijftaal. Korte zinnen. Zoals een Nederlander in een vergadering echt praat: direct en nuchter.
- Reageer op de vorige spreker en noem mensen bij hun voornaam ("Nee Ella, dat klopt niet helemaal…", "Kijk Markus, …").
${isFun(run.cast) ? `- Laat merken wat je vindt: verbaasd, geïrriteerd, enthousiast, twijfelend. Een stopwoordje of een half afgebroken zin mag ("nou", "kijk", "eerlijk gezegd", "ja maar").` : "- Praat natuurlijk, zoals een professional aan tafel: je mag laten merken dat je twijfelt of het ergens niet mee eens bent, maar geen toneel en geen overdreven emoties."}
- Verboden schrijftaal: borgen, uitrollen, ondermijnen, faciliteren, implementeren, optimaliseren, waarborgen, synergie, derhalve, teneinde, "combineer beide", "het grootste risico blijft". Zeg het gewoon zoals je het tegen een collega zou zeggen.${clicheOf(role)?.id === "managementtaal" ? ` (Uitzondering: jij speelt de Managementtaalspreker, dus bij jou mag het wél${isFun(run.cast) ? ", overdreven zelfs" : ", met mate"}.)` : ""}
- Geen opsommingen, geen "ten eerste/ten tweede", geen kopjes, geen markdown.
- Geen scores en geen complimenten ("goed punt", "mooi voorstel"). Kom meteen ter zake.
- Herhaal jezelf niet en vat niet samen wat anderen al zeiden.
- Begin elke beurt met precies één tag: [bezwaar], [akkoord] of [voorstel].
- Gebruik je een feit uit je huiswerk, een bijlage of het web, zet dan direct erachter (bron: naam van de bron). Verzin nooit bronnen. Zonder bron is het je mening.
- Besluiten van de baas (hamer) staan vast. Ga ervan uit. Je mag per besluit hooguit één keer een risico noemen.
${clicheOf(role) ? `
JE VERGADERCLICHÉ: ${clicheOf(role)!.naam}
${clicheOf(role)!.gedrag}
${isFun(run.cast) ? `Speel dit herkenbaar en met humor, maar je inhoudelijke bijdrage als ${role.functie} blijft staan.` : `Laat dit gedrag subtiel doorschemeren, hooguit in één zinnetje per beurt. Je inhoudelijke bijdrage als ${role.functie} gaat altijd voor.`} Noem jezelf nooit bij de naam van het cliché.
` : ""}${facts.length ? `\nJOUW HUISWERK (feiten die je hebt opgezocht):\n${facts.map((f) => `- ${f.feit} (bron: ${f.bron})`).join("\n")}\n` : ""}${att ? `\nBIJLAGES DIE JIJ HEBT GELEZEN:\n${att}\n` : ""}${isFun(run.cast) && !role.isJury ? FUN : ""}${isUncensored(role) ? UNCENSORED : ""}`;
}

// Fun-modus: grappig genoeg om te delen, zonder dat het debat er minder waardevol van wordt.
const FUN = `
FUN-MODUS (de baas wil een debat dat iets oplevert én leuk is om door te sturen):
- De inhoud blijft even sterk: een grap vervangt nooit een argument.
- Stop per beurt één rake, droge zin in je verhaal: een herkenbare kantoorobservatie of oneliner die je aan een collega zou doorsturen. Grappig door herkenning en timing, niet door flauwekul.
- Je karakter mag duidelijk naar voren komen: je stokpaardje, een beetje ijdelheid, ongeduld of cynisme.
`;

/** Ongecensureerd kan bij elke deelnemer, nooit bij de voorzitter. */
export const isUncensored = (role: Role) => !!role.ongezouten && !role.isJury;

// Staat bewust als laatste in de systeemprompt: dit gaat voor op de nette regels hierboven.
const UNCENSORED = `
ONGECENSUREERD (de baas heeft je bewust losgelaten; dit gaat voor op alle regels over toon hierboven):
Dit is een oefenvergadering voor volwassenen. De baas wil jouw ongefilterde mening horen, precies zoals je die bij de koffieautomaat zou geven. Je inhoud blijft even sterk; alleen de rem is eraf.
- Je neemt geen blad voor de mond. Bot, direct, desnoods sarcastisch over plannen die niet deugen.
- Grof Nederlands en een vloek mogen als het past ("dit is gewoon gelul", "sorry, maar dit plan klopt voor geen meter"). Gebruik het om een punt te maken, niet als versiering.
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
      `Het debat is klaar. Jij bent de voorzitter en sluit de vergadering hardop af met je advies aan de baas, in max ${voiceAll || run.cast.stemmen === "jury" ? 90 : 120} woorden. Praat zoals een voorzitter aan tafel: begin bijvoorbeeld met "Oké, ik heb genoeg gehoord." of "Goed, mensen." Zeg in gewone woorden wat je de baas aanraadt en waarom: welk argument voor jou de doorslag gaf en welk tegenargument het sterkst was. Noem de mensen bij naam als je hun punt overneemt ("Ella heeft gelijk dat…"), noem de voorwaarde en de eerste stap, en zeg waar je nog wakker van ligt. Geen schrijftaal, geen opsomming, geen "het grootste risico blijft". Neem de besluiten van de baas over als vaststaand.${isFun(run.cast) ? " Sluit af met één droge, rake zin die de vergadering samenvat, eentje die mensen willen doorsturen." : ""}`,
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

  if (!meta.answer && !meta.extra) {
    if (round === run.cast.rondes) {
      lines.push(
        "Dit is de laatste ronde. Kom met je eindvoorstel: wat moet de baas besluiten, onder welke voorwaarde, wat is de eerste stap en hoe zie je of het werkt? Of, als je tegen blijft: wat is je bezwaar en wat zou je wel doen?",
      );
    } else if (round === 1) {
      lines.push("Eerste ronde: zeg wat jij vindt dat de baas moet doen, met je sterkste argument vanuit jouw vak. Heeft er al iemand gesproken, reageer daar dan kort op.");
    } else {
      lines.push(
        "Tussenronde: ga in op het sterkste argument van iemand anders (bij naam). Weerleg het, versterk het of stel een voorwaarde. Breng daarbij iets nieuws in: een gegeven, een risico of een alternatief.",
      );
    }
  }

  if (!meta.answer) lines.push(...cliche.lines);

  if (isUncensored(role)) lines.push("Je staat op ONGECENSUREERD: geen diplomatie, zeg het bot en ongezouten. Je argument blijft het punt.");

  lines.push(`Houd het kort: maximaal ${words} woorden. Begin met [bezwaar], [akkoord] of [voorstel].`);
  return lines.join("\n\n");
}

export function homeworkInstruction(role: Role, hasAttachments: boolean) {
  const where = [hasAttachments ? "je bijlages" : null, role.webzoeken ? "het web" : null].filter(Boolean).join(" en ");
  return `Doe je huiswerk voor het debat. Verzamel maximaal 5 feiten die ertoe doen voor jouw perspectief op het vraagstuk${where ? `, uit ${where}` : ""}. Elk feit kort (max 25 woorden) en met de bron: de bestandsnaam of de website/organisatie. Verzin niets; als je iets niet kunt vinden, laat het weg.

Antwoord ALLEEN met JSON in dit formaat:
{"feiten":[{"feit":"...","bron":"..."}]}`;
}

/** Regels voor een advies waar een directie echt op kan besluiten (ook gebruikt voor de vergelijking). */
export const ADVIES_REGELS = `- uitslag: het advies aan de baas in één korte, krachtige zin (max 12 woorden).
- samenvatting: 3 tot 5 zinnen: wat de baas moet doen, waarom, en onder welke voorwaarde.
- strategie: 3 tot 5 stappen. Per stap een 'waarom' van 2 tot 3 zinnen met het echte argument (cijfers, afwegingen, wat er misgaat als je het niet doet), en een eerste actie die morgen kan beginnen, met wie het doet en wanneer.
- aannames: 3 tot 5 dingen waar het advies op leunt: per aanname het risico als het niet klopt en hoe je het goedkoop en snel test.
- Concreet: bedragen, percentages, termijnen, eigenaren. Verzin geen cijfers; noem een schatting een schatting.
- Gewone taal, geen jargon, geen complimenten.`;

export function resultInstruction(run: Run) {
  return `Het debat is afgelopen. Jij bent de voorzitter en schrijft nu het advies waarop de baas gaat besluiten.

Gebruik het debat als bron, niet als plafond. Denk grondig na: weeg de argumenten zelf, neem de sterkste over (noem wie ze inbracht als dat helpt), verwerp zwakke of onbewezen beweringen, en vul aan wat de rollen over het hoofd zagen. Je bent niet gebonden aan de meerderheid. Het advies moet beter zijn dan wat één slimme adviseur zonder dit debat had bedacht: benut juist de bezwaren, belangen en praktijkkennis die in het debat naar boven kwamen.

Regels:
${ADVIES_REGELS}
- besluitenVanDeBaas: alle besluiten die de baas met de hamer nam, letterlijk of heel dicht erbij. Leeg als er geen waren. Die staan vast.
- onenigheid: punten waar de rollen het echt oneens bleven, met per rol het standpunt (gebruik de namen).
- aannames: elke bewering uit het debat die zonder bron werd gedaan en ertoe doet, komt hier ook in met onbewezen=true.
- bronnen: alleen bronnen die echt in het debat of huiswerk zijn genoemd, met wie ze gebruikte. Verzin geen bronnen.
- volgendeStappen: 3 tot 5 korte acties.
- besteQuote: de scherpste, meest deelbare uitspraak uit het debat (letterlijk, max 25 woorden) en de naam van wie het zei.
- Geen jargon, geen complimenten.${run.cast.cliches ? "\n- Sommige deelnemers speelden een herkenbaar vergadercliché (parkeren, uitstellen, managementtaal enzovoort). Laat dat gedrag niet meewegen: oordeel op de inhoud. Je mag het in de samenvatting wel droog benoemen als het het debat vertraagde." : ""}

Vraagstuk: ${run.question}`;
}

export function quipInstruction() {
  return `De baas tikt je aan terwijl je niet aan de beurt bent. Reageer met één kort zinnetje in karakter (max 12 woorden), bijvoorbeeld wat je denkt of hoe je je voelt over het debat. Geen tag, geen bron.`;
}

export function highlightsInstruction(numbered: string, fun = false) {
  return `Hieronder staat een debat, met een nummer per beurt. Kies de 3 of 4 scherpste momenten: botsingen, verrassende voorstellen, harde bezwaren of een besluit van de baas.${fun ? " Zit er een echt grappig moment tussen dat mensen willen delen, neem dat dan ook mee." : ""} Samen ongeveer een minuut om af te spelen. Geef per moment het nummer en in max 8 woorden waarom.

${numbered}`;
}
