import { handle } from "@/lib/route";
import { getMessages, getRun, insertMessage, updateMessage, updateRun } from "@/lib/runs";

/** Vergadering beëindigen zonder uitspraak. Later kan de voorzitter alsnog afronden. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = await getRun(id);
  if (run.status === "done" || run.status === "stopped") return Response.json({ ok: true, status: run.status });
  // Een beurt die nog open staat netjes afsluiten.
  for (const m of await getMessages(id)) {
    if (m.meta.streaming) await updateMessage(m.id, { meta: { ...m.meta, streaming: false, interrupted: true } });
  }
  await insertMessage({ run_id: id, kind: "system", meta: { stopped: true } });
  await updateRun(id, { status: "stopped" });
  return Response.json({ ok: true, status: "stopped" });
});
