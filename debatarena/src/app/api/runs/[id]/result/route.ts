import { handle } from "@/lib/route";
import { makeResult } from "@/lib/result";

export const maxDuration = 300;

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return Response.json({ result: await makeResult(id) });
});
