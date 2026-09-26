import { after } from "next/server";
import { AppError } from "@/lib/errors";
import { prepare } from "@/lib/prep";
import { body, handle } from "@/lib/route";
import { getRun, mergePrep, roleById, updateRun } from "@/lib/runs";

export const maxDuration = 300;

/** Nieuw portret voor één rol. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { roleId } = await body<{ roleId?: string }>(req);
  const run = await getRun(id);
  const role = roleById(run, roleId);
  if (!role) throw new AppError("Deze rol bestaat niet.", "Herlaad de pagina.");
  // Bewaarde templateportretten vergeten en de sleutel ongeldig maken, dan tekent prepare opnieuw.
  if (role.portraits) {
    await updateRun(id, { cast: { ...run.cast, rollen: run.cast.rollen.map((r) => (r.id === role.id ? { ...r, portraits: undefined } : r)) } });
  }
  await mergePrep(id, role.id, { portraitKey: "opnieuw", portraitStatus: "mislukt" });
  after(() => prepare(id));
  return Response.json({ ok: true });
});
