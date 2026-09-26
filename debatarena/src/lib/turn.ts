import "server-only";
import { attachmentImages, attachmentsFor, runAttachments } from "./attachments";
import { PROVIDERS, resolveModel } from "./config";
import { friendly } from "./errors";
import { streamText } from "./llm";
import { historyBlocks, isFridayAfternoon, roleSystem, turnInstruction } from "./prompts";
import { insertMessage, roleById, updateMessage } from "./runs";
import { recordUsage } from "./usage-db";
import { db } from "./supabase";
import { extractSources, splitTag } from "./text";
import type { Message, Run, Step, Tag } from "./types";

export type TurnEvent =
  | { t: "start"; message: Message; step: Step }
  | { t: "tag"; tag: Tag }
  | { t: "delta"; text: string }
  | { t: "end"; message: Message }
  | { t: "error"; error: string; oplossing?: string };

/**
 * Laat één rol zijn beurt doen en slaat die op.
 * Gebruikt door de arena (streamt naar de browser) en door "alleen het advies" (op de server).
 */
export async function executeTurn(
  run: Run,
  messages: Message[],
  step: Extract<Step, { type: "turn" }>,
  send: (e: TurnEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; oplossing?: string }> {
  const id = run.id;
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
    signal,
    cacheKey: `${id}:${role.id}`,
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
    return { ok: true };
  } catch (e) {
    const err = friendly(e);
    const partial = extractSources(splitTag(raw).rest).clean;
    if (partial) {
      await updateMessage(msg.id, { content: partial, tag, meta: { ...step.meta, streaming: false, interrupted: true } });
    } else {
      await db().from("messages").delete().eq("id", msg.id);
    }
    send({ t: "error", error: err.message, oplossing: err.oplossing });
    return { ok: false, error: err.message, oplossing: err.oplossing };
  }
}

/** Blijft er een beurt 'hangen' (browser dicht, server herstart)? Dan netjes opruimen. */
export async function clearStaleTurn(messages: Message[]): Promise<"busy" | "cleared" | "free"> {
  const live = messages.find((m) => m.meta.streaming);
  if (!live) return "free";
  if (Date.now() - Date.parse(live.created_at) < 120_000) return "busy";
  if (live.content) await updateMessage(live.id, { meta: { ...live.meta, streaming: false, interrupted: true } });
  else await db().from("messages").delete().eq("id", live.id);
  return "cleared";
}
