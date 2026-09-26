import { after } from "next/server";
import { attachmentsFor, runAttachments } from "@/lib/attachments";
import { applyCliches } from "@/lib/cliches";
import { MAX_ROUNDS, MODELS, resolveModel } from "@/lib/config";
import { prepare } from "@/lib/prep";
import { nextStep } from "@/lib/planner";
import { body, handle } from "@/lib/route";
import { getMessages, getRun, updateRun } from "@/lib/runs";
import { availableKeys } from "@/lib/settings";
import { db } from "@/lib/supabase";
import { runUsageSummary } from "@/lib/usage-db";
import { voiceMap } from "@/lib/stemmen";
import type { Cast, Run } from "@/lib/types";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [run, messages, attachments, keys] = await Promise.all([getRun(id), getMessages(id), runAttachments(id), availableKeys()]);
  const [usage, stemmen] = await Promise.all([
    runUsageSummary(id, Object.fromEntries(run.cast.rollen.map((r) => [r.id, r.naam]))),
    keys.elevenlabs ? voiceMap(run.cast).catch(() => ({})) : Promise.resolve({}),
  ]);
  return Response.json({
    run,
    messages,
    step: run.status === "draft" ? null : nextStep(run, messages),
    usage,
    stemmen,
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    keys,
    models: MODELS.filter((m) => keys[m.provider]).map((m) => ({ key: m.key, label: m.label })),
    readers: Object.fromEntries(run.cast.rollen.map((r) => [r.id, attachmentsFor(attachments, run.cast.bijlages, r.id).map((a) => a.name)])),
  });
});

/** Handmatige aanpassingen (Geavanceerd), afvinken van aannames, titel. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body<{ cast?: Cast; result_checks?: Record<string, boolean>; title?: string; handmatig?: boolean }>(req);
  const patch: Partial<Run> = {};
  if (input.cast) {
    const c = input.cast;
    const before = input.handmatig ? null : await getRun(id);
    // Clichés alleen automatisch uitdelen als de schakelaar net aan is gezet.
    const autoFill = !!c.cliches && !!before && !before.cast.cliches;
    patch.cast = applyCliches({
      ...c,
      rondes: Math.min(MAX_ROUNDS, Math.max(1, Math.round(Number(c.rondes) || 3))),
      rollen: c.rollen.map((r) => {
        const customModel = r.customModel?.trim() || null;
        // Ongezouten kan alleen bij Grok.
        const ongezouten = !!r.ongezouten && resolveModel(r.modelKey, customModel).provider === "xai";
        return { ...r, customModel, ongezouten };
      }),
    }, autoFill);
  }
  if (input.result_checks) patch.result_checks = input.result_checks;
  if (input.title !== undefined) patch.title = input.title;
  await updateRun(id, patch);
  if (input.cast) after(() => prepare(id));
  return Response.json({ run: await getRun(id) });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await db().from("runs").delete().eq("id", id);
  return Response.json({ ok: true });
});
