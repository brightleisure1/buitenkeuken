import { body, handle } from "@/lib/route";
import { makeComparison, saveChoice } from "@/lib/vergelijk";

export const maxDuration = 300;

/** Zonder keuze: maak de vergelijking. Met keuze: bewaar welk advies je beter vond. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { keuze } = await body<{ keuze?: string }>(req);
  if (keuze === "debat" || keuze === "enkel" || keuze === "gelijk") return Response.json({ vergelijking: await saveChoice(id, keuze) });
  return Response.json({ vergelijking: await makeComparison(id) });
});
