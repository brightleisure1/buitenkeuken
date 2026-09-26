import { fastModel } from "@/lib/casting";
import { generateText } from "@/lib/llm";
import { historyBlocks, quipInstruction, roleSystem } from "@/lib/prompts";
import { body, handle } from "@/lib/route";
import { addCostUsd, getMessages, getRun, roleById } from "@/lib/runs";

/** Een rol die niet aan de beurt is, reageert kort in karakter. Wordt niet opgeslagen. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { roleId } = await body<{ roleId?: string }>(req);
  const run = await getRun(id);
  const role = roleById(run, roleId);
  if (!role) return Response.json({ text: "" });
  const messages = await getMessages(id);
  const { text, costUsd } = await generateText({
    model: await fastModel(),
    system: roleSystem(run, role, [], { withFacts: false }),
    history: historyBlocks(run, messages).slice(-4),
    instruction: quipInstruction(),
    maxTokens: 60,
  });
  await addCostUsd(id, costUsd);
  return Response.json({ text: text.replace(/^\[[a-z]+\]\s*/i, "").replace(/^["„]|["”]$/g, "") });
});
