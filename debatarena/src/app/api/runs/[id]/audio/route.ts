import { TTS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/route";
import { getMessages, getRun } from "@/lib/runs";
import { voiceMap } from "@/lib/stemmen";
import { db, download, upload } from "@/lib/supabase";
import { emptyUsage } from "@/lib/usage";
import { recordUsage } from "@/lib/usage-db";
import { ttsStream } from "@/lib/voices";

export const maxDuration = 300;

const speakable = (t: string) => t.replace(/\*[^*]+\*/g, "").replace(/\s+/g, " ").trim();

/** De hele vergadering als één mp3: ontbrekende stukken worden eerst ingesproken. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = await getRun(id);
  const voices = await voiceMap(run.cast);
  if (!Object.keys(voices).length) {
    throw new AppError("Er zijn geen stemmen beschikbaar.", "Voeg bij Instellingen een ElevenLabs-sleutel toe.");
  }
  const messages = (await getMessages(id)).filter((m) => (m.kind === "turn" || m.kind === "boss") && m.content);
  const parts: Buffer[] = [];
  let chars = 0;
  for (const m of messages) {
    const existing = [...(m.audio ?? [])].sort((a, b) => a.idx - b.idx);
    if (existing.length) {
      for (const a of existing) {
        const path = a.url.split("/storage/v1/object/public/audio/")[1];
        const buf = path ? await download("audio", decodeURIComponent(path)) : null;
        if (buf) parts.push(buf);
      }
      continue;
    }
    const voiceId = m.kind === "boss" ? voices.baas : voices[m.role_id ?? ""];
    const text = speakable(m.content);
    if (!voiceId || !text) continue;
    const res = await ttsStream(voiceId, text);
    const buf = Buffer.from(await res.arrayBuffer());
    parts.push(buf);
    chars += text.length;
    const url = await upload("audio", `${id}/${m.id}-1000.mp3`, buf, "audio/mpeg");
    await db().rpc("add_audio", { p_msg: m.id, p_item: { idx: 1000, url } });
  }
  if (chars) {
    const u = emptyUsage("elevenlabs", TTS.model);
    u.units = chars;
    u.costUsd = (chars / 1000) * TTS.pricePer1kChars;
    await recordUsage(id, "stem", u);
  }
  const name = (run.title ?? "vergadering").replace(/[^\w\- ]+/g, "").trim() || "vergadering";
  return new Response(new Uint8Array(Buffer.concat(parts)), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `attachment; filename="${name}.mp3"`,
      "Cache-Control": "no-store",
    },
  });
});
