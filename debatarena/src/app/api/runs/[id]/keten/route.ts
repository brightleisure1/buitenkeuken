import { after } from "next/server";
import { AppError } from "@/lib/errors";
import { MAX_RONDES, patchKeten, runKeten } from "@/lib/keten";
import { body, handle } from "@/lib/route";
import { getRun, updateRun } from "@/lib/runs";

export const maxDuration = 300;

/**
 * Start de review-keten (of pak hem weer op na een fout of herstart).
 * Met { extra: true } na afloop: nog een ronde, met de punten van de baas.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { extra } = await body<{ extra?: boolean }>(req);
  const run = await getRun(id);
  if (run.cast.modus !== "keten") throw new AppError("Dit is een vergadering, geen review-keten.", "Open hem via Geschiedenis.");
  if (extra) {
    if (run.keten?.status !== "klaar") throw new AppError("De keten is nog bezig.", "Wacht tot hij klaar is, dan kun je nog een ronde doen.");
    if ((run.keten.maxRondes ?? 2) >= MAX_RONDES + 2) throw new AppError("Genoeg rondes geweest.", "Meer rondes leveren meestal niets meer op. Begin eventueel een nieuw vraagstuk.");
    await patchKeten(id, (k) => {
      k.maxRondes = Math.max(k.maxRondes ?? 2, k.rondes.length);
      k.status = "bezig";
      k.stap = "Nog een ronde…";
      k.fase = "review";
      // Verder bouwen op de geredigeerde eindtekst.
      if (k.eind) k.rondes[k.rondes.length - 1].doc = k.eind;
      k.eind = undefined;
      k.slot = undefined;
      k.redactie = undefined;
      k.budgetOp = false;
    });
    await updateRun(id, { status: "running", result: null });
  } else {
    if (run.status === "done") return Response.json({ ok: true, klaar: true });
    if (run.status === "draft") await updateRun(id, { status: "running" });
    if (!run.keten) await patchKeten(id, () => undefined);
  }
  after(() => runKeten(id));
  return Response.json({ ok: true });
});
