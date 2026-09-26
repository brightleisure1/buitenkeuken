import { toFile } from "openai";
import { STT } from "@/lib/config";
import { AppError, friendly } from "@/lib/errors";
import { openaiClient } from "@/lib/llm";
import { handle } from "@/lib/route";

export const maxDuration = 60;

/** Fallback voor spraakinvoer als de browser geen Web Speech heeft. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    throw new AppError("We hebben niets gehoord.", "Houd de microfoonknop iets langer vast en praat duidelijk.");
  }
  const client = await openaiClient().catch(() => {
    throw new AppError(
      "Inspreken werkt in deze browser alleen met een OpenAI-sleutel.",
      "Voeg bij Instellingen een OpenAI-sleutel toe, of gebruik Chrome of Safari.",
    );
  });
  try {
    const r = await client.audio.transcriptions.create({
      model: STT.model,
      file: await toFile(Buffer.from(await audio.arrayBuffer()), audio.name || "spraak.webm", { type: audio.type || "audio/webm" }),
      language: "nl",
    });
    return Response.json({ text: r.text });
  } catch (e) {
    throw friendly(e, "OpenAI");
  }
});
