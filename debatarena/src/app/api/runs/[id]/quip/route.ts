import { fastModel } from "@/lib/casting";
import { generateText } from "@/lib/llm";
import { historyBlocks, quipInstruction, roleSystem } from "@/lib/prompts";
import { body, handle } from "@/lib/route";
import { getMessages, getRun, roleById } from "@/lib/runs";
import { recordUsage } from "@/lib/usage-db";

/** Een rol die niet aan de beurt is, reageert kort in karakter. Wordt niet opgeslagen. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { roleId } = await body<{ roleId?: string }>(req);
  const run = await getRun(id);
  const role = roleById(run, roleId);
  if (!role) return Response.json({ text: "" });
  const messages = await getMessages(id);
  const { text, usage } = await generateText({
    model: await fastModel(),
    system: roleSystem(run, role, [], { withFacts: false }),
    history: historyBlocks(run, messages).slice(-4),
    instruction: quipInstruction(),
    maxTokens: 60,
  });
  await recordUsage(id, "zinnetje", usage, role.id);
  return Response.json({ text: text.replace(/^\[[a-z]+\]\s*/i, "").replace(/^["„]|["”]$/g, "") });
});
