import { AppError } from "@/lib/errors";
import { nextStep } from "@/lib/planner";
import { body, handle } from "@/lib/route";
import { getMessages, getRun, insertMessage } from "@/lib/runs";
import type { BossAction } from "@/lib/types";

const NEEDS_TEXT: BossAction[] = ["opmerking", "richting", "hamer", "vraag", "laatste_woord"];

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { action, text, target } = await body<{ action?: BossAction; text?: string; target?: string }>(req);
  const run = await getRun(id);
  const t = text?.trim() ?? "";
  if (!action) throw new AppError("Onbekende actie.", "Gebruik een van de knoppen in de arena.");
  if (NEEDS_TEXT.includes(action) && !t) {
    const hint =
      action === "hamer" ? "Typ of spreek in wat je besluit, en sla dan met de hamer." : "Typ of spreek eerst in wat je wilt zeggen.";
    throw new AppError("Je bericht is nog leeg.", hint);
  }
  if (action === "vraag" && !run.cast.rollen.some((r) => r.id === target)) {
    throw new AppError("Aan wie is de vraag?", "Kies eerst de rol die moet antwoorden.");
  }

  if (action === "overslaan") {
    await insertMessage({ run_id: id, kind: "system", meta: { finalWordSkipped: true } });
  } else if (action === "afronden") {
    await insertMessage({ run_id: id, kind: "system", meta: { wrapUp: true } });
  } else {
    await insertMessage({
      run_id: id,
      kind: "boss",
      content: t,
      meta: { action, target: action === "vraag" ? target : null, ...(action === "laatste_woord" ? { finalWord: true } : {}) },
    });
  }
  const messages = await getMessages(id);
  return Response.json({ messages, step: nextStep(run, messages) });
});
