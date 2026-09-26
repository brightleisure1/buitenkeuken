import { after } from "next/server";
import { autorunState, nextStep } from "@/lib/planner";
import { handle } from "@/lib/route";
import { limitOf, overBudget } from "@/lib/budget";
import { getMessages, getRun, updateRun } from "@/lib/runs";
import { clearStaleTurn, executeTurn } from "@/lib/turn";

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

  // Iemand praat al (tweede tabblad, of 'alleen het advies' op de server) — niet dubbel laten praten.
  // 'Alleen het advies' loopt op de server: de browser speelt niet mee.
  if (autorunState(messages) === "aan") return Response.json({ busy: true, auto: true });
  const stale = await clearStaleTurn(messages);
  if (stale === "busy") return Response.json({ busy: true });
  if (stale === "cleared") messages = await getMessages(id);

  const step = nextStep(run, messages);
  if (step.type !== "turn") return Response.json({ step });
  // Kostenlimiet: geen nieuwe beurten meer, alleen het slotadvies van de voorzitter mag nog.
  if (overBudget(run) && !step.meta.verdict) {
    return Response.json({ step: { type: "budget", limit: limitOf(run), cost: run.cost_eur } });
  }

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
      try {
        await executeTurn(run, messages, step, send, req.signal);
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
