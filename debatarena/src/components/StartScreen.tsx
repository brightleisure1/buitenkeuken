"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, datum, euro } from "@/lib/client";
import type { RunPayload } from "@/lib/payload";
import type { Cast } from "@/lib/types";
import { CastEditor } from "./CastEditor";
import { MicButton, type MicHandle } from "./MicButton";
import { KetenVoorstel } from "./KetenVoorstel";
import { isFun } from "@/lib/cliches";
import { NIVEAUS, estimateCost, niveauOf, type Niveau } from "@/lib/niveau";
import { RoleCard } from "./RoleCard";
import { CensorToggle, ErrorNote, Portrait, Segmented, Spinner, Switch, toError } from "./ui";
import { PersonaEditor } from "./PersonaEditor";
import { FunWait } from "./FunWait";
import { CASTING_LINES } from "@/lib/wachten";
import { providerOf } from "@/lib/config";

type Err = { message: string; oplossing?: string } | null;
type FileItem = { key: string; name: string; status: "bezig" | "ok" | "fout"; id?: string; error?: string };
type Recent = { id: string; title: string | null; question: string; status: string; created_at: string; cost_eur: number; modus?: string; rollen: { id: string; naam: string; portrait: string | null }[] };
type Template = { id: string; name: string; cast: Cast };

const VOORBEELDEN = [
  "Moeten we onze prijzen met 10% verhogen?",
  "Gaan we een vierdaagse werkweek invoeren?",
  "Is het slim om een tweede vestiging in Utrecht te openen?",
];

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif";

export function StartScreen() {
  const router = useRouter();
  const params = useSearchParams();
  // De review-keten is de standaard; de oude vergadersimulatie staat geparkeerd achter ?modus=vergadering.
  const modus = params.get("modus") === "vergadering" ? "vergadering" : "keten";
  const [question, setQuestion] = useState("");
  const [interim, setInterim] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [phase, setPhase] = useState<"input" | "composing" | "proposal">("input");
  const [data, setData] = useState<RunPayload | null>(null);
  const [error, setError] = useState<Err>(null);
  const [team, setTeam] = useState<{ kind: "template" | "run"; id: string; name: string } | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [chat, setChat] = useState<{ van: "baas" | "regie"; tekst: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatInterim, setChatInterim] = useState("");
  const chatMic = useRef<MicHandle>(null);
  const questionMic = useRef<MicHandle>(null);
  const [chatListening, setChatListening] = useState(false);
  const [questionListening, setQuestionListening] = useState(false);
  /** Na het inspreken meteen samenstellen */
  const composeAfter = useRef(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (id: string) => {
    const d = await api<RunPayload>(`/api/runs/${id}`);
    setData(d);
    return d;
  }, []);

  useEffect(() => {
    api<{ templates: Template[] }>("/api/templates").then((d) => setTemplates(d.templates)).catch(() => {});
    api<{ runs: Recent[] }>("/api/runs?limit=6").then((d) => setRecent(d.runs)).catch(() => {});
  }, []);

  // ?run=… : voorstel na herladen terug; ?team=… : zelfde team, nieuw debat.
  useEffect(() => {
    const runId = params.get("run");
    const teamId = params.get("team");
    if (runId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data ophalen; state wordt pas na de fetch gezet
      load(runId)
        .then((d) => {
          if (d.run.status !== "draft") router.replace(d.run.cast.modus === "keten" ? `/werkblad/${runId}` : `/arena/${runId}`);
          else {
            setQuestion(d.run.question);
            setPhase("proposal");
          }
        })
        .catch((e) => setError(toError(e)));
    } else if (teamId) {
      api<RunPayload>(`/api/runs/${teamId}`)
        .then((d) => {
          setTeam({ kind: "run", id: teamId, name: d.run.cast.rollen.map((r) => r.naam.split(" ")[0]).join(", ") });
          setQuestion("");
        })
        .catch(() => {});
    }
  }, [params, load, router]);

  // Portretten en huiswerk komen binnen: even blijven verversen.
  const runId = data?.run.id;
  const preparing =
    phase === "proposal" &&
    !!data &&
    data.run.cast.rollen.some((r) => {
      const p = data.run.prep[r.id];
      if (!p) return data.keys.openai || !r.isJury;
      return p.portraitStatus === "bezig" || (!r.isJury && p.homeworkStatus === "bezig");
    });
  useEffect(() => {
    if (!runId || !preparing) return;
    const t = setInterval(() => load(runId).catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [runId, preparing, load]);

  async function upload(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const key = `${file.name}-${Math.random()}`;
      setFiles((f) => [...f, { key, name: file.name, status: "bezig" }]);
      const fd = new FormData();
      fd.append("file", file);
      try {
        const d = await api<{ attachment: { id: string } }>("/api/attachments", { method: "POST", body: fd });
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: "ok", id: d.attachment.id } : x)));
      } catch (e) {
        const err = toError(e);
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: "fout", error: `${err.message} ${err.oplossing ?? ""}` } : x)));
      }
    }
  }

  async function compose(text?: string) {
    const q = (text ?? question).trim();
    if (!q) return;
    setError(null);
    setPhase("composing");
    try {
      const d = await api<{ run: { id: string } }>("/api/compose", {
        method: "POST",
        json: {
          question: q,
          modus,
          attachmentIds: files.filter((f) => f.status === "ok").map((f) => f.id),
          ...(team?.kind === "template" ? { templateId: team.id } : team?.kind === "run" ? { fromRunId: team.id } : {}),
        },
      });
      await load(d.run.id);
      setChat([]);
      setPhase("proposal");
      router.replace(`/?run=${d.run.id}`, { scroll: false });
    } catch (e) {
      setError(toError(e));
      setPhase("input");
    }
  }

  async function sendChat(text: string) {
    const t = text.trim();
    if (!t || !data) return;
    setChatInput("");
    setChatInterim("");
    setChat((c) => [...c, { van: "baas", tekst: t }]);
    setChatBusy(true);
    setError(null);
    try {
      const d = await api<{ antwoord: string }>(`/api/runs/${data.run.id}/chat`, { method: "POST", json: { text: t, chat } });
      setChat((c) => [...c, { van: "regie", tekst: d.antwoord }]);
      await load(data.run.id);
    } catch (e) {
      setError(toError(e));
    } finally {
      setChatBusy(false);
    }
  }

  async function saveAdvanced(cast: Cast) {
    if (!data) return;
    setSaving(true);
    try {
      await api(`/api/runs/${data.run.id}`, { method: "PATCH", json: { cast } });
      await load(data.run.id);
    } catch (e) {
      setError(toError(e));
    } finally {
      setSaving(false);
    }
  }

  async function start(alleenAdvies = false) {
    if (!data) return;
    setStarting(true);
    if (data.run.cast.modus === "keten") {
      try {
        await api(`/api/runs/${data.run.id}/keten`, { method: "POST" });
        router.push(`/werkblad/${data.run.id}`);
      } catch (e) {
        setError(toError(e));
        setStarting(false);
      }
      return;
    }
    try {
      await api(`/api/runs/${data.run.id}/start`, { method: "POST" });
      if (alleenAdvies) await api(`/api/runs/${data.run.id}/autorun`, { method: "POST" });
      router.push(`/arena/${data.run.id}`);
    } catch (e) {
      setError(toError(e));
      setStarting(false);
    }
  }

  async function saveTemplate() {
    if (!data) return;
    try {
      await api("/api/templates", { method: "POST", json: { runId: data.run.id } });
      setTemplateSaved(true);
    } catch (e) {
      setError(toError(e));
    }
  }

  function reset() {
    setPhase("input");
    setData(null);
    setQuestion("");
    setFiles([]);
    setTeam(null);
    setAdvanced(false);
    router.replace("/", { scroll: false });
  }

  const uploading = files.some((f) => f.status === "bezig");
  const shown = interim || question;

  // ---------- voorstel ----------
  if (phase === "proposal" && data && data.run.cast.modus === "keten") {
    return (
      <>
        <KetenVoorstel data={data} reload={() => load(data.run.id)} onStart={() => void start()} onReset={reset} starting={starting} />
        {error && (
          <div className="mx-auto max-w-3xl px-4 pb-8">
            <ErrorNote error={error} onClose={() => setError(null)} />
          </div>
        )}
      </>
    );
  }

  if (phase === "proposal" && data) {
    const { run } = data;
    const cast = run.cast;
    const modelLabel = (k: string, custom?: string | null) => custom || data.models.find((m) => m.key === k)?.label;
    const stemTekst = { uit: "zonder stemmen", jury: "alleen de voorzitter praat hardop", iedereen: "iedereen praat hardop" }[cast.stemmen];
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 space-y-6">
        <div>
          <button onClick={reset} className="text-sm text-ink/60 hover:text-ink">
            ← Ander vraagstuk
          </button>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold mt-2">{cast.titel || run.title}</h1>
          <p className="text-ink/70 mt-1">{run.question}</p>
          <p className="text-sm mt-2">
            <strong>{cast.rondes} rondes</strong> · {stemTekst}
            {data.attachments.length > 0 && ` · ${data.attachments.length} bijlage${data.attachments.length > 1 ? "s" : ""}`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Switch checked={isFun(cast)} disabled={saving} onChange={(v) => void saveAdvanced({ ...cast, fun: v, cliches: v })}>
              <strong>🎉 Fun-modus</strong>{" "}
              <span className="text-ink/60">– karikaturen, vergaderclichés en droge humor. De inhoud blijft even serieus.</span>
            </Switch>
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <strong>🧠 Slimheid</strong>
              <Segmented
                label="Slimheid"
                value={niveauOf(cast)}
                onChange={(v) => void saveAdvanced({ ...cast, niveau: v })}
                options={(Object.keys(NIVEAUS) as Niveau[]).map((n) => ({
                  value: n,
                  label: `${NIVEAUS[n].naam} · ≈ ${euro(Math.max(0.01, Math.round(estimateCost(cast, n) * 100) / 100)).replace(",00", "")}`,
                }))}
              />
            </span>
            <span className="basis-full text-xs text-ink/60 -mt-1">
              {NIVEAUS[niveauOf(cast)].uitleg} De voorzitter is altijd het sterkste model en denkt diep na over het advies. Bedragen zijn een schatting.
            </span>
            <span className="flex items-center gap-2 text-sm">
              <strong>🔊 Stemmen</strong>
              {data.keys.elevenlabs ? (
                <Segmented
                  label="Stemmen"
                  value={cast.stemmen}
                  onChange={(v) => void saveAdvanced({ ...cast, stemmen: v })}
                  options={[
                    { value: "uit", label: "Uit" },
                    { value: "jury", label: "Voorzitter" },
                    { value: "iedereen", label: "Iedereen" },
                  ]}
                />
              ) : (
                <Link href="/instellingen" className="underline text-ink/60">
                  voeg een ElevenLabs-sleutel toe
                </Link>
              )}
            </span>
            <label className="flex items-center gap-1.5 text-sm">
              <strong>💶 Max</strong>€
              <input
                key={`${run.id}-${cast.kostenlimiet ?? "geen"}`}
                className="field !py-1 !px-2 !w-20 !rounded-xl"
                inputMode="decimal"
                aria-label="Kostenlimiet voor deze vergadering in euro"
                defaultValue={cast.kostenlimiet ? String(cast.kostenlimiet).replace(".", ",") : ""}
                placeholder="geen"
                onBlur={(e) => {
                  const eur = Number(e.target.value.replace(",", "."));
                  const next = e.target.value.trim() === "" ? null : eur > 0 ? eur : cast.kostenlimiet ?? null;
                  if (next !== (cast.kostenlimiet ?? null)) void saveAdvanced({ ...cast, kostenlimiet: next });
                }}
              />
            </label>
            <span className="text-xs text-ink/50">Kosten tot nu toe: {euro(run.cost_eur)}</span>
          </div>
          <div className="mt-3 rounded-2xl border border-ink/15 bg-white px-4 py-3">
            <p className="font-display font-bold">🌶️ Censuur per deelnemer</p>
            <p className="text-xs text-ink/60 mb-2">
              Ongecensureerd: brutaal, sarcastisch, vloeken mag. Grok gaat het verst; Claude, ChatGPT en Gemini worden scherper maar blijven wat netter. De voorzitter blijft altijd netjes.
            </p>
            <div className="divide-y divide-ink/10">
              {cast.rollen
                .filter((r) => !r.isJury)
                .map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                    <span className="text-sm font-semibold">{r.naam}</span>
                    <span className="text-xs text-ink/60">{providerOf(r).naam}</span>
                    <span className="ml-auto">
                      <CensorToggle
                        size="xs"
                        value={!!r.ongezouten}
                        onChange={(v) => void saveAdvanced({ ...cast, rollen: cast.rollen.map((x) => (x.id === r.id ? { ...x, ongezouten: v } : x)) })}
                      />
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          {cast.rollen.map((r, i) => (
            <RoleCard
              key={r.id}
              role={r}
              prep={run.prep[r.id]}
              index={i}
              modelLabel={modelLabel(r.modelKey, r.customModel)}
              readers={data.readers[r.id]?.length && data.readers[r.id].length < data.attachments.length ? data.readers[r.id] : undefined}
              voiceOn={cast.stemmen === "iedereen" || (cast.stemmen === "jury" && r.isJury)}
              onEdit={() => setEditing(r.id)}
            />
          ))}
        </div>

        <ErrorNote error={error} onClose={() => setError(null)} />

        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold">Iets aanpassen? Zeg het gewoon.</p>
          {chat.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto text-sm">
              {chat.map((m, i) => (
                <div key={i} className={`flex ${m.van === "baas" ? "justify-end" : ""}`}>
                  <span className={`rounded-2xl px-3 py-2 max-w-[85%] ${m.van === "baas" ? "bg-ink text-cream" : "bg-sun"}`}>{m.tekst}</span>
                </div>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatListening) chatMic.current?.stop();
              else void sendChat(chatInput);
            }}
          >
            <input
              className="field"
              value={chatInterim || chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder='Bijv. "Maak de inkoper strenger" of "Maar 2 rondes"'
              disabled={chatBusy}
            />
            <MicButton
              ref={chatMic}
              onListening={setChatListening}
              onText={(t) => void sendChat(chatInput ? `${chatInput} ${t}` : t)}
              onInterim={setChatInterim}
              onError={(m) => setError({ message: m })}
            />
            <button className="btn-ghost shrink-0" disabled={chatBusy || !(chatInput.trim() || chatInterim.trim() || chatListening)}>
              {chatBusy ? <Spinner /> : chatListening ? "Stuur ➤" : "Pas aan"}
            </button>
          </form>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <button onClick={() => void start()} disabled={starting || chatBusy} className="btn-primary text-lg px-8 py-4">
            {starting ? <Spinner /> : "Start debat →"}
          </button>
          <button
            onClick={() => void start(true)}
            disabled={starting || chatBusy}
            className="btn-ghost px-5 py-3.5"
            title="De vergadering loopt zonder dat je hoeft te kijken. Je krijgt alleen het advies."
          >
            ⚡ Alleen het advies
          </button>
          <div className="flex gap-4 text-sm sm:ml-auto">
            <button onClick={() => setAdvanced((a) => !a)} className="underline">
              {advanced ? "Verberg geavanceerd" : "Geavanceerd"}
            </button>
            <button onClick={saveTemplate} className="underline" disabled={templateSaved}>
              {templateSaved ? "Team bewaard ✓" : "Bewaar dit team"}
            </button>
          </div>
        </div>

        {editing && cast.rollen.some((r) => r.id === editing) && (
          <PersonaEditor
            runId={run.id}
            cast={cast}
            role={cast.rollen.find((r) => r.id === editing)!}
            prep={run.prep[editing]}
            index={cast.rollen.findIndex((r) => r.id === editing)}
            models={data.models}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              await load(run.id);
            }}
          />
        )}

        {advanced && (
          <CastEditor key={run.updated_at} cast={cast} models={data.models} attachments={data.attachments} onSave={saveAdvanced} saving={saving} />
        )}
      </div>
    );
  }

  // ---------- invoer ----------
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-16 space-y-8">
      <div
        className={`card p-5 sm:p-8 transition ${dragging ? "bg-sky" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        <label htmlFor="vraag" className="font-display text-3xl sm:text-5xl font-extrabold leading-tight block">
          {modus === "keten" ? "Welk besluit wil je scherp krijgen?" : "Waar wil je over debatteren?"}
        </label>
        {team && (
          <p className="mt-3 text-sm inline-flex items-center gap-2 rounded-full bg-mint border border-ink/15 px-3 py-1">
            Met het team: {team.name}
            <button onClick={() => setTeam(null)} aria-label="Team loslaten" className="text-ink/60">
              ✕
            </button>
          </p>
        )}
        <div className="mt-5 flex gap-3 items-start">
          <textarea
            id="vraag"
            autoFocus
            rows={3}
            value={shown}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void compose();
            }}
            placeholder="Typ je vraagstuk, of klik op de microfoon en vertel het."
            className="field text-lg resize-none"
            disabled={phase === "composing"}
          />
          <MicButton
            size="lg"
            ref={questionMic}
            onListening={setQuestionListening}
            onText={(t) => {
              const q = question ? `${question} ${t}` : t;
              setQuestion(q);
              if (composeAfter.current) {
                composeAfter.current = false;
                void compose(q);
              }
            }}
            onInterim={(t) => setInterim(t ? (question ? `${question} ${t}` : t) : "")}
            onError={(m) => setError({ message: m })}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {files.map((f) => (
              <li
                key={f.key}
                title={f.error}
                className={`text-sm rounded-full border px-3 py-1 flex items-center gap-2 ${f.status === "fout" ? "border-coral bg-[#FFF1EC]" : "border-ink/15 bg-cream"}`}
              >
                {f.status === "bezig" && <Spinner />}
                {f.status === "ok" && "📎"}
                {f.status === "fout" && "⚠️"}
                <span className="max-w-[12rem] truncate">{f.name}</span>
                <button onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))} aria-label="Verwijder" className="text-ink/50">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.some((f) => f.status === "fout") && (
          <p className="mt-2 text-sm text-coral">{files.find((f) => f.status === "fout")?.error}</p>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3 sm:items-center">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-sm text-ink/70 hover:text-ink text-left"
          >
            📎 Sleep bijlages hierheen of <span className="underline">kies een bestand</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => {
              if (questionListening) {
                composeAfter.current = true;
                questionMic.current?.stop();
              } else void compose();
            }}
            disabled={!(question.trim() || interim.trim() || questionListening) || uploading || phase === "composing"} className="btn-primary text-lg px-8 py-3.5 sm:ml-auto">
            {phase === "composing" ? (
              <>
                <Spinner /> Bezig…
              </>
            ) : (
              "Stel samen"
            )}
          </button>
        </div>
      </div>

      <ErrorNote error={error} onClose={() => setError(null)} />

      {phase === "composing" && (
        <div className="grid gap-3">
          <div className="card p-5 sm:p-6 bg-sun animate-pop">
            <span className="block text-xs font-semibold uppercase tracking-wide text-ink/60 mb-2">Je team wordt samengesteld</span>
            <FunWait lines={CASTING_LINES} size="lg" every={1600} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-4 flex gap-4 items-center opacity-60 animate-pulse" aria-hidden>
              <div className="h-[72px] w-[72px] rounded-full bg-peach border-2 border-white shadow-soft grid place-items-center text-3xl">?</div>
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-ink/15" />
                <div className="h-3 w-64 rounded bg-ink/10" />
              </div>
            </div>
          ))}
        </div>
      )}

      {phase === "input" && !question && (
        <div className="flex flex-wrap gap-2">
          {VOORBEELDEN.map((v) => (
            <button key={v} onClick={() => setQuestion(v)} className="text-sm rounded-full border border-ink/25 bg-white px-3 py-1.5 hover:bg-ink/5">
              {v}
            </button>
          ))}
        </div>
      )}

      {phase === "input" && templates.length > 0 && (
        <section>
          <h2 className="font-display font-bold text-xl mb-2">Je teams</h2>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTeam(team?.id === t.id ? null : { kind: "template", id: t.id, name: t.name })}
                className={`rounded-2xl border border-ink/15 px-3 py-2 flex items-center gap-2 text-sm ${team?.id === t.id ? "bg-mint" : "bg-white hover:bg-ink/5"}`}
              >
                <span className="flex -space-x-3">
                  {t.cast.rollen.slice(0, 4).map((r, i) => (
                    <Portrait key={r.id} name={r.naam} portraits={r.portraits} index={i} size={30} />
                  ))}
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {phase === "input" && recent.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-display font-bold text-xl">Recente debatten</h2>
            <Link href="/geschiedenis" className="text-sm underline">
              Alles bekijken
            </Link>
          </div>
          <ul className="grid sm:grid-cols-2 gap-3">
            {recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={
                    r.status === "draft"
                      ? `/?run=${r.id}`
                      : r.modus === "keten"
                        ? `/werkblad/${r.id}`
                        : r.status === "done" || r.status === "stopped"
                          ? `/resultaat/${r.id}`
                          : `/arena/${r.id}`
                  }
                  className="card p-4 flex items-center gap-3 hover:bg-ink/5 transition"
                >
                  <span className="flex -space-x-3">
                    {r.rollen.slice(0, 3).map((x, i) => (
                      <Portrait key={x.id} name={x.naam} portraits={x.portrait ? { neutraal: x.portrait } : undefined} index={i} size={36} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold truncate">{r.title || r.question}</span>
                    <span className="text-xs text-ink/60">
                      {datum(r.created_at)} · {r.status === "done" ? "Afgerond" : r.status === "stopped" ? "Gestopt" : r.status === "draft" ? "Voorstel" : "Loopt"} · {euro(r.cost_eur)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
