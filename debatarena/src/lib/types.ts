export type Tag = "bezwaar" | "akkoord" | "voorstel";
export type Mood = "neutraal" | "sceptisch" | "enthousiast";
export type VoiceMode = "uit" | "jury" | "iedereen";

export interface Role {
  id: string;
  naam: string;
  functie: string;
  perspectief: string;
  instructie: string;
  /** Eén zin voor op de kaart */
  zin: string;
  modelKey: string;
  /** Vrij veld onder Geavanceerd */
  customModel?: string | null;
  stemId: string | null;
  webzoeken: boolean;
  isJury: boolean;
  isKritisch: boolean;
  /** Alleen Grok: false = gecensureerd (standaard), true = ongecensureerd */
  ongezouten?: boolean;
  /** De bouwende rol: verdedigt de ambitieuze variant en zoekt gemiste kansen en upside */
  isBouwer?: boolean;
  /** Vergadercliché dat deze rol speelt (id uit cliches.ts), of null */
  cliche?: string | null;
  /** Korte Engelse omschrijving voor het portret */
  uiterlijk: string;
  /** Alleen in templates: bewaarde portretten */
  portraits?: Partial<Record<Mood, string>>;
}

export interface Cast {
  titel: string;
  rollen: Role[];
  rondes: number;
  stemmen: VoiceMode;
  /** Vergaderclichés aan of uit */
  cliches?: boolean;
  /** Fun-modus: karikaturen, clichés en droge humor bovenop een serieus debat */
  fun?: boolean;
  /** Hoe slim de deelnemers zijn (vlot, slim, slimst) */
  niveau?: "vlot" | "slim" | "slimst";
  /** "keten" (review-keten, standaard) of "vergadering" (de oude simulatie) */
  modus?: "keten" | "vergadering";
  /** Keten: vaste randvoorwaarden van de baas */
  randvoorwaarden?: string[];
  /** Keten: verduidelijkende vragen vooraf, met het antwoord van de baas */
  intake?: { vraag: string; antwoord: string }[];
  /** Maximale kosten van deze vergadering in euro (null = geen limiet) */
  kostenlimiet?: number | null;
  /** attachmentId -> "iedereen" of role.id */
  bijlages: Record<string, string>;
}

export interface Fact {
  feit: string;
  bron: string;
}

export interface RolePrep {
  portraitKey?: string;
  portraitStatus?: "bezig" | "klaar" | "mislukt";
  portraitStarted?: number;
  portraits?: Partial<Record<Mood, string>>;
  homeworkKey?: string;
  homeworkStatus?: "bezig" | "klaar" | "mislukt";
  homeworkStarted?: number;
  looking?: string[];
  facts?: Fact[];
}

export type Prep = Record<string, RolePrep>;

export interface MessageMeta {
  action?: BossAction;
  target?: string | null;
  answer?: boolean;
  extra?: "eensgezind";
  verdict?: boolean;
  /** De voorzitter (Jury) opent de vergadering */
  opening?: boolean;
  finalWord?: boolean;
  finalWordSkipped?: boolean;
  wrapUp?: boolean;
  /** Afgerond omdat de kostenlimiet bereikt was */
  budget?: boolean;
  /** 'Alleen het advies': de server speelt de vergadering zelf af */
  autorun?: boolean;
  /** 'Alleen het advies' weer uitgezet (de baas kijkt toch mee) */
  autorunOff?: boolean;
  /** 'Alleen het advies' liep vast op deze fout */
  autorunError?: { error: string; oplossing?: string };
  stopped?: boolean;
  streaming?: boolean;
  interrupted?: boolean;
  /** Het gevraagde model werkte niet; dit model sprak namens de rol */
  fallback?: { van: string; naar: string; model: string };
}

export type BossAction = "opmerking" | "richting" | "hamer" | "vraag" | "laatste_woord" | "overslaan" | "afronden";

export interface Message {
  id: string;
  run_id: string;
  seq: number;
  kind: "turn" | "boss" | "system";
  role_id: string | null;
  round: number | null;
  tag: Tag | null;
  content: string;
  sources: string[];
  meta: MessageMeta;
  audio: { idx: number; url: string }[];
  cost_eur: number;
  created_at: string;
}

export interface JuryResult {
  uitslag: string;
  samenvatting: string;
  besluitenVanDeBaas: string[];
  strategie: { stap: string; waarom: string; eersteActie: string }[];
  aannames: { aanname: string; risico: string; hoeTesten: string; onbewezen: boolean }[];
  onenigheid: { punt: string; standpuntPerRol: { rol: string; standpunt: string }[] }[];
  bronnen: { naam: string; gebruiktDoor: string }[];
  volgendeStappen: string[];
  besteQuote: { tekst: string; rol: string };
  /** Blinde vergelijking met één enkele vraag aan het slimste model */
  vergelijking?: Vergelijking;
}

export interface EnkelAdvies {
  uitslag: string;
  samenvatting: string;
  strategie: { stap: string; waarom: string; eersteActie: string }[];
  aannames?: { aanname: string; risico: string; hoeTesten: string }[];
  /** Oudere vergelijkingen hadden alleen losse risico's */
  risicos?: string[];
}

export interface Vergelijking {
  /** Welk model de enkele vraag kreeg, zoals de gebruiker het kent */
  label: string;
  model: string;
  advies: EnkelAdvies;
  kosten_eur: number;
  /** Welk advies als 'A' wordt getoond (willekeurig, zodat je blind kiest) */
  aIs: "debat" | "enkel";
  keuze?: "debat" | "enkel" | "gelijk";
}

export interface Highlight {
  messageId: string;
  waarom: string;
}

export interface ShareSettings {
  redactions?: string[];
  anonymous?: boolean;
}

export interface Run {
  id: string;
  question: string;
  title: string | null;
  status: "draft" | "running" | "done" | "stopped";
  cast: Cast;
  prep: Prep;
  result: JuryResult | null;
  keten?: Keten | null;
  result_checks: Record<string, boolean>;
  highlights: Highlight[] | null;
  share_token: string | null;
  share: ShareSettings;
  cost_eur: number;
  debate_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  run_id: string | null;
  name: string;
  mime: string;
  kind: "text" | "image";
  text: string | null;
  storage_path: string | null;
  size: number;
}

export type Step =
  | { type: "turn"; roleId: string; round: number; meta: MessageMeta }
  | { type: "final_word" }
  | { type: "result" }
  | { type: "budget"; limit: number; cost: number }
  | { type: "done" };

// ---------- Review-keten ----------

export interface AdviesDoc {
  /** Het besluit dat we adviseren, in één zin */
  besluit: string;
  samenvatting: string;
  opties: { optie: string; voor: string; tegen: string }[];
  /** De onderbouwing, in gewone alinea's */
  analyse: string;
  aannames: { aanname: string; risico: string; hoeTesten: string }[];
  stappen: { stap: string; waarom: string; eersteActie: string; eigenaar: string; termijn: string }[];
}

export type Zwaarte = "hoog" | "midden" | "laag";

export interface ReviewPunt {
  id: string;
  zwaarte: Zwaarte;
  punt: string;
  voorstel: string;
}

export interface Review {
  /** role.id, of "kruis" voor de tegenlezer van een ander model */
  van: string;
  naam: string;
  functie: string;
  /** persona = rol met eigen belang, bouwer = zoekt kansen en upside, kruis = tegenlezer van een ander model */
  soort: "persona" | "bouwer" | "kruis";
  /** Welke AI dit schreef, zoals de gebruiker het kent */
  ai: string;
  punten: ReviewPunt[];
}

export interface Oordeel {
  id: string;
  oordeel: "over" | "deels" | "niet";
  /** Waarom overnemen: herstelt een fout, verandert het besluit, voegt een wezenlijk risico of een kans toe */
  criterium?: "fout" | "besluit" | "risico" | "kans" | "geen";
  reden: string;
  /** De eindcontrole vond het niet terug in de tekst en zette het label terug */
  gecorrigeerd?: boolean;
}

export interface KetenRonde {
  nr: number;
  /** De versie die in deze ronde beoordeeld werd (ronde 1 = versie 1) */
  doc: AdviesDoc;
  reviews: Review[];
  oordelen: Oordeel[];
  /** Wat er daarna veranderde (leeg als er niets meer te verbeteren viel) */
  wijzigingen: string[];
  /** Per overgenomen punt wat er in de tekst veranderde */
  changelog?: { id: string; wijziging: string }[];
}

/** Een onafhankelijke eerste versie uit de verbreedronde */
export interface Concept {
  label: string;
  ai: string;
  model: string;
  doc: AdviesDoc;
  inzichten: { id: string; tekst: string }[];
}

/** Waar een inzicht in versie 1 vandaan komt */
export interface Herkomst {
  inzicht: string;
  bron: string[];
  status: "opgenomen" | "weggelaten";
  reden: string;
  gecorrigeerd?: boolean;
}

export interface Redactie {
  /** Wat de eindredacteur aan de besluitregel veranderde, en waarom (leeg = niets) */
  besluitAangepast: string;
  consistentie: string[];
  /** Resultaat van de controle: claims die niet in de tekst stonden en zijn teruggezet */
  gecorrigeerd: { id: string; claim: string }[];
  gecontroleerd: number;
}

export interface Slotcheck {
  oordeel: string;
  /** Bevindingen met hun gevolg voor de conclusie */
  bevindingen?: { tekst: string; impact: "conclusie" | "aanvulling" | "geen" }[];
  vertrouwen: "laag" | "midden" | "hoog";
  waaromVertrouwen: string;
  laatsteAanvullingen: string[];
  nietOvergenomen: { punt: string; van: string; reden: string }[];
  besteInzicht: { tekst: string; van: string };
}

export interface Keten {
  status: "bezig" | "klaar" | "fout";
  /** Wat er nu gebeurt, in gewone taal */
  stap: string;
  /** Waar in de keten we zijn (voor het flowschema) */
  fase?: "huiswerk" | "versie1" | "verbreden" | "samenvoegen" | "review" | "herschrijven" | "slotcheck" | "redactie" | "klaar";
  /** Sinds wanneer de huidige stap loopt (ms) */
  sinds?: number;
  auteur: { ai: string; model: string };
  kruis: { ai: string; model: string } | null;
  rondes: KetenRonde[];
  /** Verbreedronde: onafhankelijke eerste versies van verschillende modellen */
  concepten?: Concept[];
  herkomst?: Herkomst[];
  redactie?: Redactie;
  eind?: AdviesDoc;
  slot?: Slotcheck;
  /** Kosten van versie 1 (= één keer het slimste model), voor de vergelijking */
  kostenVersie1?: number;
  fout?: { error: string; oplossing?: string };
  /** Ingrepen van de baas die nog in een ronde verwerkt moeten worden */
  baas: { opmerkingen: { id: string; tekst: string; verwerkt: boolean }[]; overrides: Record<string, "over" | "niet"> };
  /** Budget op: gestopt voordat alle rondes klaar waren */
  budgetOp?: boolean;
  /** Hoeveel review-rondes (met herziening) er mogen zijn; 'nog een ronde' hoogt dit op */
  maxRondes?: number;
}
