import { after } from "next/server";
import { composeCast, fastModel } from "@/lib/casting";
import { generateJson } from "@/lib/llm";
import { IntakeSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { prepare } from "@/lib/prep";
import { body, handle } from "@/lib/route";
import { applyNiveau } from "@/lib/niveau";
import { defaultLimit } from "@/lib/budget";
import { getRun } from "@/lib/runs";
import type { Usage } from "@/lib/usage";
import { recordUsage } from "@/lib/usage-db";
import { db } from "@/lib/supabase";
import type { Attachment, Cast } from "@/lib/types";

export const maxDuration = 300;

function titleFrom(q: string) {
  const words = q.replace(/\s+/g, " ").trim().split(" ");
  return words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
}

/** Vraagt de baas zelf om stemmen? Anders staan ze uit. */
const WANTS_VOICES = /\b(stemmen|hardop|voorlezen|met stem|met geluid)\b/i;

/** Hooguit drie korte vragen die het advies echt beter maken (budget, termijn, wat er precies besloten moet worden). */
async function intakeVragen(q: string) {
  const { data, usage } = await generateJson(IntakeSchema, {
    model: await fastModel(),
    system: "Je helpt een directeur een vraagstuk scherp te krijgen voordat er advies over komt.",
    instruction: `VRAAGSTUK:\n${q}\n\nWelke 0 tot 3 korte vragen moet je de directeur stellen om een veel beter advies te kunnen geven? Alleen vragen waarvan het antwoord het advies echt verandert en die nog niet in het vraagstuk staan (bijvoorbeeld budget, termijn, wat er precies besloten moet worden, harde grenzen). Kort en in gewone taal.`,
    maxTokens: 600,
  });
  return { vragen: data.vragen.slice(0, 3), usage };
}

export const POST = handle(async (req: Request) => {
  const { question, attachmentIds = [], templateId, fromRunId, modus = "keten" } = await body<{
    question?: string;
    attachmentIds?: string[];
    templateId?: string;
    fromRunId?: string;
    modus?: "keten" | "vergadering";
  }>(req);
  const q = question?.trim();
  if (!q) throw new AppError("Je hebt nog geen vraagstuk ingevuld.", "Typ of spreek in waar je over wilt debatteren.");

  let attachments: Attachment[] = [];
  if (attachmentIds.length) {
    const { data } = await db().from("attachments").select("*").in("id", attachmentIds);
    attachments = (data ?? []) as Attachment[];
  }

  let cast: Cast;
  let usage: Usage | undefined;
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
    // Stemmen staan standaard uit; alleen aan als de baas er zelf om vraagt.
    cast = WANTS_VOICES.test(q) ? r.cast : { ...r.cast, stemmen: "uit" };
    usage = r.usage;
  }

  let intakeUsage: Usage | undefined;
  if (modus === "keten") {
    // Review-keten: geen show (stemmen, clichés, fun), twee rondes, en een paar verduidelijkende vragen vooraf.
    cast = { ...cast, modus: "keten", stemmen: "uit", fun: false, cliches: false, rondes: 2, rollen: cast.rollen.map((r) => ({ ...r, cliche: null, ongezouten: false })) };
    const iq = await intakeVragen(q).catch(() => null);
    if (iq) {
      cast = { ...cast, intake: iq.vragen.map((vraag) => ({ vraag, antwoord: "" })) };
      intakeUsage = iq.usage;
    }
  } else cast = { ...cast, modus: "vergadering" };
  if (cast.kostenlimiet === undefined) cast = { ...cast, kostenlimiet: await defaultLimit() };
  // Standaard: de sterkste modellen (instelbaar op het voorstelscherm).
  if (!cast.niveau) cast = applyNiveau(cast, "slim");
  const { count } = await db().from("runs").select("id", { count: "exact", head: true });
  const { data: run, error } = await db()
    .from("runs")
    .insert({ question: q, title: cast.titel, cast, status: "draft", debate_number: (count ?? 0) + 1 })
    .select("*")
    .single();
  if (error || !run) throw new AppError("Het debat kon niet worden aangemaakt.", "Controleer of de SQL-migratie is uitgevoerd en probeer het opnieuw.");

  if (attachments.length) await db().from("attachments").update({ run_id: run.id }).in("id", attachments.map((a) => a.id));
  await recordUsage(run.id, "samenstellen", usage);
  await recordUsage(run.id, "intake", intakeUsage);

  after(() => prepare(run.id));
  return Response.json({ run: await getRun(run.id) });
});
