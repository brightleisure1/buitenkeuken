"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, euro, readNdjson } from "@/lib/client";
import type { RunPayload } from "@/lib/payload";
import { SpeechQueue } from "@/lib/speech";
import { TAG_MOOD, extractSources, splitSentences } from "@/lib/text";
import type { BossAction, Message, MessageMeta, Mood, Role, Tag } from "@/lib/types";
import { MicButton } from "./MicButton";
import { ReplayPlayer } from "./ReplayPlayer";
import { Stage, type Bubble } from "./Stage";
import { ErrorNote, Spinner, toError } from "./ui";

type Err = { message: string; oplossing?: string } | null;
type Live = { id: string; roleId: string; round: number; tag: Tag | null; text: string; meta: MessageMeta };
type Mode = "opmerking" | "richting" | "hamer" | "vraag";

const PREP_TIMEOUT_MS = 120_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ArenaLive({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<RunPayload | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [phase, setPhase] = useState<"laden" | "prep" | "debat" | "laatste_woord" | "oordeel">("laden");
  const [paused, setPaused] = useState(false);
  const [stopPanel, setStopPanel] = useState(false);
  const [mode, setMode] = useState<Mode>("opmerking");
  const [target, setTarget] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [rate, setRate] = useState(1);
  const [orde, setOrde] = useState(false);
  const [quips, setQuips] = useState<Record<string, string | undefined>>({});
  const [prepStarted] = useState(() => Date.now());

  const pausedRef = useRef(false);
  const loopingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const speechRef = useRef<SpeechQueue | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hammerClicks = useRef<number[]>([]);
  const dataRef = useRef<RunPayload | null>(null);

  const speech = () => {
    if (!speechRef.current) {
      speechRef.current = new SpeechQueue();
      speechRef.current.onError = (m) => setError({ message: m, oplossing: "Het debat gaat door zonder geluid voor deze zin." });
    }
    return speechRef.current;
  };

  const reload = useCallback(async () => {
    const d = await api<RunPayload>(`/api/runs/${id}`);
    dataRef.current = d;
    setData(d);
    return d;
  }, [id]);

  const voiceFor = (role: Role | undefined) => {
    const cast = dataRef.current?.run.cast;
    if (!role?.stemId || !cast || !dataRef.current?.keys.elevenlabs) return null;
    if (cast.stemmen === "iedereen" || (cast.stemmen === "jury" && role.isJury)) return role.stemId;
    return null;
  };

  const setPausedBoth = (v: boolean) => {
    pausedRef.current = v;
    setPaused(v);
  };

  // ---------- de debatlus ----------
  const loop = useCallback(async () => {
    if (loopingRef.current) return;
    loopingRef.current = true;
    setError(null);
    try {
      while (!pausedRef.current) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        let res: Response;
        try {
          res = await fetch(`/api/runs/${id}/turn`, { method: "POST", signal: ctrl.signal });
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
          throw e;
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError({ message: d.error ?? "Er ging iets mis.", oplossing: d.oplossing });
          setPausedBoth(true);
          break;
        }
        if (res.headers.get("content-type")?.includes("application/json")) {
          const d = await res.json();
          if (d.busy) {
            await sleep(1500);
            continue;
          }
          const type = d.step?.type;
          if (type === "final_word") {
            setPhase("laatste_woord");
            setPausedBoth(true);
            await reload();
            break;
          }
          if (type === "result" || type === "done") {
            setPhase("oordeel");
            await speech().idle();
            if (type === "result") {
              try {
                await api(`/api/runs/${id}/result`, { method: "POST" });
              } catch (e) {
                setError(toError(e));
                setPhase("debat");
                setPausedBoth(true);
                break;
              }
            }
            router.push(`/resultaat/${id}`);
            break;
          }
          break;
        }

        // Een beurt streamt binnen.
        let cur: Live | null = null;
        let spoken = "";
        let idx = 0;
        let voice: string | null = null;
        const speak = (s: string) => {
          const clean = extractSources(s).clean;
          if (voice && cur && clean) speech().say({ runId: id, messageId: cur.id, idx: idx++, text: clean, voiceId: voice });
        };
        try {
          await readNdjson(res, (ev) => {
            if (ev.t === "start") {
              const m = ev.message as Message;
              const role = dataRef.current?.run.cast.rollen.find((r) => r.id === m.role_id);
              voice = voiceFor(role);
              cur = { id: m.id, roleId: m.role_id!, round: m.round ?? 1, tag: null, text: "", meta: m.meta };
              setLive({ ...cur });
            } else if (ev.t === "tag" && cur) {
              cur.tag = ev.tag as Tag;
              setLive({ ...cur });
            } else if (ev.t === "delta" && cur) {
              cur.text += ev.text as string;
              setLive({ ...cur });
              spoken += ev.text as string;
              const { done, rest } = splitSentences(spoken);
              done.forEach(speak);
              spoken = rest;
            } else if (ev.t === "end") {
              if (spoken.trim()) speak(spoken.trim());
              spoken = "";
            } else if (ev.t === "error") {
              setError({ message: ev.error as string, oplossing: ev.oplossing as string });
              setPausedBoth(true);
            }
          });
        } catch (e) {
          if ((e as Error).name !== "AbortError") throw e;
        }
        await reload();
        setLive(null);
        if (pausedRef.current) break;
        await speech().idle();
        await sleep(600);
      }
    } catch (e) {
      setError(toError(e));
      setPausedBoth(true);
    } finally {
      loopingRef.current = false;
    }
  }, [id, reload, router]);

  // ---------- eerste keer laden ----------
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data ophalen; state wordt pas na de fetch gezet
    reload()
      .then((d) => {
        if (!alive) return;
        if (d.run.status === "draft") {
          router.replace(`/?run=${id}`);
          return;
        }
        if (d.run.status === "done") return;
        const turns = d.messages.filter((m) => m.kind === "turn");
        if (d.step?.type === "final_word") {
          setPhase("laatste_woord");
          setPausedBoth(true);
        } else if (turns.length === 0) {
          setPhase("prep");
        } else {
          // Terug in een lopend debat: eerst even op pauze.
          setPhase("debat");
          setPausedBoth(true);
          setStopPanel(true);
        }
      })
      .catch((e) => setError(toError(e)));
    return () => {
      alive = false;
      abortRef.current?.abort();
      speechRef.current?.stop();
    };
  }, [id, reload, router]);

  // ---------- voorbereiding ----------
  const prepDone =
    !!data &&
    data.run.cast.rollen.every((r) => {
      if (r.isJury) return true;
      const s = data.run.prep[r.id]?.homeworkStatus;
      return s === "klaar" || s === "mislukt";
    });

  useEffect(() => {
    if (phase !== "prep") return;
    if (prepDone || Date.now() - prepStarted > PREP_TIMEOUT_MS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- overgang naar het debat zodra de voorbereiding klaar is
      setPhase("debat");
      void loop();
      return;
    }
    const t = setInterval(() => void reload().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [phase, prepDone, prepStarted, reload, loop, data]);

  // Portretten die nog binnenkomen tijdens het debat.
  const portraitsPending = !!data && data.run.cast.rollen.some((r) => data.run.prep[r.id]?.portraitStatus === "bezig");
  useEffect(() => {
    if (!portraitsPending || phase === "prep") return;
    const t = setInterval(() => void reload().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [portraitsPending, phase, reload]);

  useEffect(() => speechRef.current?.setRate(rate), [rate]);

  // ---------- de baas grijpt in ----------
  function interrupt() {
    setPausedBoth(true);
    abortRef.current?.abort();
    speechRef.current?.stop();
  }

  function raiseHand() {
    interrupt();
    setMode("opmerking");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function stop() {
    interrupt();
    setStopPanel(true);
  }

  function resume() {
    setStopPanel(false);
    setPausedBoth(false);
    setPhase("debat");
    void loop();
  }

  async function post(action: BossAction, text = "", tgt?: string | null) {
    setSending(true);
    setError(null);
    try {
      await api(`/api/runs/${id}/boss`, { method: "POST", json: { action, text, target: tgt } });
      await reload();
      return true;
    } catch (e) {
      setError(toError(e));
      return false;
    } finally {
      setSending(false);
    }
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text) return;
    if (phase === "laatste_woord") {
      if (await post("laatste_woord", text)) {
        setInput("");
        resume();
      }
      return;
    }
    if (mode === "vraag" && !target) {
      setError({ message: "Aan wie stel je de vraag?", oplossing: "Tik eerst op een van de namen hieronder." });
      return;
    }
    const action: BossAction = mode === "vraag" ? "vraag" : mode;
    if (await post(action, text, mode === "vraag" ? target : null)) {
      setInput("");
      setInterim("");
      setMode("opmerking");
      setTarget(null);
      if (!stopPanel) resume();
    }
  }

  function hammer() {
    const now = Date.now();
    hammerClicks.current = [...hammerClicks.current.filter((t) => now - t < 1500), now];
    if (hammerClicks.current.length >= 3) {
      hammerClicks.current = [];
      setOrde(true);
      setTimeout(() => setOrde(false), 1400);
      return;
    }
    if (input.trim()) {
      setMode("hamer");
      void (async () => {
        if (await post("hamer", input.trim())) {
          setInput("");
          setMode("opmerking");
          if (!stopPanel) resume();
        }
      })();
    } else {
      setMode("hamer");
      inputRef.current?.focus();
    }
  }

  async function quip(roleId: string) {
    if (quips[roleId]) return;
    setQuips((q) => ({ ...q, [roleId]: "…" }));
    try {
      const d = await api<{ text: string }>(`/api/runs/${id}/quip`, { method: "POST", json: { roleId } });
      setQuips((q) => ({ ...q, [roleId]: d.text || "…" }));
    } catch {
      setQuips((q) => ({ ...q, [roleId]: "Even niet, ik zit te denken." }));
    }
    setTimeout(() => setQuips((q) => ({ ...q, [roleId]: undefined })), 5000);
  }

  // ---------- weergave ----------
  if (!data) {
    return (
      <div className="flex-1 grid place-items-center p-6">
        {error ? <ErrorNote error={error} /> : <Spinner className="h-8 w-8" />}
      </div>
    );
  }

  const { run, messages } = data;
  if (run.status === "done") {
    return (
      <ReplayPlayer
        title={run.title ?? run.question}
        roles={run.cast.rollen}
        portraits={Object.fromEntries(run.cast.rollen.map((r) => [r.id, run.prep[r.id]?.portraits]))}
        messages={messages}
        highlights={run.highlights}
        rounds={run.cast.rondes}
        goldenChair={run.debate_number === 10}
        extra={
          <Link href={`/resultaat/${id}`} className="btn-primary !py-1.5 text-sm">
            Naar het resultaat
          </Link>
        }
      />
    );
  }

  const roles = run.cast.rollen;
  const jury = roles.find((r) => r.isJury);
  const portraits = Object.fromEntries(roles.map((r) => [r.id, run.prep[r.id]?.portraits]));
  const lastShown = [...messages].reverse().find((m) => (m.kind === "turn" && m.content) || m.kind === "boss");

  let bubble: Bubble | null = null;
  let activeId: string | null = null;
  let mood: Mood = "neutraal";
  if (phase === "laatste_woord" && jury) {
    activeId = jury.id;
    bubble = { who: jury.id, text: "Wil je nog iets zeggen voordat ik uitspraak doe?" };
  } else if (live) {
    activeId = live.roleId;
    mood = live.tag ? TAG_MOOD[live.tag] : "neutraal";
    bubble = { who: live.roleId, text: live.text, tag: live.tag, streaming: true };
  } else if (lastShown) {
    if (lastShown.kind === "boss") bubble = { who: "baas", text: lastShown.content, note: bossNote(lastShown, roles) };
    else {
      activeId = paused ? null : lastShown.role_id;
      mood = lastShown.tag ? TAG_MOOD[lastShown.tag] : "neutraal";
      bubble = {
        who: lastShown.role_id!,
        text: lastShown.content,
        tag: lastShown.tag,
        sources: lastShown.sources,
        note: lastShown.meta.interrupted ? "(onderbroken)" : undefined,
      };
    }
  }

  const round = live?.round ?? Math.max(1, ...messages.filter((m) => m.kind === "turn").map((m) => m.round ?? 1));
  const roundLabel =
    phase === "laatste_woord" || live?.meta.verdict ? "Uitspraak" : phase === "prep" ? "Voorbereiding" : `Ronde ${round} van ${run.cast.rondes}`;
  const voicesOn = run.cast.stemmen !== "uit" && data.keys.elevenlabs;

  const looking =
    phase === "prep"
      ? Object.fromEntries(
          roles.map((r) => {
            const p = run.prep[r.id];
            if (r.isJury) return [r.id, undefined];
            if (p?.homeworkStatus === "klaar") return [r.id, p.facts?.length ? `${p.facts.length} feiten verzameld ✓` : "Klaar ✓"];
            return [r.id, p?.looking?.at(-1) ?? "Denkt na…"];
          }),
        )
      : undefined;

  const banner =
    phase === "prep" ? (
      <div className="flex items-center gap-3 rounded-full bg-sky border-2 border-ink px-4 py-2 text-sm font-semibold animate-pop">
        <Spinner /> De rollen bereiden zich voor…
        <button
          onClick={() => {
            setPhase("debat");
            void loop();
          }}
          className="underline font-normal"
        >
          Niet wachten
        </button>
      </div>
    ) : live?.meta.extra === "eensgezind" ? (
      <div className="rounded-full bg-lilac border-2 border-ink px-4 py-2 text-sm font-semibold animate-pop">Verdacht eensgezind…</div>
    ) : phase === "oordeel" ? (
      <div className="flex items-center gap-3 rounded-full bg-sun border-2 border-ink px-4 py-2 text-sm font-semibold animate-pop">
        <Spinner /> De Jury schrijft het oordeel…
      </div>
    ) : null;

  const placeholder =
    phase === "laatste_woord"
      ? "Je laatste woord voor de Jury (of sla over)"
      : mode === "hamer"
        ? "Wat besluit je? Daarna staat het vast."
        : mode === "richting"
          ? "Welke kant moet het op?"
          : mode === "vraag"
            ? target
              ? `Je vraag aan ${roles.find((r) => r.id === target)?.naam.split(" ")[0]}`
              : "Kies eerst aan wie"
            : paused
              ? "Je hebt het woord. Zeg het maar."
              : "Typ of spreek in om in te grijpen";

  return (
    <div className="relative flex flex-col h-[calc(100dvh-58px)]">
      <Stage
        title={run.title ?? run.question}
        roles={roles}
        portraits={portraits}
        activeId={activeId}
        mood={mood}
        bubble={bubble}
        roundLabel={roundLabel}
        banner={banner}
        looking={looking}
        quips={quips}
        onRoleClick={phase === "debat" || phase === "prep" ? quip : undefined}
        goldenChair={run.debate_number === 10}
        footer={
          <>
            <span>Kosten tot nu toe: {euro(run.cost_eur)}</span>
            {voicesOn && (
              <span className="ml-auto flex items-center gap-1">
                Stemtempo
                {[1, 1.25, 1.5].map((r) => (
                  <button key={r} onClick={() => setRate(r)} className={`rounded-full px-2 py-0.5 border ${rate === r ? "bg-ink text-cream border-ink" : "border-ink/30"}`}>
                    {String(r).replace(".", ",")}x
                  </button>
                ))}
              </span>
            )}
          </>
        }
      >
        <div className="space-y-2">
          {error && <ErrorNote error={error} onClose={() => setError(null)} />}

          {stopPanel && phase === "debat" && (
            <div className="rounded-2xl bg-sun border-2 border-ink p-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold mr-auto">Het debat staat stil.</span>
              <button className="btn-ghost !py-1.5" onClick={resume}>
                Verder
              </button>
              <button
                className="btn-primary !py-1.5"
                onClick={async () => {
                  if (await post("afronden")) resume();
                }}
              >
                Afronden: naar de Jury
              </button>
            </div>
          )}

          {mode === "vraag" && phase === "debat" && (
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setTarget(r.id)}
                  className={`text-xs rounded-full border-2 px-2.5 py-1 ${target === r.id ? "bg-ink text-cream border-ink" : "border-ink/30 bg-white"}`}
                >
                  {r.naam.split(" ")[0]}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              ref={inputRef}
              value={interim || input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              disabled={sending || phase === "oordeel"}
              className={`field !py-2.5 ${mode === "hamer" ? "ring-4 ring-coral/40" : ""}`}
            />
            <MicButton
              onText={(t) => {
                setInterim("");
                void send(input ? `${input} ${t}` : t);
              }}
              onInterim={(t) => {
                if (t && !pausedRef.current && phase === "debat") raiseHand();
                setInterim(t);
              }}
              onError={(m) => setError({ message: m })}
            />
            <button className="btn-primary !px-4 shrink-0" disabled={sending || !input.trim()}>
              {sending ? <Spinner /> : phase === "laatste_woord" ? "Zeg het" : mode === "hamer" ? "Besluit" : "Zeg"}
            </button>
          </form>

          {phase === "laatste_woord" ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-ghost !py-1.5 text-sm"
                disabled={sending}
                onClick={async () => {
                  if (await post("overslaan")) resume();
                }}
              >
                Nee, doe maar uitspraak
              </button>
            </div>
          ) : (
            phase !== "oordeel" && (
              <div className="flex flex-wrap gap-1.5 text-sm">
                <Ctrl onClick={raiseHand} active={paused && !stopPanel && mode === "opmerking"}>
                  ✋ Hand opsteken
                </Ctrl>
                <Ctrl onClick={stop} active={stopPanel}>
                  ⏹ Stop
                </Ctrl>
                <Ctrl onClick={hammer} active={mode === "hamer"}>
                  🔨 Hamer
                </Ctrl>
                <Ctrl onClick={() => setMode(mode === "richting" ? "opmerking" : "richting")} active={mode === "richting"}>
                  🧭 Richting geven
                </Ctrl>
                <Ctrl onClick={() => setMode(mode === "vraag" ? "opmerking" : "vraag")} active={mode === "vraag"}>
                  ❓ Vraag aan één rol
                </Ctrl>
                {paused && !stopPanel && phase === "debat" && (
                  <button onClick={resume} className="ml-auto underline text-sm">
                    Laat ze verder praten
                  </button>
                )}
              </div>
            )
          )}
        </div>
      </Stage>

      {orde && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center z-40">
          <span className="font-display font-extrabold text-7xl sm:text-9xl text-coral drop-shadow-[4px_4px_0_var(--color-ink)] animate-pop">ORDE!</span>
        </div>
      )}
    </div>
  );
}

function bossNote(m: Message, roles: Role[]) {
  const a = m.meta.action;
  if (a === "hamer") return "🔨 besluit";
  if (a === "richting") return "🧭 richting";
  if (a === "vraag") return `❓ aan ${roles.find((r) => r.id === m.meta.target)?.naam.split(" ")[0] ?? ""}`;
  if (a === "laatste_woord") return "laatste woord";
  return undefined;
}

function Ctrl({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border-2 px-3 py-1.5 font-medium transition ${active ? "bg-ink text-cream border-ink" : "bg-white border-ink hover:bg-sun"}`}
    >
      {children}
    </button>
  );
}
