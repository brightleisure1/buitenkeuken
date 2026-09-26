import "server-only";
import { usdToEur } from "./config";
import { AppError } from "./errors";
import { db } from "./supabase";
import type { Message, Role, RolePrep, Run } from "./types";

export async function getRun(id: string): Promise<Run> {
  const { data, error } = await db().from("runs").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new AppError("Dit debat bestaat niet (meer).", "Ga terug naar Start en begin een nieuw debat.", 404);
  return normalizeRun(data);
}

export async function getRunByToken(token: string): Promise<Run | null> {
  const { data } = await db().from("runs").select("*").eq("share_token", token).maybeSingle();
  return data ? normalizeRun(data) : null;
}

function normalizeRun(data: Record<string, unknown>): Run {
  const r = data as unknown as Run;
  return { ...r, cost_eur: Number(r.cost_eur ?? 0), prep: r.prep ?? {}, share: r.share ?? {}, result_checks: r.result_checks ?? {} };
}

export async function getMessages(runId: string): Promise<Message[]> {
  const { data } = await db().from("messages").select("*").eq("run_id", runId).order("seq");
  return ((data ?? []) as Message[]).map((m) => ({ ...m, cost_eur: Number(m.cost_eur ?? 0) }));
}

export async function updateRun(id: string, patch: Partial<Run>) {
  const { error } = await db()
    .from("runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new AppError("Opslaan lukte niet.", "Probeer het opnieuw. Blijft het misgaan? Controleer de databaseverbinding.");
}

export async function addCostUsd(runId: string, usd: number) {
  if (!usd) return 0;
  const eur = usdToEur(usd);
  await db().rpc("add_cost", { p_run: runId, p_eur: eur });
  return eur;
}

export async function mergePrep(runId: string, roleId: string, patch: RolePrep) {
  await db().rpc("merge_prep", { p_run: runId, p_role: roleId, p_patch: patch });
}

export async function insertMessage(m: Partial<Message> & { run_id: string; kind: Message["kind"] }): Promise<Message> {
  const { data, error } = await db().from("messages").insert(m).select("*").single();
  if (error || !data) throw new AppError("Opslaan van het bericht lukte niet.", "Probeer het opnieuw.");
  return data as Message;
}

export async function updateMessage(id: string, patch: Partial<Message>) {
  await db().from("messages").update(patch).eq("id", id);
}

export function roleById(run: Run, id: string | null | undefined): Role | undefined {
  return run.cast.rollen.find((r) => r.id === id);
}
