import { handle } from "@/lib/route";
import { db } from "@/lib/supabase";

export const GET = handle(async (req: Request) => {
  const limit = Math.min(100, Number(new URL(req.url).searchParams.get("limit") ?? 50));
  const { data } = await db()
    .from("runs")
    .select("id, question, title, status, cost_eur, created_at, cast, prep, share_token")
    .order("created_at", { ascending: false })
    .limit(limit);
  const runs = (data ?? []).map((r) => ({
    id: r.id,
    question: r.question,
    title: r.title,
    status: r.status,
    cost_eur: Number(r.cost_eur),
    created_at: r.created_at,
    share_token: r.share_token,
    rollen: (r.cast?.rollen ?? []).map((x: { id: string; naam: string }) => ({
      id: x.id,
      naam: x.naam,
      portrait: r.prep?.[x.id]?.portraits?.neutraal ?? null,
    })),
  }));
  return Response.json({ runs });
});
