import { after } from "next/server";
import { prepare } from "@/lib/prep";
import { handle } from "@/lib/route";
import { getRun, updateRun } from "@/lib/runs";

export const maxDuration = 300;

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = await getRun(id);
  if (run.status === "draft") await updateRun(id, { status: "running" });
  after(() => prepare(id));
  return Response.json({ ok: true });
});
