"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, datum, euro } from "@/lib/client";
import { tokens } from "@/lib/usage";
import type { Cast } from "@/lib/types";
import { ErrorNote, Portrait, Spinner, toError } from "@/components/ui";

type Row = {
  id: string;
  title: string | null;
  question: string;
  status: string;
  created_at: string;
  cost_eur: number;
  tokens: number;
  share_token: string | null;
  rollen: { id: string; naam: string; portrait: string | null }[];
};
type Template = { id: string; name: string; cast: Cast; created_at: string };

const STATUS: Record<string, string> = { draft: "Voorstel", running: "Loopt", done: "Afgerond", stopped: "Gestopt" };

export default function HistoryPage() {
  const [runs, setRuns] = useState<Row[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<{ message: string; oplossing?: string } | null>(null);

  useEffect(() => {
    api<{ runs: Row[] }>("/api/runs?limit=100")
      .then((d) => setRuns(d.runs))
      .catch((e) => setError(toError(e)));
    api<{ templates: Template[] }>("/api/templates")
      .then((d) => setTemplates(d.templates))
      .catch(() => {});
  }, []);

  async function remove(id: string) {
    if (!confirm("Dit debat verwijderen? Dat kan niet ongedaan worden.")) return;
    await api(`/api/runs/${id}`, { method: "DELETE" }).catch((e) => setError(toError(e)));
    setRuns((r) => r?.filter((x) => x.id !== id) ?? null);
  }

  async function stopRun(id: string) {
    if (!confirm("Deze vergadering beëindigen? Er komt dan geen slotadvies (dat kun je later alsnog vragen).")) return;
    await api(`/api/runs/${id}/stop`, { method: "POST" }).catch((e) => setError(toError(e)));
    setRuns((r) => r?.map((x) => (x.id === id ? { ...x, status: "stopped" } : x)) ?? null);
  }

  async function removeTemplate(id: string) {
    if (!confirm("Dit team verwijderen?")) return;
    await api(`/api/templates?id=${id}`, { method: "DELETE" }).catch((e) => setError(toError(e)));
    setTemplates((t) => t.filter((x) => x.id !== id));
  }

  const total = runs?.reduce((s, r) => s + r.cost_eur, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 space-y-8">
      <div className="flex items-end gap-4">
        <h1 className="font-display text-3xl font-extrabold flex-1">Geschiedenis</h1>
        {runs && (
          <span className="text-sm text-ink/60">
            Totaal: {euro(total)} · {tokens(runs.reduce((s, r) => s + r.tokens, 0))} tokens
          </span>
        )}
      </div>
      <ErrorNote error={error} />
      {!runs && !error && <Spinner className="h-6 w-6" />}
      {runs?.length === 0 && (
        <p className="text-ink/70">
          Nog geen debatten. <Link href="/" className="underline">Start je eerste</Link>.
        </p>
      )}
      <ul className="space-y-3">
        {runs?.map((r) => (
          <li key={r.id} className="card p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
            <span className="flex -space-x-3 shrink-0">
              {r.rollen.slice(0, 5).map((x, i) => (
                <Portrait key={x.id} name={x.naam} portraits={x.portrait ? { neutraal: x.portrait } : undefined} index={i} size={40} />
              ))}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{r.title || r.question}</p>
              <p className="text-xs text-ink/60">
                {datum(r.created_at)} · {STATUS[r.status] ?? r.status} · {euro(r.cost_eur)} · {tokens(r.tokens)} tokens
                {r.share_token && " · gedeeld"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {r.status === "draft" ? (
                <Link href={`/?run=${r.id}`} className="btn-ghost !py-1.5 !px-3">
                  Verder instellen
                </Link>
              ) : (
                <Link href={`/arena/${r.id}`} className="btn-ghost !py-1.5 !px-3">
                  {r.status === "done" || r.status === "stopped" ? "Afspelen" : "Naar de arena"}
                </Link>
              )}
              {(r.status === "done" || r.status === "stopped") && (
                <Link href={`/resultaat/${r.id}`} className="btn-ghost !py-1.5 !px-3">
                  Resultaat
                </Link>
              )}
              {r.status === "running" && (
                <button onClick={() => stopRun(r.id)} className="btn-ghost !py-1.5 !px-3">
                  ⏹ Stoppen
                </button>
              )}
              <button onClick={() => remove(r.id)} className="text-coral underline px-1">
                Verwijder
              </button>
            </div>
          </li>
        ))}
      </ul>

      {templates.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-extrabold mb-3">Bewaarde teams</h2>
          <ul className="grid sm:grid-cols-2 gap-3">
            {templates.map((t) => (
              <li key={t.id} className="card p-4 flex items-center gap-3">
                <span className="flex -space-x-3">
                  {t.cast.rollen.slice(0, 5).map((r, i) => (
                    <Portrait key={r.id} name={r.naam} portraits={r.portraits} index={i} size={36} />
                  ))}
                </span>
                <span className="flex-1 min-w-0 font-semibold truncate">{t.name}</span>
                <button onClick={() => removeTemplate(t.id)} className="text-sm text-coral underline">
                  Verwijder
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
