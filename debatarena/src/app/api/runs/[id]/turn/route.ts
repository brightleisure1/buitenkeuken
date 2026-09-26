import { after } from "next/server";
import { attachmentImages, attachmentsFor, runAttachments } from "@/lib/attachments";
import { PROVIDERS, resolveModel } from "@/lib/config";
import { friendly } from "@/lib/errors";
import { streamText } from "@/lib/llm";
import { nextStep } from "@/lib/planner";
import { historyBlocks, isFridayAfternoon, roleSystem, turnInstruction } from "@/lib/prompts";
import { handle } from "@/lib/route";
import { limitOf, overBudget } from "@/lib/budget";
import { getMessages, getRun, insertMessage, roleById, updateMessage, updateRun } from "@/lib/runs";
import { recordUsage } from "@/lib/usage-db";
import { db } from "@/lib/supabase";
import { extractSources, splitTag } from "@/lib/text";
import type { Tag } from "@/lib/types";

export const maxDuration = 300;

/**
 * Speelt de volgende stap van het debat af.
 * Is het een beurt, dan streamt het antwoord als NDJSON:
 * {t:"start"} → {t:"tag"} → {t:"delta"}… → {t:"end"} (of {t:"error"}).
 * Anders komt er gewoon JSON terug met de volgende stap.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = await getRun(id);
  let messages = await getMessages(id);
  if (run.status === "draft") await updateRun(id, { status: "running" });

  // Iemand praat al (tweede tabblad?) — niet dubbel laten praten.
  const live = messages.find((m) => m.meta.streaming);
  if (live) {
    if (Date.now() - Date.parse(live.created_at) < 120_000) return Response.json({ busy: true });
    // Blijven hangen: afronden als onderbroken of weggooien.
    if (live.content) await updateMessage(live.id, { meta: { ...live.meta, streaming: false, interrupted: true } });
    else await db().from("messages").delete().eq("id", live.id);
    messages = await getMessages(id);
  }

  const step = nextStep(run, messages);
  if (step.type !== "turn") return Response.json({ step });
  // Kostenlimiet: geen nieuwe beurten meer, alleen de uitspraak van de Jury mag nog.
  if (overBudget(run) && !step.meta.verdict) {
    return Response.json({ step: { type: "budget", limit: limitOf(run), cost: run.cost_eur } });
  }

  const role = roleById(run, step.roleId)!;
  const all = await runAttachments(id);
  const mine = attachmentsFor(all, run.cast.bijlages, role.id);
  const model = resolveModel(role.modelKey, role.customModel);
  const msg = await insertMessage({
    run_id: id,
    kind: "turn",
    role_id: role.id,
    round: step.round,
    meta: { ...step.meta, streaming: true },
  });

  const prompt = {
    model,
    system: roleSystem(run, role, mine, { withFacts: true }),
    images: await attachmentImages(mine),
    history: historyBlocks(run, messages),
    instruction: turnInstruction({ run, role, messages, round: step.round, meta: step.meta }),
    maxTokens: run.cast.stemmen === "iedereen" ? 450 : 700,
    signal: req.signal,
    cacheKey: `${id}:${role.id}`,
  };

  const encoder = new TextEncoder();
  let finished!: () => void;
  const done = new Promise<void>((r) => (finished = r));
  // Ook als de baas halverwege afbreekt, moet de beurt netjes worden opgeslagen.
  after(() => done);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
        } catch {
          /* client is weg */
        }
      };
      send({ t: "start", message: msg, step });

      let raw = "";
      let emitted = 0;
      let tag: Tag | null = null;
      const onDelta = (d: string) => {
        raw += d;
        const s = splitTag(raw);
        if (s.pending) return;
        if (s.tag && !tag) {
          tag = s.tag;
          send({ t: "tag", tag });
        }
        const fresh = s.rest.slice(emitted);
        if (fresh) {
          emitted += fresh.length;
          send({ t: "delta", text: fresh });
        }
      };

      try {
        const r = await streamText(prompt, onDelta);
        let text = splitTag(raw).rest;
        if (step.meta.verdict && isFridayAfternoon() && !/fijn weekend/i.test(text) && !r.aborted) {
          text = `${text.trim()} Fijn weekend!`;
          send({ t: "delta", text: " Fijn weekend!" });
        }
        const { clean, sources } = extractSources(text);
        if (r.aborted && !clean) {
          await db().from("messages").delete().eq("id", msg.id);
          await recordUsage(id, "beurt", r.usage, role.id);
        } else {
          const eur = await recordUsage(id, step.meta.verdict ? "uitspraak" : "beurt", r.usage, role.id);
          const meta = {
            ...step.meta,
            streaming: false,
            ...(r.aborted ? { interrupted: true } : {}),
            ...(r.fellBack && r.usedModel
              ? { fallback: { van: PROVIDERS[model.provider].naam, naar: PROVIDERS[r.usedModel.provider].naam, model: r.usedModel.model } }
              : {}),
          };
          await updateMessage(msg.id, { content: clean, sources, tag: tag ?? splitTag(raw).tag, meta, cost_eur: eur });
          send({ t: "end", message: { ...msg, content: clean, sources, tag, meta, cost_eur: eur } });
        }
      } catch (e) {
        const err = friendly(e);
        const partial = extractSources(splitTag(raw).rest).clean;
        if (partial) {
          await updateMessage(msg.id, { content: partial, tag, meta: { ...step.meta, streaming: false, interrupted: true } });
        } else {
          await db().from("messages").delete().eq("id", msg.id);
        }
        send({ t: "error", error: err.message, oplossing: err.oplossing });
      } finally {
        finished();
        try {
          controller.close();
        } catch {
          /* al dicht */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
});
