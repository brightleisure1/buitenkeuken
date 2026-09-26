import { after } from "next/server";
import { runAttachments } from "@/lib/attachments";
import { resolveModel } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { makeHighlights } from "@/lib/highlights";
import { generateJson } from "@/lib/llm";
import { historyBlocks, resultInstruction, roleSystem } from "@/lib/prompts";
import { handle } from "@/lib/route";
import { getMessages, getRun, updateRun } from "@/lib/runs";
import { recordUsage } from "@/lib/usage-db";
import { JuryResultSchema } from "@/lib/schemas";

export const maxDuration = 300;

function maxSentences(s: string, n: number) {
  const parts = s.match(/[^.!?]+[.!?]+/g);
  return parts && parts.length > n ? parts.slice(0, n).join("").trim() : s.trim();
}

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const run = await getRun(id);
  if (run.result) return Response.json({ result: run.result });
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
  return Response.json({ result });
});
