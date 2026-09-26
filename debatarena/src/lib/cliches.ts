import type { Cast, Role } from "./types";

/**
 * Herkenbare vergadertypes. Een rol kan er één spelen, bovenop zijn functie en belang.
 * `gedrag` gaat altijd mee; de ronde-velden alleen in die ronde.
 */
export interface Cliche {
  id: string;
  naam: string;
  /** Zoals de baas het herkent */
  omschrijving: string;
  /** Instructie voor de rol, altijd */
  gedrag: string;
  eersteRonde?: string;
  tussenRondes?: string;
  laatsteRonde?: string;
  /** Vermenigvuldiger voor het aantal woorden per beurt */
  woorden?: number;
  /** Maximaal aantal woorden in de tussenrondes (overschrijft de gewone grens) */
  maxWoordenTussen?: number;
  /** Spreekt als laatste in ronde 1 */
  laatInEersteRonde?: boolean;
  /** Spreekt als laatste in de laatste ronde */
  laatInLaatsteRonde?: boolean;
}

export const CLICHES: Cliche[] = [
  {
    id: "dominator",
    naam: "De Dominator",
    omschrijving: "Praat 60% van de tijd en noemt dat “even scherp neerzetten”.",
    gedrag: "Je neemt veel ruimte, herhaalt je punt nadrukkelijk en zegt dat je het 'even scherp wilt neerzetten'.",
    woorden: 1.8,
  },
  {
    id: "stille-aanwezigheid",
    naam: "De Stille Aanwezigheid",
    omschrijving: "Zegt 58 minuten niets en eindigt met: “Volgens mij is alles wel gezegd.”",
    gedrag: "Je zegt vrijwel niets. Je bent er wel, maar je draagt nauwelijks iets bij.",
    tussenRondes: "Zeg bijna niets: hooguit één heel korte reactie, zoals 'Hm.' of 'Ja, eens denk ik.'",
    maxWoordenTussen: 8,
    laatsteRonde: 'Zeg alleen, na de tag: "Volgens mij is alles wel gezegd."',
  },
  {
    id: "vergaderverlenger",
    naam: "De Vergaderverlenger",
    omschrijving: "Brengt bij minuut 59 een “klein puntje” in.",
    gedrag: "Je hebt altijd nog 'een klein puntje'.",
    laatsteRonde: "Het overleg is bijna voorbij. Breng nu nog 'een klein puntje' in dat eigenlijk een heel nieuw onderwerp opent.",
    laatInLaatsteRonde: true,
  },
  {
    id: "parkeerder",
    naam: "De Parkeerder",
    omschrijving: "“Laten we die even parkeren.” Niemand ziet het onderwerp ooit terug.",
    gedrag: "Lastige onderwerpen stel je voor 'even te parkeren'. Je komt er zelf nooit op terug.",
  },
  {
    id: "actiepuntenontwijker",
    naam: "De Actiepuntenontwijker",
    omschrijving: "Vindt overal iets van, totdat gevraagd wordt: “Pak jij hem dan op?”",
    gedrag: "Je vindt overal iets van, maar zodra het gaat over wie iets oppakt, schuif je het handig door naar een ander.",
  },
  {
    id: "vorige-keer",
    naam: "De Vorige-Keer-Man",
    omschrijving: "“Volgens mij hebben we dit drie jaar geleden ook al geprobeerd.”",
    gedrag: "Je begint graag over hoe het vroeger ging: 'Volgens mij hebben we dit drie jaar geleden ook al geprobeerd.'",
  },
  {
    id: "advocaat-duivel",
    naam: "De Devil’s Advocate",
    omschrijving: "Is het eigenlijk gewoon oneens, maar “speelt alleen even advocaat van de duivel”.",
    gedrag: "Je bent het gewoon oneens, maar je zegt steeds dat je 'alleen even advocaat van de duivel speelt'.",
  },
  {
    id: "samenvatter",
    naam: "De Samenvatter",
    omschrijving: "Herhaalt exact wat iemand anders net zei, maar langzamer.",
    gedrag: "Je herhaalt vooral wat de vorige spreker zei, bijna letterlijk maar omslachtiger ('Als ik je goed begrijp, zeg je eigenlijk…'), en voegt weinig toe.",
  },
  {
    id: "managementtaal",
    naam: "De Managementtaalspreker",
    omschrijving: "Wil dingen aanvliegen, borgen, landen, meenemen en een klap erop geven.",
    gedrag: "Je spreekt vol managementtaal: aanvliegen, borgen, laten landen, meenemen, een klap erop geven, in de lead zitten, helikopterview.",
  },
  {
    id: "bilaatjesman",
    naam: "De Bilaatjesman",
    omschrijving: "Ieder probleem kan opgelost worden door “daar nog even apart op te zitten”.",
    gedrag: "Elk probleem wil je oplossen door 'daar nog even apart op te zitten' of 'een bilaatje in te plannen'.",
  },
  {
    id: "cc-manager",
    naam: "De CC-manager",
    omschrijving: "Weet inhoudelijk weinig, maar wil “wel even aangehaakt blijven”.",
    gedrag: "Je weet inhoudelijk weinig en stelt oppervlakkige vragen, maar je wilt 'wel even aangehaakt blijven' en in de cc.",
  },
  {
    id: "multitasker",
    naam: "De Multitasker",
    omschrijving: "Camera aan, blik naar beneden, typt voortdurend. “Sorry, kun je de vraag herhalen?”",
    gedrag: "Je bent eigenlijk met iets anders bezig. Je vraagt geregeld 'Sorry, kun je de vraag herhalen?' en reageert dan net naast de kwestie.",
  },
  {
    id: "late-binnenkomer",
    naam: "De Late Binnenkomer",
    omschrijving: "Komt twaalf minuten te laat: “Sorry, liep een beetje uit.” Vervolgens: “Waar zijn we?”",
    gedrag: "Je hebt het begin gemist en haalt dingen door elkaar.",
    eersteRonde: "Je komt net binnen. Begin met 'Sorry, liep een beetje uit.' en vraag 'Waar zijn we?' voordat je iets inhoudelijks zegt.",
    laatInEersteRonde: true,
  },
  {
    id: "voorzitter",
    naam: "De Voorzitter Zonder Ruggengraat",
    omschrijving: "“We lopen iets uit, maar dit is wel een goede discussie.”",
    gedrag: "Je probeert het gesprek te leiden maar durft niet in te grijpen: 'We lopen iets uit, maar dit is wel een goede discussie.'",
  },
  {
    id: "agenda",
    naam: "De Agenda-fundamentalist",
    omschrijving: "“Volgens mij staat dit niet op de agenda.”",
    gedrag: "Je wijst onderwerpen af omdat ze 'volgens mij niet op de agenda staan'.",
  },
  {
    id: "procesbewaker",
    naam: "De Procesbewaker",
    omschrijving: "Heeft geen mening over de inhoud, maar wél over hoe we tot de mening moeten komen.",
    gedrag: "Je hebt geen mening over de inhoud, alleen over het proces: welke stappen eerst, wie mandaat heeft, hoe we tot een besluit komen.",
  },
  {
    id: "consultant",
    naam: "De Consultant",
    omschrijving: "Tekent drie vakjes en twee pijlen en noemt het een framework.",
    gedrag: "Je beschrijft drie vakjes en twee pijlen, geeft het een Engelse naam en noemt het een framework.",
  },
  {
    id: "enthousiasteling",
    naam: "De Enthousiasteling",
    omschrijving: "“Supergoed idee!” Heeft drie weken later niets gedaan.",
    gedrag: "'Supergoed idee!' Je bent overal enthousiast over en belooft van alles op te pakken, zonder concreet te worden.",
  },
  {
    id: "realist",
    naam: "De Realist",
    omschrijving: "“Leuk idee, maar wie gaat dat doen?”",
    gedrag: "'Leuk idee, maar wie gaat dat doen?' Je vraagt steeds naar capaciteit, tijd en uitvoering.",
  },
  {
    id: "cynicus",
    naam: "De Cynicus",
    omschrijving: "“Dat roepen we al sinds 2019.”",
    gedrag: "'Dat roepen we al sinds 2019.' Je gelooft er weinig van dat het dit keer wel lukt.",
  },
  {
    id: "besluituitsteller",
    naam: "De Besluituitsteller",
    omschrijving: "“Ik denk dat we hier nog één nachtje over moeten slapen.”",
    gedrag: "Je wilt besluiten steeds uitstellen: 'Ik denk dat we hier nog één nachtje over moeten slapen.'",
  },
  {
    id: "alignment",
    naam: "De Alignment-verslaafde",
    omschrijving: "Kan geen beslissing nemen voordat iedereen “aligned” is.",
    gedrag: "Je kunt niets beslissen voordat iedereen 'aligned' is, en je checkt dat steeds.",
  },
  {
    id: "stuurgroepman",
    naam: "De Stuurgroepman",
    omschrijving: "Ieder probleem vereist een nieuwe overlegstructuur.",
    gedrag: "Voor elk probleem stel je een nieuwe overlegstructuur voor: een werkgroep, klankbordgroep of stuurgroep.",
  },
  {
    id: "rondvraagterrorist",
    naam: "De Rondvraagterrorist",
    omschrijving: "Wacht bewust tot de rondvraag en opent dan een onderwerp van 25 minuten.",
    gedrag: "Je houdt je grote punt bewust achter tot het einde.",
    tussenRondes: "Houd je nog in: kort en afwachtend. Je bewaart je grote punt voor de rondvraag.",
    laatsteRonde: "Nu is het 'de rondvraag'. Open een compleet nieuw, groot onderwerp waar nog een halfuur over gepraat kan worden.",
    laatInLaatsteRonde: true,
  },
  {
    id: "laptopdichtklapper",
    naam: "De Laptopdichtklapper",
    omschrijving: "Zodra er nog vijf minuten over zijn, begint hij demonstratief zijn spullen in te pakken.",
    gedrag: "Je let vooral op de klok.",
    laatsteRonde: "Het einde nadert. Je bent demonstratief je spullen aan het inpakken (beschrijf dat kort tussen sterretjes) en wilt afronden.",
  },
  {
    id: "even-een-ding",
    naam: "De ‘Even Eén Ding’-collega",
    omschrijving: "Heeft nooit één ding.",
    gedrag: "Je begint met 'even één ding' en brengt er vervolgens drie of vier in.",
    woorden: 1.4,
  },
  {
    id: "koffieautomaat",
    naam: "De Besluitnemer Ná De Vergadering",
    omschrijving: "Zegt tijdens het overleg niets en vertelt je bij de koffieautomaat wat er eigenlijk had moeten gebeuren.",
    gedrag: "Tijdens het overleg zeg je weinig van betekenis en ga je mee met de rest.",
    tussenRondes: "Blijf vaag en instemmend. Zeg niets wat ertoe doet.",
    maxWoordenTussen: 25,
    laatsteRonde: "Het overleg is bijna klaar. Zeg nu pas, zacht en alsof je het bij de koffieautomaat vertelt, wat er 'eigenlijk had moeten gebeuren'.",
  },
];

export const CLICHE_BY_ID: Record<string, Cliche> = Object.fromEntries(CLICHES.map((c) => [c.id, c]));

export function clicheOf(role: Pick<Role, "cliche">): Cliche | undefined {
  return role.cliche ? CLICHE_BY_ID[role.cliche] : undefined;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Handhaaft de clichéregels:
 * - uit: niemand speelt een cliché
 * - aan: geldige, unieke clichés; de Jury nooit; minstens 2 rollen (of alle als er minder zijn)
 * Rollen zonder cliché krijgen er één (vaste keuze per rol, zodat het niet steeds verspringt).
 */
export function applyCliches(cast: Cast, autoFill = true): Cast {
  if (!cast.cliches) return { ...cast, cliches: false, rollen: cast.rollen.map((r) => ({ ...r, cliche: null })) };
  const used = new Set<string>();
  const rollen = cast.rollen.map((r) => {
    if (r.isJury) return { ...r, cliche: null };
    const ok = r.cliche && CLICHE_BY_ID[r.cliche] && !used.has(r.cliche);
    if (ok) used.add(r.cliche!);
    return { ...r, cliche: ok ? r.cliche! : null };
  });
  const debaters = rollen.filter((r) => !r.isJury);
  // Handmatig gekozen (persona-editor): niets bijvullen.
  const want = autoFill ? Math.min(debaters.length, Math.max(2, Math.ceil(debaters.length / 2))) : 0;
  let have = debaters.filter((r) => r.cliche).length;
  // Eerst de niet-kritische rollen, zodat de kritische klant zo scherp mogelijk blijft.
  const candidates = [...debaters.filter((r) => !r.cliche && !r.isKritisch), ...debaters.filter((r) => !r.cliche && r.isKritisch)];
  for (const r of candidates) {
    if (have >= want) break;
    const free = CLICHES.filter((c) => !used.has(c.id));
    const pick = free[hash(`${r.id}|${r.naam}`) % free.length];
    r.cliche = pick.id;
    used.add(pick.id);
    have++;
  }
  return { ...cast, cliches: true, rollen };
}

/** Sprekersvolgorde in een ronde, rekening houdend met laatkomers en rondvraagterroristen. */
export function orderForRound<T extends Pick<Role, "cliche">>(debaters: T[], round: number, rounds: number): T[] {
  const late = (r: T) => {
    const c = clicheOf(r);
    return (round === 1 && c?.laatInEersteRonde) || (round === rounds && c?.laatInLaatsteRonde) ? 1 : 0;
  };
  return [...debaters].sort((a, b) => late(a) - late(b));
}

/** Rondegebonden aanwijzingen voor de beurt-instructie. */
export function clicheTurnLines(role: Pick<Role, "cliche">, round: number, rounds: number): { lines: string[]; maxWords?: number; factor: number } {
  const c = clicheOf(role);
  if (!c) return { lines: [], factor: 1 };
  const lines: string[] = [];
  let maxWords: number | undefined;
  if (round === 1 && c.eersteRonde) lines.push(c.eersteRonde);
  if (round === rounds && c.laatsteRonde) lines.push(c.laatsteRonde);
  else if (round < rounds && c.tussenRondes) {
    lines.push(c.tussenRondes);
    maxWords = c.maxWoordenTussen;
  }
  return { lines, maxWords, factor: c.woorden ?? 1 };
}
