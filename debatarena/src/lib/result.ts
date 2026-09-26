import "server-only";
import { after } from "next/server";
import { runAttachments } from "./attachments";
import { resolveModel } from "./config";
import { AppError } from "./errors";
import { makeHighlights } from "./highlights";
import { generateJson } from "./llm";
import { historyBlocks, resultInstruction, roleSystem } from "./prompts";
import { getMessages, getRun, updateRun } from "./runs";
import { recordUsage } from "./usage-db";
import { JuryResultSchema } from "./schemas";
import type { JuryResult } from "./types";

function maxSentences(s: string, n: number) {
  const parts = s.match(/[^.!?]+[.!?]+/g);
  return parts && parts.length > n ? parts.slice(0, n).join("").trim() : s.trim();
}

/** Het eindresultaat van de voorzitter maken en bewaren (eenmalig). */
export async function makeResult(id: string): Promise<JuryResult> {
  const run = await getRun(id);
  if (run.result) return run.result;
  const messages = await getMessages(id);
  if (!messages.some((m) => m.kind === "turn")) {
    throw new AppError("Er is nog niets gezegd.", "Laat de rollen eerst debatteren voordat de voorzitter afrondt.");
  }
  const jury = run.cast.rollen.find((r) => r.isJury) ?? run.cast.rollen[0];
  const facts = run.cast.rollen
    .flatMap((r) => (run.prep[r.id]?.facts ?? []).map((f) => `- ${r.naam}: ${f.feit} (bron: ${f.bron})`))
    .join("\n");
  const system = `${roleSystem(run, jury, await runAttachments(id), { withFacts: false })}${facts ? `\nHUISWERK VAN DE ROLLEN:\n${facts}\n` : ""}`;

  const { data, usage } = await generateJson(
    JuryResultSchema,
    {
      model: resolveModel(jury.modelKey, jury.customModel),
      system,
      history: historyBlocks(run, messages),
      instruction: resultInstruction(run),
      maxTokens: 8000,
      deep: true,
    },
    1,
  );
  const result = { ...data, samenvatting: maxSentences(data.samenvatting, 3) };
  await recordUsage(id, "uitspraak", usage, jury.id);
  await updateRun(id, { result, status: "done" });
  after(() => makeHighlights(id).catch((e) => console.error("hoogtepunten mislukt", e)));
  return result;
}
