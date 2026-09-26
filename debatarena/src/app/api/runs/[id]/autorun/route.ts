import { after } from "next/server";
import { autorun } from "@/lib/autorun";
import { autorunState } from "@/lib/planner";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/route";
import { getMessages, getRun, insertMessage, updateRun } from "@/lib/runs";

type Ctx = { params: Promise<{ id: string }> };

/** 'Alleen het advies' aanzetten (of weer oppakken na een fout of herstart). */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const run = await getRun(id);
  if (run.result) return Response.json({ ok: true, klaar: true });
  if (run.status === "stopped") throw new AppError("Deze vergadering is beëindigd.", "Laat de voorzitter alsnog afronden op de resultaatpagina.");
  if (run.status === "draft") await updateRun(id, { status: "running" });
  if (autorunState(await getMessages(id)) !== "aan") await insertMessage({ run_id: id, kind: "system", meta: { autorun: true } });
  after(() => autorun(id));
  return Response.json({ ok: true });
});

/** Toch meekijken: de server stopt na de beurt die nu bezig is. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (autorunState(await getMessages(id)) !== "uit") await insertMessage({ run_id: id, kind: "system", meta: { autorunOff: true } });
  return Response.json({ ok: true });
});
