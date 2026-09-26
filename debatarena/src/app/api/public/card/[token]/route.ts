import { renderCard } from "@/lib/card";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/route";
import { getRunByToken } from "@/lib/runs";

export const GET = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const run = await getRunByToken(token);
  if (!run) throw new AppError("Deze link werkt niet meer.", "Vraag de maker om een nieuwe link.", 404);
  const format = new URL(req.url).searchParams.get("format") === "story" ? "story" : "square";
  return renderCard(run, format);
});
