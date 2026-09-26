import { AppError } from "@/lib/errors";
import { body, handle } from "@/lib/route";
import { getRun } from "@/lib/runs";
import { db } from "@/lib/supabase";

export const GET = handle(async () => {
  const { data } = await db().from("templates").select("*").order("created_at", { ascending: false });
  return Response.json({ templates: data ?? [] });
});

/** Sla de cast van een debat op als team, inclusief portretten. */
export const POST = handle(async (req: Request) => {
  const { runId, name } = await body<{ runId?: string; name?: string }>(req);
  if (!runId) throw new AppError("Welk team wil je bewaren?", "Open eerst een debat.");
  const run = await getRun(runId);
  const cast = {
    ...run.cast,
    bijlages: {},
    rollen: run.cast.rollen.map((r) => ({ ...r, portraits: run.prep[r.id]?.portraits ?? r.portraits })),
  };
  const { data, error } = await db()
    .from("templates")
    .insert({ name: name?.trim() || run.title || "Mijn team", cast })
    .select("*")
    .single();
  if (error) throw new AppError("Opslaan van het team lukte niet.", "Probeer het opnieuw.");
  return Response.json({ template: data });
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) await db().from("templates").delete().eq("id", id);
  return Response.json({ ok: true });
});
