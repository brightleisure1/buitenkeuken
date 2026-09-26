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
