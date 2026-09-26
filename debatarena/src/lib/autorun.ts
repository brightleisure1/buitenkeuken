import "server-only";
import { overBudget } from "./budget";
import { friendly } from "./errors";
import { autorunState, nextStep } from "./planner";
import { makeResult } from "./result";
import { getMessages, getRun, insertMessage } from "./runs";
import { clearStaleTurn, executeTurn } from "./turn";
import type { Run } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Hoe lang we wachten op het huiswerk voordat we toch beginnen (net als in de arena). */
const PREP_WAIT_MS = 120_000;
const MAX_STEPS = 80;

export { autorunState };

function prepDone(run: Run) {
  return run.cast.rollen.every((r) => {
    if (r.isJury) return true;
    const s = run.prep[r.id]?.homeworkStatus;
    return s === "klaar" || s === "mislukt";
  });
}

// Eén lus per vergadering tegelijk (de app draait als één server).
const running = new Set<string>();

/**
 * 'Alleen het advies': de server speelt de hele vergadering af zonder dat iemand kijkt,
 * en maakt daarna het advies van de voorzitter. Stopt als de baas toch gaat meekijken.
 */
export async function autorun(id: string) {
  if (running.has(id)) return;
  running.add(id);
  const started = Date.now();
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const run = await getRun(id);
      let messages = await getMessages(id);
      if (autorunState(messages) !== "aan" || run.status === "stopped" || run.result) return;

      // Eerst het huiswerk laten afmaken, net als in de arena.
      if (!messages.some((m) => m.kind === "turn") && !prepDone(run) && Date.now() - started < PREP_WAIT_MS) {
        await sleep(2000);
        i--;
        continue;
      }
      // Is er nog een beurt uit de arena bezig? Even laten uitpraten.
      const stale = await clearStaleTurn(messages);
      if (stale === "busy") {
        await sleep(2000);
        i--;
        continue;
      }
      if (stale === "cleared") messages = await getMessages(id);

      const step = nextStep(run, messages);
      if (step.type === "turn") {
        // Kostenlimiet bereikt: de voorzitter rondt af (dat mag altijd nog).
        if (overBudget(run) && !step.meta.verdict) {
          await insertMessage({ run_id: id, kind: "system", meta: { wrapUp: true, budget: true } });
          continue;
        }
        const r = await executeTurn(run, messages, step);
        if (!r.ok) {
          await insertMessage({ run_id: id, kind: "system", meta: { autorunError: { error: r.error ?? "Er ging iets mis.", oplossing: r.oplossing } } });
          return;
        }
      } else if (step.type === "final_word") {
        await insertMessage({ run_id: id, kind: "system", meta: { finalWordSkipped: true } });
      } else if (step.type === "result") {
        await makeResult(id);
        return;
      } else {
        return;
      }
    }
  } catch (e) {
    const err = friendly(e);
    await insertMessage({ run_id: id, kind: "system", meta: { autorunError: { error: err.message, oplossing: err.oplossing } } }).catch(() => {});
  } finally {
    running.delete(id);
  }
}
