import { after } from "next/server";
import { composeCast } from "@/lib/casting";
import { AppError } from "@/lib/errors";
import { prepare } from "@/lib/prep";
import { body, handle } from "@/lib/route";
import { addCostUsd, getRun } from "@/lib/runs";
import { db } from "@/lib/supabase";
import type { Attachment, Cast } from "@/lib/types";

export const maxDuration = 300;

function titleFrom(q: string) {
  const words = q.replace(/\s+/g, " ").trim().split(" ");
  return words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
}

export const POST = handle(async (req: Request) => {
  const { question, attachmentIds = [], templateId, fromRunId } = await body<{
    question?: string;
    attachmentIds?: string[];
    templateId?: string;
    fromRunId?: string;
  }>(req);
  const q = question?.trim();
  if (!q) throw new AppError("Je hebt nog geen vraagstuk ingevuld.", "Typ of spreek in waar je over wilt debatteren.");

  let attachments: Attachment[] = [];
  if (attachmentIds.length) {
    const { data } = await db().from("attachments").select("*").in("id", attachmentIds);
    attachments = (data ?? []) as Attachment[];
  }

  let cast: Cast;
  let costUsd = 0;
  if (templateId || fromRunId) {
    // Hetzelfde team: geen AI-call nodig, dus meteen klaar.
    if (templateId) {
      const { data } = await db().from("templates").select("*").eq("id", templateId).maybeSingle();
      if (!data) throw new AppError("Dit team bestaat niet meer.", "Kies een ander team of laat de AI een nieuw team samenstellen.");
      cast = data.cast as Cast;
    } else {
      const prev = await getRun(fromRunId!);
      cast = {
        ...prev.cast,
        rollen: prev.cast.rollen.map((r) => ({ ...r, portraits: prev.prep[r.id]?.portraits ?? r.portraits })),
      };
    }
    cast = { ...cast, titel: titleFrom(q), bijlages: Object.fromEntries(attachments.map((a) => [a.id, "iedereen"])) };
  } else {
    const r = await composeCast(q, attachments);
    cast = r.cast;
    costUsd = r.costUsd;
  }

  const { count } = await db().from("runs").select("id", { count: "exact", head: true });
  const { data: run, error } = await db()
    .from("runs")
    .insert({ question: q, title: cast.titel, cast, status: "draft", debate_number: (count ?? 0) + 1 })
    .select("*")
    .single();
  if (error || !run) throw new AppError("Het debat kon niet worden aangemaakt.", "Controleer of de SQL-migratie is uitgevoerd en probeer het opnieuw.");

  if (attachments.length) await db().from("attachments").update({ run_id: run.id }).in("id", attachments.map((a) => a.id));
  await addCostUsd(run.id, costUsd);

  after(() => prepare(run.id));
  return Response.json({ run: await getRun(run.id) });
});
