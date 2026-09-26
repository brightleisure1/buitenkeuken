import { after } from "next/server";
import { attachmentsFor, runAttachments } from "@/lib/attachments";
import { MAX_ROUNDS, MODELS } from "@/lib/config";
import { prepare } from "@/lib/prep";
import { nextStep } from "@/lib/planner";
import { body, handle } from "@/lib/route";
import { getMessages, getRun, updateRun } from "@/lib/runs";
import { availableKeys } from "@/lib/settings";
import { db } from "@/lib/supabase";
import type { Cast, Run } from "@/lib/types";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [run, messages, attachments, keys] = await Promise.all([getRun(id), getMessages(id), runAttachments(id), availableKeys()]);
  return Response.json({
    run,
    messages,
    step: run.status === "draft" ? null : nextStep(run, messages),
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    keys,
    models: MODELS.filter((m) => keys[m.provider]).map((m) => ({ key: m.key, label: m.label })),
    readers: Object.fromEntries(run.cast.rollen.map((r) => [r.id, attachmentsFor(attachments, run.cast.bijlages, r.id).map((a) => a.name)])),
  });
});

/** Handmatige aanpassingen (Geavanceerd), afvinken van aannames, titel. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body<{ cast?: Cast; result_checks?: Record<string, boolean>; title?: string }>(req);
  const patch: Partial<Run> = {};
  if (input.cast) {
    const c = input.cast;
    patch.cast = {
      ...c,
      rondes: Math.min(MAX_ROUNDS, Math.max(1, Math.round(Number(c.rondes) || 3))),
      rollen: c.rollen.map((r) => ({ ...r, customModel: r.customModel?.trim() || null })),
    };
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
