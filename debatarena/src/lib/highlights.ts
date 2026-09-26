import "server-only";
import { fastModel } from "./casting";
import { generateJson } from "./llm";
import { highlightsInstruction } from "./prompts";
import { getMessages, getRun, updateRun } from "./runs";
import { recordUsage } from "./usage-db";
import { HighlightsSchema } from "./schemas";
import type { Highlight } from "./types";

/** Laat een snel model de 3-4 scherpste momenten kiezen. */
export async function makeHighlights(runId: string): Promise<Highlight[]> {
  const [run, messages] = await Promise.all([getRun(runId), getMessages(runId)]);
  const turns = messages.filter((m) => m.kind === "turn" && m.content);
  if (!turns.length) return [];
  const numbered = turns
    .map((m, i) => {
      const r = run.cast.rollen.find((x) => x.id === m.role_id);
      return `#${i + 1} ${r?.naam ?? "?"}${m.tag ? ` [${m.tag}]` : ""}: ${m.content}`;
    })
    .join("\n");
  const { data, usage } = await generateJson(HighlightsSchema, {
    model: await fastModel(),
    system: "Je bent een scherpe eindredacteur die de beste momenten uit een zakelijk debat kiest.",
    instruction: highlightsInstruction(numbered),
    maxTokens: 800,
  });
  const seen = new Set<string>();
  const highlights: Highlight[] = [];
  for (const m of data.momenten) {
    const t = turns[m.nummer - 1];
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      highlights.push({ messageId: t.id, waarom: m.waarom });
    }
  }
  const picked = highlights.slice(0, 4).sort((a, b) => turns.findIndex((t) => t.id === a.messageId) - turns.findIndex((t) => t.id === b.messageId));
  await updateRun(runId, { highlights: picked });
  await recordUsage(runId, "hoogtepunten", usage);
  return picked;
}
