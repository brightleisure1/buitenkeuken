import "server-only";
import { usdToEur } from "./config";
import { db } from "./supabase";
import { summarizeUsage, type Usage, type UsageEvent, type UsageKind } from "./usage";

/** Slaat verbruik op en telt de kosten op bij het debat. Geeft de kosten in euro terug. */
export async function recordUsage(runId: string | null, kind: UsageKind, u: Usage | undefined, roleId?: string | null): Promise<number> {
  if (!u) return 0;
  if (!u.costUsd && !u.inputTokens && !u.outputTokens && !u.units) return 0;
  const eur = usdToEur(u.costUsd);
  const { error } = await db()
    .from("usage_events")
    .insert({
      run_id: runId,
      kind,
      role_id: roleId ?? null,
      provider: u.provider,
      model: u.model,
      input_tokens: Math.round(u.inputTokens + u.cacheWriteTokens),
      cached_tokens: Math.round(u.cachedTokens),
      output_tokens: Math.round(u.outputTokens),
      units: u.units,
      cost_eur: eur,
    });
  if (error) console.error("verbruik opslaan mislukt", error.message);
  if (runId && eur) await db().rpc("add_cost", { p_run: runId, p_eur: eur });
  return eur;
}

export async function usageEvents(runId: string): Promise<UsageEvent[]> {
  const { data } = await db()
    .from("usage_events")
    .select("kind, role_id, provider, model, input_tokens, cached_tokens, output_tokens, units, cost_eur")
    .eq("run_id", runId);
  return (data ?? []) as UsageEvent[];
}

export async function runUsageSummary(runId: string, roleNames: Record<string, string>) {
  return summarizeUsage(await usageEvents(runId), roleNames);
}

/** Tokens per debat voor een lijst debatten (Geschiedenis). */
export async function tokensPerRun(runIds: string[]): Promise<Record<string, number>> {
  if (!runIds.length) return {};
  const { data } = await db().from("usage_events").select("run_id, input_tokens, cached_tokens, output_tokens").in("run_id", runIds);
  const out: Record<string, number> = {};
  for (const e of data ?? []) {
    out[e.run_id] = (out[e.run_id] ?? 0) + Number(e.input_tokens) + Number(e.cached_tokens) + Number(e.output_tokens);
  }
  return out;
}

/** Verbruik per aanbieder over de afgelopen dagen (Instellingen). */
export async function usagePerProvider(days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await db()
    .from("usage_events")
    .select("kind, role_id, provider, model, input_tokens, cached_tokens, output_tokens, units, cost_eur")
    .gte("created_at", since);
  const per: Record<string, { tokens: number; costEur: number; calls: number }> = {};
  for (const e of (data ?? []) as UsageEvent[]) {
    const k = e.provider || "overig";
    per[k] ??= { tokens: 0, costEur: 0, calls: 0 };
    per[k].tokens += Number(e.input_tokens) + Number(e.cached_tokens) + Number(e.output_tokens);
    per[k].costEur += Number(e.cost_eur);
    per[k].calls += 1;
  }
  return per;
}
