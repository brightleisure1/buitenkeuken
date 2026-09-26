"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, datum, euro } from "@/lib/client";
import { sectionText, toMarkdown, transcriptLines } from "@/lib/markdown";
import type { RunPayload } from "@/lib/payload";
import type { EnkelAdvies, JuryResult, Vergelijking } from "@/lib/types";
import { CostPanel } from "./CostPanel";
import { ShareDialog } from "./ShareDialog";
import { tokens } from "@/lib/usage";
import { CopyButton, ErrorNote, Portrait, toError } from "./ui";
import { FunWait } from "./FunWait";
import { SpeechQueue } from "@/lib/speech";
import { extractSources } from "@/lib/text";
import { AUDIO_LINES, JURY_LINES, LOADING_LINES } from "@/lib/wachten";

type Err = { message: string; oplossing?: string } | null;

export function ResultView({ id }: { id: string }) {
  const [data, setData] = useState<RunPayload | null>(null);
  const [error, setError] = useState<Err>(null);
  const [making, setMaking] = useState(false);
  const [share, setShare] = useState(false);
  const [saved, setSaved] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const started = useRef(false);
  const speechRef = useRef<SpeechQueue | null>(null);
  const [readingAdvice, setReadingAdvice] = useState(false);
  useEffect(() => () => speechRef.current?.stop(), []);

  const load = useCallback(async () => {
    const d = await api<RunPayload>(`/api/runs/${id}`);
    setData(d);
    return d;
  }, [id]);

  const makeResult = useCallback(async () => {
    setMaking(true);
    setError(null);
    try {
      await api(`/api/runs/${id}/result`, { method: "POST" });
      await load();
    } catch (e) {
      setError(toError(e));
    } finally {
      setMaking(false);
    }
  }, [id, load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data ophalen; state wordt pas na de fetch gezet
    load()
      .then((d) => {
        if (!d.run.result && d.run.status !== "stopped" && !started.current && d.messages.some((m) => m.kind === "turn")) {
          started.current = true;
          void makeResult();
        }
      })
      .catch((e) => setError(toError(e)));
  }, [load, makeResult]);

  // Hoogtepunten komen na de uitslag op de achtergrond binnen.
  const polls = useRef(0);
  useEffect(() => {
    if (!data?.run.result || data.run.highlights || polls.current > 8) return;
    const t = setTimeout(() => {
      polls.current++;
      void load().catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [data, load]);

  // Bij printen (PDF) ook de transcript meenemen.
  useEffect(() => {
    const open = () => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);

  if (!data) {
    return <div className="flex-1 grid place-items-center p-6 text-center">{error ? <ErrorNote error={error} /> : <FunWait lines={LOADING_LINES} size="lg" />}</div>;
  }

  const { run, messages } = data;
  const r = run.result;
  // Het slotwoord van de voorzitter, om voor te laten lezen.
  const advice = messages.find((m) => m.kind === "turn" && m.meta.verdict && m.content);
  const voorzitter = run.cast.rollen.find((x) => x.isJury);
  const adviceVoice = voorzitter ? (data.stemmen?.[voorzitter.id] ?? voorzitter.stemId) : null;

  async function readAdvice() {
    if (readingAdvice) {
      speechRef.current?.stop();
      setReadingAdvice(false);
      return;
    }
    if (!advice || !adviceVoice) return;
    speechRef.current ??= new SpeechQueue();
    const q = speechRef.current;
    q.stop();
    setReadingAdvice(true);
    if (advice.audio?.length) [...advice.audio].sort((a, b) => a.idx - b.idx).forEach((a) => q.playUrl(a.url));
    else {
      const text = extractSources(advice.content).clean.replace(/\*[^*]+\*/g, "").replace(/\s+/g, " ").trim();
      q.say({ runId: id, messageId: advice.id, idx: 1000, text, voiceId: adviceVoice });
    }
    await q.idle();
    setReadingAdvice(false);
  }

  if (!r) {
    return (
      <div className="mx-auto max-w-xl p-6 space-y-4 text-center">
        {making ? (
          <div className="card p-6 bg-sun text-left">
            <span className="block text-xs font-semibold uppercase tracking-wide text-ink/60 mb-2">De voorzitter zet alles op een rij</span>
            <FunWait lines={JURY_LINES} size="lg" />
          </div>
        ) : (
          <>
            <ErrorNote error={error} />
            <h1 className="font-display text-2xl font-extrabold">{run.title ?? run.question}</h1>
            <p>{run.status === "stopped" ? "Deze vergadering is beëindigd zonder slotadvies." : "Er is nog geen advies."}</p>
            <div className="flex gap-2 justify-center">
              <Link href={`/arena/${id}`} className="btn-ghost">
                Naar de arena
              </Link>
              {messages.some((m) => m.kind === "turn") && (
                <button className="btn-primary" onClick={makeResult}>
                  {run.status === "stopped" ? "Laat de voorzitter alsnog afronden" : "Laat de voorzitter afronden"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  const t = sectionText(r);
  const checks = run.result_checks ?? {};

  async function toggle(i: number) {
    const next = { ...checks, [i]: !checks[i] };
    setData((d) => (d ? { ...d, run: { ...d.run, result_checks: next } } : d));
    await api(`/api/runs/${id}`, { method: "PATCH", json: { result_checks: next } }).catch((e) => setError(toError(e)));
  }

  function downloadMd() {
    const blob = new Blob([toMarkdown(run, messages, checks)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(run.title ?? "debat").replace(/[^\w\- ]+/g, "").trim() || "debat"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function downloadAudio() {
    setAudioBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${id}/audio`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw Object.assign(new Error(d.error ?? "De opname lukte niet."), { oplossing: d.oplossing });
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(run.title ?? "vergadering").replace(/[^\w\- ]+/g, "").trim() || "vergadering"}.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setError(toError(e));
    } finally {
      setAudioBusy(false);
    }
  }

  async function saveTeam() {
    try {
      await api("/api/templates", { method: "POST", json: { runId: id } });
      setSaved(true);
    } catch (e) {
      setError(toError(e));
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 space-y-5">
      <header className="space-y-3">
        <p className="text-sm text-ink/60">
          {datum(run.created_at)} · {euro(run.cost_eur)}
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold">{run.title ?? run.question}</h1>
        <p className="text-ink/70">{run.question}</p>
        <div className="flex -space-x-2">
          {run.cast.rollen.map((x, i) => (
            <Portrait key={x.id} name={x.naam} portraits={run.prep[x.id]?.portraits} index={i} size={40} />
          ))}
        </div>
        <div className="no-print flex flex-wrap gap-2 pt-1">
          <button className="btn-primary !py-2" onClick={() => setShare(true)}>
            Delen
          </button>
          <button className="btn-ghost !py-2" onClick={() => window.print()} title="Kies 'Opslaan als PDF' in het printvenster">
            PDF (A4)
          </button>
          <button className="btn-ghost !py-2" onClick={downloadMd}>
            Markdown
          </button>
          <Link href={`/arena/${id}`} className="btn-ghost !py-2">
            Terugkijken
          </Link>
          {data.keys.elevenlabs && (
            <>
              <Link href={`/arena/${id}?luister=1`} className="btn-ghost !py-2">
                🎧 Beluister de vergadering
              </Link>
              <button className="btn-ghost !py-2" onClick={downloadAudio} disabled={audioBusy}>
                {audioBusy ? <FunWait lines={AUDIO_LINES} /> : "⬇ Download als mp3"}
              </button>
            </>
          )}
        </div>
      </header>

      <ErrorNote error={error} onClose={() => setError(null)} />

      <Section title="Advies van de voorzitter" copy={t.samenvatting} tone="bg-sun">
        <p className="font-display text-2xl font-extrabold leading-tight">{r.uitslag}</p>
        <p className="mt-2 text-[17px] leading-relaxed">{r.samenvatting}</p>
        {data.keys.elevenlabs && advice && adviceVoice && (
          <button className="btn-ghost !py-1.5 text-sm mt-3" onClick={() => void readAdvice()}>
            {readingAdvice ? "⏹ Stop met voorlezen" : "🔊 Laat de voorzitter het advies voorlezen"}
          </button>
        )}
      </Section>

      <Section title="Besluiten van de baas" copy={t.besluiten}>
        {r.besluitenVanDeBaas.length ? (
          <ul className="space-y-1.5">
            {r.besluitenVanDeBaas.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span>🔨</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink/60">Je hebt geen besluiten genomen met de hamer.</p>
        )}
      </Section>

      <Section title="Strategie" copy={`${t.strategie}\n\nVolgende stappen:\n${t.volgendeStappen}`}>
        <ol className="space-y-4">
          {r.strategie.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 h-7 w-7 rounded-full bg-ink text-cream grid place-items-center text-sm font-bold">{i + 1}</span>
              <div>
                <p className="font-semibold">{s.stap}</p>
                <p className="text-ink/75 text-sm mt-0.5">Waarom: {s.waarom}</p>
                <p className="text-sm mt-0.5">
                  <span className="font-semibold">Eerste actie:</span> {s.eersteActie}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {r.volgendeStappen.length > 0 && (
          <div className="mt-5 pt-4 border-t border-ink/10">
            <p className="font-semibold mb-1">Volgende stappen</p>
            <ul className="list-disc pl-5 space-y-1">
              {r.volgendeStappen.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Aannames" copy={t.aannames}>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="p-2 w-10">Getest</th>
                <th className="p-2">Aanname</th>
                <th className="p-2">Risico</th>
                <th className="p-2">Hoe testen</th>
              </tr>
            </thead>
            <tbody>
              {r.aannames.map((a, i) => (
                <tr key={i} className={`border-t border-ink/10 align-top ${checks[i] ? "opacity-60" : ""}`}>
                  <td className="p-2">
                    <input type="checkbox" checked={!!checks[i]} onChange={() => toggle(i)} className="h-4 w-4 accent-[var(--color-coral)]" aria-label="Getest" />
                  </td>
                  <td className="p-2">
                    {a.aanname}
                    {a.onbewezen && <span className="ml-1.5 text-[11px] rounded-full bg-peach px-1.5 py-0.5">onbewezen</span>}
                  </td>
                  <td className="p-2">{a.risico}</td>
                  <td className="p-2">{a.hoeTesten}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Onenigheid" copy={t.onenigheid}>
        {r.onenigheid.length ? (
          <div className="space-y-4">
            {r.onenigheid.map((o, i) => (
              <div key={i}>
                <p className="font-semibold">{o.punt}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {o.standpuntPerRol.map((s, j) => (
                    <li key={j}>
                      <span className="font-semibold">{s.rol}:</span> {s.standpunt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ink/60">Geen blijvende onenigheid.</p>
        )}
      </Section>

      <Section title="Bronnen" copy={t.bronnen}>
        {r.bronnen.length ? (
          <ul className="space-y-1 text-sm">
            {r.bronnen.map((b, i) => (
              <li key={i}>
                <span className="font-semibold">{b.naam}</span> <span className="text-ink/60">— {b.gebruiktDoor}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink/60">Er zijn geen bronnen genoemd. Alles wat gezegd is, is dus mening.</p>
        )}
      </Section>

      <Vergelijk id={id} result={r} totalCost={run.cost_eur} onChange={() => void load()} />

      <details className="card p-5">
        <summary className="cursor-pointer font-display font-bold text-lg flex items-center gap-2">
          Tokens en kosten
          <span className="ml-auto text-sm font-sans font-normal text-ink/60">
            {euro(run.cost_eur)} · {tokens(data.usage.total.inputTokens + data.usage.total.cachedTokens + data.usage.total.outputTokens)} tokens
          </span>
        </summary>
        <div className="mt-4">
          <CostPanel usage={data.usage} roles={run.cast.rollen} />
        </div>
      </details>

      <details className="card p-5">
        <summary className="cursor-pointer font-display font-bold text-lg flex items-center gap-2">
          Transcript
          <span className="ml-auto no-print" onClick={(e) => e.stopPropagation()}>
            <CopyButton text={() => transcriptLines(run, messages).join("\n\n").replace(/\*\*|_/g, "")} />
          </span>
        </summary>
        <div className="mt-4 space-y-3 text-sm">
          {messages
            .filter((m) => (m.kind === "turn" && m.content) || m.kind === "boss")
            .map((m) => {
              const role = run.cast.rollen.find((x) => x.id === m.role_id);
              return (
                <p key={m.id} className={m.kind === "boss" ? "bg-ink text-cream rounded-xl px-3 py-2" : ""}>
                  <span className="font-semibold">{m.kind === "boss" ? "De baas" : role?.naam}: </span>
                  {m.content}
                  {m.sources.length > 0 && <span className="text-ink/50"> (bron: {m.sources.join("; ")})</span>}
                </p>
              );
            })}
        </div>
      </details>

      <div className="no-print card p-5 bg-mint flex flex-col sm:flex-row gap-3 sm:items-center">
        <p className="font-display font-bold text-xl flex-1">Nog een keer met hetzelfde team?</p>
        <Link href={`/?team=${id}`} className="btn-primary">
          Nieuw vraagstuk, zelfde team
        </Link>
        <button className="btn-ghost" onClick={saveTeam} disabled={saved}>
          {saved ? "Bewaard ✓" : "Bewaar team"}
        </button>
      </div>

      {share && <ShareDialog payload={data} onClose={() => setShare(false)} onChange={() => void load()} />}
    </div>
  );
}

function Section({ title, copy, children, tone = "bg-white" }: { title: string; copy: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`card p-5 ${tone}`}>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-display font-bold text-lg flex-1">{title}</h2>
        <CopyButton text={copy} />
      </div>
      {children}
    </section>
  );
}

/**
 * De hamvraag: is het debat beter dan één vraag aan het slimste model?
 * Beide adviezen staan blind naast elkaar (A en B, willekeurig); pas na je keuze zie je welke welke is.
 */
function Vergelijk({ id, result, totalCost, onChange }: { id: string; result: JuryResult; totalCost: number; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [wijzig, setWijzig] = useState(false);
  const v = result.vergelijking;

  async function post(json: object) {
    setBusy(true);
    setError(null);
    try {
      await api<{ vergelijking: Vergelijking }>(`/api/runs/${id}/vergelijk`, { method: "POST", json });
      setWijzig(false);
      onChange();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  const debat: EnkelAdvies = { uitslag: result.uitslag, samenvatting: result.samenvatting, strategie: result.strategie, risicos: result.aannames.map((a) => a.aanname) };
  const kostenDebat = v ? Math.max(0, totalCost - v.kosten_eur) : totalCost;

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg">🆚 Beter dan één vraag?</h2>
        <p className="text-sm text-ink/65 mt-1">
          Levert dit debat een beter advies op dan één keer het slimste model vragen? Stel dezelfde vraag, met dezelfde bijlages, aan één model dat er diep over
          nadenkt. Je ziet beide adviezen blind naast elkaar en kiest zelf. Pas daarna zie je welke welke is.
        </p>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {!v ? (
        <button className="btn-primary !py-2" disabled={busy} onClick={() => void post({})}>
          {busy ? <FunWait lines={["🧠 Eén slimme adviseur denkt er even diep over na…", "📄 Het advies wordt uitgeschreven…"]} /> : "Vergelijk met één vraag (≈ € 0,10)"}
        </button>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            {(["A", "B"] as const).map((letter) => {
              const wie = (letter === "A") === (v.aIs === "debat") ? "debat" : "enkel";
              const advies = wie === "debat" ? debat : v.advies;
              const gekozen = v.keuze === wie;
              return (
                <div key={letter} className={`rounded-2xl border p-4 space-y-2 ${gekozen ? "border-ink bg-sun/60" : "border-ink/15 bg-white"}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">
                    Advies {letter}
                    {v.keuze && ` · ${wie === "debat" ? `het debat (${euro(kostenDebat)})` : `één vraag aan ${v.label} (${euro(v.kosten_eur)})`}`}
                  </p>
                  <p className="font-display font-bold text-lg leading-snug">{advies.uitslag}</p>
                  <p className="text-sm leading-relaxed">{advies.samenvatting}</p>
                  <ol className="text-sm list-decimal pl-5 space-y-1">
                    {advies.strategie.map((st, i) => (
                      <li key={i}>
                        <span className="font-semibold">{st.stap}</span> <span className="text-ink/65">— {st.waarom}</span>
                      </li>
                    ))}
                  </ol>
                  {advies.risicos.length > 0 && (
                    <p className="text-xs text-ink/60">
                      <span className="font-semibold">Om te checken:</span> {advies.risicos.slice(0, 4).join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {v.keuze && !wijzig ? (
            <p className="text-sm">
              {v.keuze === "gelijk"
                ? "Je vond ze even goed."
                : v.keuze === "debat"
                  ? "Je koos het advies van het debat."
                  : `Je koos het advies van één vraag aan ${v.label}.`}{" "}
              <button className="underline text-ink/60" onClick={() => setWijzig(true)}>
                Toch anders?
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Welk advies helpt je beter beslissen?</span>
              <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => void post({ keuze: v.aIs === "debat" ? "debat" : "enkel" })}>
                A
              </button>
              <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => void post({ keuze: v.aIs === "debat" ? "enkel" : "debat" })}>
                B
              </button>
              <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => void post({ keuze: "gelijk" })}>
                Even goed
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
