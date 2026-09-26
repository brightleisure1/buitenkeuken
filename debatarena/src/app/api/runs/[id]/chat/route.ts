import { after } from "next/server";
import { runAttachments } from "@/lib/attachments";
import { editCast } from "@/lib/casting";
import { AppError } from "@/lib/errors";
import { prepare } from "@/lib/prep";
import { body, handle } from "@/lib/route";
import { getRun, updateRun } from "@/lib/runs";
import { recordUsage } from "@/lib/usage-db";

export const maxDuration = 300;

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { text, chat = [] } = await body<{ text?: string; chat?: { van: "baas" | "regie"; tekst: string }[] }>(req);
  if (!text?.trim()) throw new AppError("Je bericht is leeg.", "Typ of spreek in wat je wilt veranderen, bijv. 'Maak de inkoper strenger'.");
  const run = await getRun(id);
  if (run.status !== "draft") throw new AppError("Het debat is al begonnen.", "Grijp in via de knoppen in de arena, of start een nieuw debat.");
  const { antwoord, cast, usage } = await editCast(run.cast, run.question, text.trim(), chat, await runAttachments(id));
  await updateRun(id, { cast, title: cast.titel });
  await recordUsage(id, "aanpassen", usage);
  after(() => prepare(id));
  return Response.json({ antwoord, run: await getRun(id) });
});
