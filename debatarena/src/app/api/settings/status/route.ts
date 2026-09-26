import { handle } from "@/lib/route";
import { availableKeys } from "@/lib/settings";

/** Klein lampje in de navigatie: is er minstens één AI-sleutel? */
export const GET = handle(async () => {
  const k = await availableKeys();
  return Response.json({ aiKey: k.anthropic || k.openai || k.google || k.xai });
});
