import type { Message, Run, Step } from "./types";

/** Bepaalt wat er nu moet gebeuren, puur op basis van de opgeslagen berichten. */
export function nextStep(run: Run, messages: Message[]): Step {
  const roles = run.cast.rollen;
  const debaters = roles.filter((r) => !r.isJury);
  const jury = roles.find((r) => r.isJury);
  const turns = messages.filter((m) => m.kind === "turn");
  const R = run.cast.rondes;

  const wrappedUp = messages.some((m) => m.kind === "system" && m.meta.wrapUp);

  // Hoeveelste ronde loopt er?
  let current = R;
  for (let r = 1; r <= R; r++) {
    const spoken = new Set(turns.filter((t) => t.round === r && !t.meta.extra && !t.meta.answer).map((t) => t.role_id));
    if (debaters.some((d) => !spoken.has(d.id))) {
      current = r;
      break;
    }
  }

  // Een directe vraag van de baas gaat voor.
  const lastQuestion = [...messages].reverse().find((m) => m.kind === "boss" && m.meta.action === "vraag" && m.meta.target);
  if (lastQuestion && roles.some((r) => r.id === lastQuestion.meta.target)) {
    const answered = turns.some((t) => t.seq > lastQuestion.seq && t.role_id === lastQuestion.meta.target);
    if (!answered) return { type: "turn", roleId: lastQuestion.meta.target!, round: current, meta: { answer: true } };
  }

  if (!wrappedUp) {
    for (let r = 1; r <= R; r++) {
      const regular = turns.filter((t) => t.round === r && !t.meta.extra && !t.meta.answer);
      const spoken = new Set(regular.map((t) => t.role_id));
      const next = debaters.find((d) => !spoken.has(d.id));
      if (next) return { type: "turn", roleId: next.id, round: r, meta: {} };

      // Iedereen eens? Verdacht. De kritische rol krijgt een extra beurt.
      const unanimous = regular.length >= 2 && regular.every((t) => t.tag === "akkoord");
      const extraDone = turns.some((t) => t.round === r && t.meta.extra === "eensgezind");
      if (unanimous && !extraDone) {
        const critical = debaters.find((d) => d.isKritisch) ?? debaters[0];
        return { type: "turn", roleId: critical.id, round: r, meta: { extra: "eensgezind" } };
      }
    }
  }

  if (jury) {
    const hadFinalWord = messages.some((m) => (m.kind === "boss" && m.meta.finalWord) || (m.kind === "system" && m.meta.finalWordSkipped));
    if (!hadFinalWord) return { type: "final_word" };
    const verdictDone = turns.some((t) => t.role_id === jury.id && t.meta.verdict);
    if (!verdictDone) return { type: "turn", roleId: jury.id, round: R, meta: { verdict: true } };
  }

  if (!run.result) return { type: "result" };
  return { type: "done" };
}

export function currentRound(run: Run, messages: Message[]) {
  const turns = messages.filter((m) => m.kind === "turn" && m.round);
  return Math.max(1, ...turns.map((t) => t.round ?? 1));
}
