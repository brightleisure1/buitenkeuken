import { after } from "next/server";
import { TTS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { body, handle } from "@/lib/route";
import { emptyUsage } from "@/lib/usage";
import { recordUsage } from "@/lib/usage-db";
import { db, upload } from "@/lib/supabase";
import { ttsStream } from "@/lib/voices";

export const maxDuration = 60;

/** Spreekt één zin uit via ElevenLabs en bewaart hem meteen bij het bericht (cache). */
export const POST = handle(async (req: Request) => {
  const { runId, messageId, idx, text, voiceId } = await body<{
    runId: string;
    messageId: string;
    idx: number;
    text: string;
    voiceId: string;
  }>(req);
  if (!text?.trim() || !voiceId) throw new AppError("Er is niets om uit te spreken.", "Controleer of deze rol een stem heeft.");

  const { data: msg } = await db().from("messages").select("audio, run_id, role_id").eq("id", messageId).maybeSingle();
  if (!msg || msg.run_id !== runId) throw new AppError("Dit bericht bestaat niet.", "Herlaad de pagina.");
  const cached = (msg.audio as { idx: number; url: string }[]).find((a) => a.idx === idx);
  if (cached) return Response.redirect(cached.url, 302);

  const spoken = text.replace(/\*[^*]+\*/g, "").replace(/\s+/g, " ").trim();
  if (!spoken) return new Response(null, { status: 204 });
  const res = await ttsStream(voiceId, spoken);
  const [toClient, toStore] = res.body!.tee();
  after(async () => {
    const chunks: Uint8Array[] = [];
    const reader = toStore.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length) return;
    const url = await upload("audio", `${runId}/${messageId}-${idx}.mp3`, buf, "audio/mpeg");
    await db().rpc("add_audio", { p_msg: messageId, p_item: { idx, url } });
    const u = emptyUsage("elevenlabs", TTS.model);
    u.units = text.length;
    u.costUsd = (text.length / 1000) * TTS.pricePer1kChars;
    await recordUsage(runId, "stem", u, msg.role_id);
  });
  return new Response(toClient, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
