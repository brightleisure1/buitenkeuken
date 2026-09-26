/** Tokenverbruik van één AI-aanroep (of een optelsom daarvan). */
export interface Usage {
  provider: string;
  model: string;
  /** Gewone (niet-gecachete) inputtokens */
  inputTokens: number;
  /** Uit de cache gelezen inputtokens (veel goedkoper) */
  cachedTokens: number;
  /** In de cache geschreven inputtokens (Anthropic) */
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
  /** Voor niet-tekst: aantal afbeeldingen of tekens spraak */
  units: number;
  costUsd: number;
  /** Afgebroken beurt: verbruik is geschat */
  estimated?: boolean;
}

export type UsageKind =
  | "samenstellen"
  | "aanpassen"
  | "portret"
  | "huiswerk"
  | "beurt"
  | "uitspraak"
  | "hoogtepunten"
  | "zinnetje"
  | "stem"
  | "spraak"
  | "vergelijking"
  | "intake"
  | "versie"
  | "review"
  | "kruisreview"
  | "herschrijven"
  | "slotcheck";

export const KIND_LABEL: Record<UsageKind, string> = {
  samenstellen: "Team samenstellen",
  aanpassen: "Team aanpassen (chat)",
  portret: "Portretten",
  huiswerk: "Huiswerk",
  beurt: "Debatbeurten",
  uitspraak: "Slotadvies van de voorzitter",
  hoogtepunten: "Hoogtepunten kiezen",
  zinnetje: "Losse zinnetjes",
  stem: "Stemmen",
  spraak: "Inspreken",
  vergelijking: "Vergelijking (één vraag)",
  intake: "Verduidelijkende vragen",
  versie: "Eerste versie",
  review: "Reviews vanuit de rollen",
  kruisreview: "Tegenlezer (ander model)",
  herschrijven: "Beoordelen en herschrijven",
  slotcheck: "Slotcheck voorzitter",
};

export function emptyUsage(provider = "", model = ""): Usage {
  return { provider, model, inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, webSearches: 0, units: 0, costUsd: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    provider: a.provider || b.provider,
    model: a.model || b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    webSearches: a.webSearches + b.webSearches,
    units: a.units + b.units,
    costUsd: a.costUsd + b.costUsd,
    estimated: a.estimated || b.estimated,
  };
}

/** Een opgeslagen verbruiksregel (tabel usage_events). */
export interface UsageEvent {
  kind: UsageKind;
  role_id: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  units: number;
  cost_eur: number;
}

export interface UsageLine {
  label: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  units: number;
  costEur: number;
  calls: number;
}

export interface UsageSummary {
  total: UsageLine;
  perKind: UsageLine[];
  perRole: (UsageLine & { roleId: string })[];
  perModel: (UsageLine & { provider: string })[];
}

function line(label: string): UsageLine {
  return { label, inputTokens: 0, cachedTokens: 0, outputTokens: 0, units: 0, costEur: 0, calls: 0 };
}

function add(l: UsageLine, e: UsageEvent) {
  l.inputTokens += Number(e.input_tokens) || 0;
  l.cachedTokens += Number(e.cached_tokens) || 0;
  l.outputTokens += Number(e.output_tokens) || 0;
  l.units += Number(e.units) || 0;
  l.costEur += Number(e.cost_eur) || 0;
  l.calls += 1;
}

/** Telt verbruiksregels op: totaal, per onderdeel, per rol en per model. */
export function summarizeUsage(events: UsageEvent[], roleNames: Record<string, string> = {}): UsageSummary {
  const total = line("Totaal");
  const kinds = new Map<string, UsageLine>();
  const roles = new Map<string, UsageLine & { roleId: string }>();
  const models = new Map<string, UsageLine & { provider: string }>();
  for (const e of events) {
    add(total, e);
    if (!kinds.has(e.kind)) kinds.set(e.kind, line(KIND_LABEL[e.kind] ?? e.kind));
    add(kinds.get(e.kind)!, e);
    if (e.role_id) {
      if (!roles.has(e.role_id)) roles.set(e.role_id, { ...line(roleNames[e.role_id] ?? e.role_id), roleId: e.role_id });
      add(roles.get(e.role_id)!, e);
    }
    if (e.model) {
      const k = `${e.provider}:${e.model}`;
      if (!models.has(k)) models.set(k, { ...line(e.model), provider: e.provider });
      add(models.get(k)!, e);
    }
  }
  const byCost = <T extends UsageLine>(a: T, b: T) => b.costEur - a.costEur;
  return { total, perKind: [...kinds.values()].sort(byCost), perRole: [...roles.values()].sort(byCost), perModel: [...models.values()].sort(byCost) };
}

export function tokens(n: number) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(".", ",")}k`;
  return `${(n / 1_000_000).toFixed(2).replace(".", ",")}M`;
}
