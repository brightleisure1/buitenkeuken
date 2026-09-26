import { renderCard } from "@/lib/card";
import { handle } from "@/lib/route";
import { getRun } from "@/lib/runs";

export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "story" ? "story" : "square";
  return renderCard(await getRun(id), format);
});
