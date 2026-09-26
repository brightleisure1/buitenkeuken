import { after } from "next/server";
import { prepare } from "@/lib/prep";
import { handle } from "@/lib/route";

export const maxDuration = 300;

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  after(() => prepare(id));
  return Response.json({ ok: true });
});
