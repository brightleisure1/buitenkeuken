"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { RunPayload } from "@/lib/payload";
import { CopyButton, ErrorNote, Spinner, toError } from "./ui";

type Err = { message: string; oplossing?: string } | null;

/** Voor het delen: voorbeeld bekijken, woorden wegpoetsen, rollen anoniem maken. */
export function ShareDialog({ payload, onClose, onChange }: { payload: RunPayload; onClose: () => void; onChange: () => void }) {
  const { run } = payload;
  const [words, setWords] = useState((run.share.redactions ?? []).join(", "));
  const [anonymous, setAnonymous] = useState(!!run.share.anonymous);
  const [token, setToken] = useState(run.share_token);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [making, setMaking] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const redactions = words
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
  const dirty = redactions.join("|") !== (run.share.redactions ?? []).join("|") || anonymous !== !!run.share.anonymous;

  async function save(publish = false) {
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ token: string | null }>(`/api/runs/${run.id}/share`, { method: "POST", json: { redactions, anonymous, publish } });
      setToken(d.token);
      setVersion((v) => v + 1);
      onChange();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  async function unshare() {
    await api(`/api/runs/${run.id}/share`, { method: "DELETE" }).catch((e) => setError(toError(e)));
    setToken(null);
    onChange();
  }

  async function makeHighlights() {
    setMaking(true);
    try {
      await api(`/api/runs/${run.id}/highlights`, { method: "POST" });
      onChange();
    } catch (e) {
      setError(toError(e));
    } finally {
      setMaking(false);
    }
  }

  const link = token ? `${origin}/replay/${token}` : null;
  const card = (f: "square" | "story") => `/api/runs/${run.id}/card?format=${f}&v=${version}`;
  const byId = new Map(payload.messages.map((m) => [m.id, m]));

  return (
    <div className="no-print fixed inset-0 z-50 bg-ink/40 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-cream w-full sm:max-w-3xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border-2 border-ink p-5 sm:p-7 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <h2 className="font-display font-extrabold text-2xl flex-1">Delen</h2>
          <button onClick={onClose} aria-label="Sluiten" className="text-2xl leading-none">
            ✕
          </button>
        </div>

        <ErrorNote error={error} onClose={() => setError(null)} />

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="font-semibold">Woorden wegpoetsen</span>
            <textarea
              className="field mt-1 !py-2"
              rows={2}
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder="Bijv. klantnaam, bedragen, projectnaam (scheid met komma's)"
            />
          </label>
          <div className="text-sm space-y-2">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              Rollen anoniem maken
            </label>
            <p className="text-ink/60">Namen worden functies, zoals &ldquo;De inkoper&rdquo;. Stemmen worden dan niet meegedeeld.</p>
            <button className="btn-ghost !py-1.5" disabled={!dirty || busy} onClick={() => save(false)}>
              {busy ? <Spinner /> : "Voorbeeld bijwerken"}
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Advieskaart</p>
          <div className="flex gap-4 items-start">
            {(["square", "story"] as const).map((f) => (
              <div key={f} className={f === "square" ? "w-1/2 sm:w-[45%]" : "w-[28%] sm:w-[25%]"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card(f)} alt={f === "square" ? "Kaart 1:1" : "Kaart 9:16"} className="w-full rounded-xl border-2 border-ink bg-white" />
                <a href={card(f)} download={`advies-${f === "square" ? "1x1" : "9x16"}.png`} className="text-sm underline mt-1 inline-block">
                  Download {f === "square" ? "1:1" : "9:16"}
                </a>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold mb-1">Hoogtepunten (ongeveer een minuut)</p>
          {run.highlights?.length ? (
            <ul className="text-sm space-y-1">
              {run.highlights.map((h) => {
                const m = byId.get(h.messageId);
                const r = run.cast.rollen.find((x) => x.id === m?.role_id);
                return (
                  <li key={h.messageId}>
                    ✨ <span className="font-semibold">{r?.naam}</span>: {h.waarom}
                  </li>
                );
              })}
            </ul>
          ) : (
            <button className="btn-ghost !py-1.5 text-sm" onClick={makeHighlights} disabled={making}>
              {making ? <Spinner /> : "Kies de scherpste momenten"}
            </button>
          )}
        </div>

        <div className="rounded-2xl border-2 border-ink bg-white p-4 space-y-2">
          <p className="text-sm font-semibold">Publieke replay-link</p>
          <p className="text-sm text-ink/60">Iedereen met de link kan het debat terugkijken (alleen lezen). Kosten en instructies zijn niet zichtbaar.</p>
          {link ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs bg-cream rounded-lg px-2 py-1.5 break-all flex-1 min-w-0">{link}</code>
              <CopyButton text={link} label="Kopieer link" />
              {dirty && (
                <button className="text-xs underline" onClick={() => save(true)}>
                  Wijzigingen toepassen
                </button>
              )}
              <button className="text-xs text-coral underline" onClick={unshare}>
                Stop met delen
              </button>
            </div>
          ) : (
            <button className="btn-primary !py-2" onClick={() => save(true)} disabled={busy}>
              Maak link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
