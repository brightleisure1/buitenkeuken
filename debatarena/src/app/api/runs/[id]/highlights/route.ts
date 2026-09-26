import { makeHighlights } from "@/lib/highlights";
import { handle } from "@/lib/route";

export const maxDuration = 120;

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return Response.json({ highlights: await makeHighlights(id) });
});
