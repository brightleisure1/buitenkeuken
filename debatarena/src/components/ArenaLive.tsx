"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, euro, readNdjson } from "@/lib/client";
import type { RunPayload } from "@/lib/payload";
import { SpeechQueue } from "@/lib/speech";
import { TAG_MOOD, extractSources, splitSentences } from "@/lib/text";
import type { BossAction, Message, MessageMeta, Mood, Prep, Role, Tag } from "@/lib/types";
import { MicButton, type MicHandle } from "./MicButton";
import { ReplayPlayer } from "./ReplayPlayer";
import { Stage, firstName, type FeedItem } from "./Stage";
import { FunWait } from "./FunWait";
import { PersonaEditor } from "./PersonaEditor";
import { JURY_LINES, LOADING_LINES, prepLines, turnWaitLines } from "@/lib/wachten";
import { CostPanel } from "./CostPanel";
import { CensorToggle, ErrorNote, Portrait, Segmented, Spinner, toError } from "./ui";
import { autorunState } from "@/lib/planner";
import { tokens } from "@/lib/usage";

type Err = { message: string; oplossing?: string } | null;
type Live = { id: string; roleId: string; round: number; tag: Tag | null; text: string; meta: MessageMeta };
type Mode = "opmerking" | "richting" | "hamer" | "vraag";

const PREP_TIMEOUT_MS = 120_000;

/** Leestempo: tekens per seconde als je leest, snelheid van de stem, en pauze tussen sprekers. */
const TEMPO = {
  /** Tekst meteen, en pas door naar de volgende als jij klikt */
  zelf: { cps: Infinity, speech: 1.1, pause: Infinity },
  rustig: { cps: 13, speech: 0.95, pause: 2200 },
  normaal: { cps: 19, speech: 1.1, pause: 1400 },
  snel: { cps: 32, speech: 1.3, pause: 600 },
  /** Zo snel als de AI schrijft, bijna geen pauze */
  direct: { cps: Infinity, speech: 1.3, pause: 300 },
} as const;
type Tempo = keyof typeof TEMPO;
/** Ongeveer het spreektempo van een stem, in tekens per seconde. */
const VOICE_CPS = 14;

/** Alleen hele woorden laten zien, dan springt er niets. */
function wordCut(full: string, n: number) {
  if (n >= full.length) return full;
  const i = full.lastIndexOf(" ", Math.floor(n));
  return i > 0 ? full.slice(0, i) : "";
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ArenaLive({ id, listen = false }: { id: string; listen?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<RunPayload | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [phase, setPhase] = useState<"laden" | "auto" | "prep" | "debat" | "laatste_woord" | "oordeel">("laden");
  /** 'Alleen het advies' is klaar: we gaan naar het resultaat */
  const [toResult, setToResult] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stopPanel, setStopPanel] = useState(false);
  const [mode, setMode] = useState<Mode>("opmerking");
  const [target, setTarget] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [tempo, setTempoState] = useState<Tempo>(() => {
    try {
      const t = typeof window !== "undefined" ? localStorage.getItem("debatarena-tempo") : null;
      return t && t in TEMPO ? (t as Tempo) : "normaal";
    } catch {
      return "normaal";
    }
  });
  const tempoRef = useRef<Tempo>(tempo);
  const setTempo = (t: Tempo) => {
    tempoRef.current = t;
    setTempoState(t);
    try {
      localStorage.setItem("debatarena-tempo", t);
    } catch {
      /* geen opslag, prima */
    }
  };
  const [orde, setOrde] = useState(false);
  const [quips, setQuips] = useState<Record<string, string | undefined>>({});
  const [prepStarted] = useState(() => Date.now());
  const [showCost, setShowCost] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** Wachten op de volgende beurt (verzoek is weg, nog geen tekst) */
  const [pending, setPending] = useState(false);
  const [budgetHit, setBudgetHit] = useState(false);

  const pausedRef = useRef(false);
  const loopingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const speechRef = useRef<SpeechQueue | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const micRef = useRef<MicHandle>(null);
  const [listening, setListening] = useState(false);
  /** Klik op 'Volgende': tekst meteen tonen of de volgende spreker laten beginnen */
  const skipRef = useRef<(() => void) | null>(null);
  /** Leest de baas nu een beurt, of wacht de vergadering op 'Volgende'? */
  const [reading, setReading] = useState<null | "lezen" | "wachten">(null);
  const [censorOpen, setCensorOpen] = useState(false);
  const hammerClicks = useRef<number[]>([]);
  const dataRef = useRef<RunPayload | null>(null);

  const speech = () => {
    if (!speechRef.current) {
      speechRef.current = new SpeechQueue();
      speechRef.current.setRate(TEMPO[tempoRef.current].speech);
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
    const d = dataRef.current;
    const cast = d?.run.cast;
    if (!role || !cast || !d?.keys.elevenlabs) return null;
    const voice = d.stemmen?.[role.id] ?? role.stemId;
    if (!voice) return null;
    if (cast.stemmen === "iedereen" || (cast.stemmen === "jury" && role.isJury)) return voice;
    return null;
  };

  const setPausedBoth = (v: boolean) => {
    pausedRef.current = v;
    setPaused(v);
  };

  // ---------- de debatlus ----------
  const loop = useCallback(async () => {
    if (loopingRef.current) return;
    // Speelt de server de vergadering af ('alleen het advies')? Dan niet zelf ook nog.
    if (dataRef.current && autorunState(dataRef.current.messages) !== "uit") return;
    loopingRef.current = true;
    setError(null);
    try {
      while (!pausedRef.current) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        let res: Response;
        setPending(true);
        try {
          res = await fetch(`/api/runs/${id}/turn`, { method: "POST", signal: ctrl.signal });
        } catch (e) {
          setPending(false);
          if ((e as Error).name === "AbortError") break;
          throw e;
        }
        if (!res.headers.get("content-type")?.includes("ndjson")) setPending(false);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError({ message: d.error ?? "Er ging iets mis.", oplossing: d.oplossing });
          setPausedBoth(true);
          break;
        }
        if (res.headers.get("content-type")?.includes("application/json")) {
          const d = await res.json();
          if (d.auto) {
            await reload();
            break;
          }
          if (d.busy) {
            await sleep(1500);
            continue;
          }
          const type = d.step?.type;
          if (type === "budget") {
            setBudgetHit(true);
            setPausedBoth(true);
            speech().stop();
            await reload();
            break;
          }
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
        // De tekst komt in vlagen binnen; we tonen hem in een rustig, vast leestempo.
        let full = "";
        let shown = 0;
        // Klik op 'Volgende': alles meteen tonen (en in de tempo's met pauze ook de pauze overslaan).
        let instant = false;
        let skipPause = false;
        const cps = () => {
          const t = TEMPO[tempoRef.current];
          if (instant || t.cps === Infinity) return Infinity;
          return voice ? VOICE_CPS * t.speech : t.cps;
        };
        skipRef.current = () => {
          instant = true;
          if (tempoRef.current !== "zelf") skipPause = true;
          voice = null;
          speech().stop();
        };
        setReading("lezen");
        const tick = setInterval(() => {
          if (!cur || shown >= full.length) return;
          shown = Math.min(full.length, shown + cps() * 0.05);
          const text = wordCut(full, shown);
          if (text !== cur.text) {
            cur.text = text;
            setLive({ ...cur });
          }
        }, 50);
        const speak = (s: string) => {
          const clean = extractSources(s).clean;
          if (voice && cur && clean) speech().say({ runId: id, messageId: cur.id, idx: idx++, text: clean, voiceId: voice });
        };
        try {
          await readNdjson(res, (ev) => {
            if (ev.t === "start") {
              setPending(false);
              const m = ev.message as Message;
              const role = dataRef.current?.run.cast.rollen.find((r) => r.id === m.role_id);
              voice = voiceFor(role);
              cur = { id: m.id, roleId: m.role_id!, round: m.round ?? 1, tag: null, text: "", meta: m.meta };
              setLive({ ...cur });
            } else if (ev.t === "tag" && cur) {
              cur.tag = ev.tag as Tag;
              setLive({ ...cur });
            } else if (ev.t === "delta" && cur) {
              full += ev.text as string;
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
          if ((e as Error).name !== "AbortError") {
            clearInterval(tick);
            throw e;
          }
        }
        // Eerst uitlezen (of uitpraten), dan pas de volgende.
        while (shown < full.length && !ctrl.signal.aborted && !pausedRef.current) await sleep(80);
        clearInterval(tick);
        if (!pausedRef.current) await speech().idle();
        await reload();
        setLive(null);
        if (pausedRef.current) {
          skipRef.current = null;
          setReading(null);
          break;
        }
        // Even laten landen, of wachten tot jij op 'Volgende' klikt.
        if (!skipPause) {
          setReading("wachten");
          // Kijkt telkens naar het huidige tempo: wie van 'Zelf' naar 'Normaal' wisselt, gaat vanzelf verder.
          let woken = false;
          skipRef.current = () => {
            woken = true;
          };
          const t0 = Date.now();
          while (!woken && !pausedRef.current && Date.now() - t0 < TEMPO[tempoRef.current].pause) await sleep(100);
        }
        skipRef.current = null;
        setReading(null);
      }
    } catch (e) {
      setError(toError(e));
      setPausedBoth(true);
    } finally {
      loopingRef.current = false;
      setPending(false);
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
        // 'Alleen het advies' loopt (of liep vast): niet zelf afspelen, maar de voortgang tonen.
        const auto = autorunState(d.messages);
        if (auto !== "uit") {
          setPhase("auto");
          // Na een herstart van de server pakt dit de draad weer op (dubbel starten kan niet).
          if (auto === "aan") void api(`/api/runs/${id}/autorun`, { method: "POST" }).catch(() => {});
          return;
        }
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

  useEffect(() => speechRef.current?.setRate(TEMPO[tempo].speech), [tempo]);

  // ---------- de baas grijpt in ----------
  function interrupt() {
    setPausedBoth(true);
    skipRef.current?.();
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

  // Pijltje naar rechts = 'Volgende' (niet als je aan het typen bent).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "ArrowRight" || el?.closest("input, textarea, select, [contenteditable]")) return;
      if (skipRef.current) {
        e.preventDefault();
        skipRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const auto = data ? autorunState(data.messages) : "uit";
  const runStatus = data?.run.status;
  // Voortgang van 'alleen het advies' ophalen; klaar = door naar het resultaat.
  useEffect(() => {
    if (auto !== "aan" || runStatus === "done" || runStatus === "stopped") return;
    const t = setInterval(async () => {
      try {
        const d = await reload();
        if (d.run.status === "done") {
          setToResult(true);
          router.push(`/resultaat/${id}`);
        }
      } catch {
        /* volgende keer beter */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [auto, runStatus, reload, router, id]);

  /** Toch meekijken: de server stopt na de beurt die nu bezig is, en de arena neemt het over. */
  async function watchAnyway() {
    try {
      await api(`/api/runs/${id}/autorun`, { method: "DELETE" });
      const d = await reload();
      const turns = d.messages.filter((m) => m.kind === "turn");
      if (d.step?.type === "final_word") {
        setPhase("laatste_woord");
        setPausedBoth(true);
      } else if (turns.length === 0) {
        setPausedBoth(false);
        setPhase("prep");
      } else {
        setStopPanel(false);
        setPausedBoth(false);
        setPhase("debat");
        void loop();
      }
    } catch (e) {
      setError(toError(e));
    }
  }

  async function retryAuto() {
    setError(null);
    try {
      await api(`/api/runs/${id}/autorun`, { method: "POST" });
      await reload();
    } catch (e) {
      setError(toError(e));
    }
  }

  /** Niet meer meekijken: de server maakt de vergadering af en jij krijgt alleen het advies. */
  async function onlyAdvice() {
    // De beurt die nu bezig is mag uitpraten; daarna neemt de server het over.
    pausedRef.current = true;
    setPaused(true);
    setPhase("auto");
    skipRef.current?.();
    speechRef.current?.stop();
    setStopPanel(false);
    try {
      await api(`/api/runs/${id}/autorun`, { method: "POST" });
      await reload();
    } catch (e) {
      setError(toError(e));
    }
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

  async function raiseLimit(extra: number) {
    const cur = dataRef.current;
    if (!cur) return;
    const next = Math.round(((cur.run.cast.kostenlimiet ?? cur.run.cost_eur) + extra) * 100) / 100;
    try {
      await api(`/api/runs/${id}`, { method: "PATCH", json: { handmatig: true, cast: { ...cur.run.cast, kostenlimiet: next } } });
      await reload();
      setBudgetHit(false);
      resume();
    } catch (e) {
      setError(toError(e));
    }
  }

  async function setVoices(stemmen: "uit" | "jury" | "iedereen") {
    const cur = dataRef.current;
    if (!cur) return;
    if (stemmen === "uit") speechRef.current?.stop();
    try {
      await api(`/api/runs/${id}`, { method: "PATCH", json: { handmatig: true, cast: { ...cur.run.cast, stemmen } } });
      await reload();
    } catch (e) {
      setError(toError(e));
    }
  }

  async function setGrok(roleId: string, ongecensureerd: boolean) {
    const cur = dataRef.current;
    if (!cur) return;
    const cast = { ...cur.run.cast, rollen: cur.run.cast.rollen.map((r) => (r.id === roleId ? { ...r, ongezouten: ongecensureerd } : r)) };
    try {
      await api(`/api/runs/${id}`, { method: "PATCH", json: { cast } });
      await reload();
    } catch (e) {
      setError(toError(e));
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

  async function endMeeting() {
    interrupt();
    try {
      await api(`/api/runs/${id}/stop`, { method: "POST" });
      router.push(`/resultaat/${id}`);
    } catch (e) {
      setError(toError(e));
    }
  }

  // ---------- weergave ----------
  if (!data) {
    return (
      <div className="flex-1 grid place-items-center p-6 text-center">
        {error ? <ErrorNote error={error} /> : <FunWait lines={LOADING_LINES} size="lg" />}
      </div>
    );
  }

  const { run, messages } = data;
  if (toResult) {
    return (
      <div className="flex-1 grid place-items-center p-6 text-center">
        <FunWait lines={["📬 Het advies ligt klaar…"]} size="lg" />
      </div>
    );
  }
  if (auto !== "uit" && run.status !== "done" && run.status !== "stopped") {
    return <AutoView data={data} onWatch={() => void watchAnyway()} onRetry={() => void retryAuto()} error={error} />;
  }
  if (run.status === "done" || run.status === "stopped") {
    return (
      <ReplayPlayer
        title={run.title ?? run.question}
        roles={run.cast.rollen}
        portraits={Object.fromEntries(run.cast.rollen.map((r) => [r.id, run.prep[r.id]?.portraits]))}
        messages={messages}
        highlights={run.highlights}
        rounds={run.cast.rondes}
        goldenChair={run.debate_number === 10}
        runId={run.id}
        voices={data.keys.elevenlabs ? data.stemmen : undefined}
        listen={listen}
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
  const limit = run.cast.kostenlimiet ?? null;
  const participants = roles.filter((r) => !r.isJury);
  const spicy = participants.filter((r) => r.ongezouten).length;
  const portraits = Object.fromEntries(roles.map((r) => [r.id, run.prep[r.id]?.portraits]));

  // Het hele gesprek tot nu toe, plus wat er nu gezegd wordt.
  const feed: FeedItem[] = [];
  for (const m of messages) {
    if (m.kind === "turn" && m.content && !m.meta.streaming) {
      const notes = [
        m.meta.interrupted ? "onderbroken" : null,
        m.meta.extra === "eensgezind" ? "verdacht eensgezind…" : null,
        m.meta.answer ? "antwoordt de baas" : null,
        m.meta.opening ? "opent de vergadering" : null,
        m.meta.fallback ? `${m.meta.fallback.van} deed het niet, ${m.meta.fallback.naar} sprak namens deze rol` : null,
      ].filter(Boolean);
      feed.push({ id: m.id, who: m.role_id!, text: m.content, tag: m.tag, sources: m.sources, note: notes.join(" · ") || undefined });
    } else if (m.kind === "boss") {
      feed.push({ id: m.id, who: "baas", text: m.content, note: bossNote(m, roles) });
    } else if (m.kind === "system" && m.meta.wrapUp) {
      feed.push({ id: m.id, who: "systeem", text: m.meta.budget ? "Het budget is op. De voorzitter rondt af." : "De baas rondt af. De voorzitter vat samen." });
    }
  }
  const liveRole = live ? roles.find((r) => r.id === live.roleId) : undefined;
  if (live && liveRole) {
    feed.push({
      id: live.id,
      who: live.roleId,
      text: live.text,
      tag: live.tag,
      streaming: true,
      waiting: turnWaitLines(liveRole),
      note: live.meta.extra === "eensgezind" ? "verdacht eensgezind…" : live.meta.opening ? "opent de vergadering" : undefined,
    });
  }
  // Tussen de beurten: laat al zien wie de volgende is en wat die doet.
  const next = !live && pending && !paused && phase === "debat" && data.step?.type === "turn" ? roles.find((r) => r.id === (data.step as { roleId: string }).roleId) : undefined;
  if (next) {
    feed.push({ id: "volgende", who: next.id, text: "", streaming: true, waiting: turnWaitLines(next) });
  }
  if (phase === "laatste_woord" && jury) {
    feed.push({ id: "laatste-woord", who: jury.id, text: "Wil je nog iets meegeven voordat ik afrond?" });
  }

  let activeId: string | null = null;
  let mood: Mood = "neutraal";
  if (phase === "laatste_woord" && jury) activeId = jury.id;
  else if (live) {
    activeId = live.roleId;
    mood = live.tag ? TAG_MOOD[live.tag] : "neutraal";
  }

  const round = live?.round ?? Math.max(1, ...messages.filter((m) => m.kind === "turn").map((m) => m.round ?? 1));
  const roundLabel =
    phase === "laatste_woord" || live?.meta.verdict
      ? "Afronding"
      : phase === "prep"
        ? "Voorbereiding"
        : live?.meta.opening || (phase === "debat" && !messages.some((m) => m.kind === "turn"))
          ? "Opening"
          : `Ronde ${round} van ${run.cast.rondes}`;

  const looking =
    phase === "prep"
      ? Object.fromEntries(
          roles.map((r) => {
            const p = run.prep[r.id];
            if (r.isJury) return [r.id, undefined];
            if (p?.homeworkStatus === "klaar") return [r.id, p.facts?.length ? `✓ Klaar: ${p.facts.length} feiten` : "✓ Klaar"];
            if (p?.homeworkStatus === "mislukt") return [r.id, "✓ Klaar (zonder huiswerk)"];
            return [r.id, `⏳ ${p?.looking?.at(-1) ?? "Zoekt nog feiten…"}`];
          }),
        )
      : undefined;

  const banner =
    phase === "prep" ? (
      <PrepBanner
        roles={roles}
        prep={run.prep}
        started={prepStarted}
        onStart={() => {
          setPhase("debat");
          void loop();
        }}
      />
    ) : phase === "oordeel" ? (
      <div className="w-full max-w-2xl rounded-3xl bg-sun border-2 border-ink px-5 py-4 shadow-[3px_3px_0_0_var(--color-ink)] animate-pop">
        <span className="block text-xs font-semibold uppercase tracking-wide text-ink/60 mb-1">De voorzitter zet alles op een rij</span>
        <FunWait lines={JURY_LINES} size="lg" />
      </div>
    ) : null;

  const headerExtra = [
    <button
      key="censuur"
      onClick={() => setCensorOpen((v) => !v)}
      aria-expanded={censorOpen}
      className={`rounded-full border-2 border-ink px-3 py-0.5 text-xs sm:text-sm font-semibold ${spicy ? "bg-coral text-white" : "bg-white"}`}
    >
      🌶️ Censuur{spicy ? `: ${spicy} ongecensureerd` : ""} {censorOpen ? "▴" : "▾"}
    </button>,
    ...(censorOpen
      ? participants.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-white pl-3 pr-1 py-0.5 text-xs sm:text-sm">
            <span className="font-semibold">{firstName(r.naam)}</span>
            <CensorToggle size="xs" value={!!r.ongezouten} onChange={(v) => void setGrok(r.id, v)} />
          </span>
        ))
      : []),
  ];

  const placeholder =
    phase === "laatste_woord"
      ? "Je laatste woord voor de voorzitter (of sla over)"
      : mode === "hamer"
        ? "Wat besluit je? Daarna staat het vast."
        : mode === "richting"
          ? "Welke kant moet het op?"
          : mode === "vraag"
            ? target
              ? `Je vraag aan ${firstName(roles.find((r) => r.id === target)?.naam ?? "")}`
              : "Kies eerst aan wie"
            : paused
              ? "Je hebt het woord. Zeg het maar."
              : "Typ of spreek in om in te grijpen";

  const menuRole = roles.find((r) => r.id === menuFor);

  return (
    <div className="relative flex flex-col h-[calc(100dvh-58px)]">
      <Stage
        title={run.title ?? run.question}
        roles={roles}
        portraits={portraits}
        activeId={activeId}
        mood={mood}
        feed={feed}
        thinkingId={live && !live.text ? live.roleId : (next?.id ?? null)}
        roundLabel={roundLabel}
        headerExtra={headerExtra}
        banner={banner}
        looking={looking}
        quips={quips}
        onRoleClick={(rid) => setMenuFor(menuFor === rid ? null : rid)}
        goldenChair={run.debate_number === 10}
        footer={
          <>
            <button
              onClick={() => setShowCost((v) => !v)}
              className={`underline decoration-dotted underline-offset-2 hover:text-ink ${limit && run.cost_eur >= limit * 0.8 ? "text-coral font-semibold" : ""}`}
              title="Bekijk tokens en kosten per rol"
            >
              {euro(run.cost_eur)}
              {limit ? ` van max ${euro(limit)}` : ""} · {tokens(data.usage.total.inputTokens + data.usage.total.cachedTokens + data.usage.total.outputTokens)} tokens
            </button>
            {data.keys.elevenlabs && (
              <span className="flex items-center gap-1.5">
                🔊
                <Segmented
                  label="Stemmen"
                  size="xs"
                  value={run.cast.stemmen}
                  onChange={(v) => void setVoices(v)}
                  options={[
                    { value: "uit", label: "Uit" },
                    { value: "jury", label: "Voorzitter" },
                    { value: "iedereen", label: "Iedereen" },
                  ]}
                />
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              📖
              <Segmented
                label="Tempo"
                size="xs"
                value={tempo}
                onChange={(v) => setTempo(v as Tempo)}
                options={[
                  { value: "zelf", label: "👆 Zelf" },
                  { value: "rustig", label: "Rustig" },
                  { value: "normaal", label: "Normaal" },
                  { value: "snel", label: "Snel" },
                  { value: "direct", label: "⚡ Direct" },
                ]}
              />
            </span>
          </>
        }
      >
        <div className="space-y-2">
          {error && <ErrorNote error={error} onClose={() => setError(null)} />}

          {budgetHit && phase === "debat" && (
            <div className="rounded-2xl bg-peach border-2 border-ink p-3 space-y-2 text-sm" role="dialog" aria-label="Kostenlimiet bereikt">
              <p className="font-semibold">
                💶 De kostenlimiet is bereikt: {euro(run.cost_eur)} van max {euro(limit ?? run.cost_eur)}. Er start geen nieuwe beurt.
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost !py-1.5" onClick={() => void raiseLimit(1)}>
                  + €1 en verder
                </button>
                <button
                  className="btn-primary !py-1.5"
                  onClick={async () => {
                    if (await post("afronden")) {
                      setBudgetHit(false);
                      resume();
                    }
                  }}
                >
                  🔔 Afronden: voorzitter geeft advies
                </button>
                <button className="btn-ghost !py-1.5" onClick={endMeeting}>
                  ⏹ Beëindigen
                </button>
              </div>
              <p className="text-xs text-ink/60">Afronden kost nog een paar cent voor het slotadvies van de voorzitter.</p>
            </div>
          )}

          {stopPanel && phase === "debat" && (
            <div className="rounded-2xl bg-sun border-2 border-ink p-3 space-y-2 text-sm" role="dialog" aria-label="De vergadering staat stil">
              <p className="font-semibold">De vergadering staat stil. Wat wil je?</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost !py-1.5" onClick={resume}>
                  ▶ Verder vergaderen
                </button>
                <button
                  className="btn-primary !py-1.5"
                  onClick={async () => {
                    if (await post("afronden")) resume();
                  }}
                >
                  🔔 Afronden: voorzitter geeft advies
                </button>
                {confirmEnd ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>Zeker weten? Er komt dan geen slotadvies.</span>
                    <button className="btn-ghost !py-1.5 !border-coral text-coral" onClick={endMeeting}>
                      Ja, beëindigen
                    </button>
                    <button className="underline" onClick={() => setConfirmEnd(false)}>
                      Nee
                    </button>
                  </span>
                ) : (
                  <button className="btn-ghost !py-1.5" onClick={() => setConfirmEnd(true)}>
                    ⏹ Vergadering beëindigen
                  </button>
                )}
              </div>
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
                  {firstName(r.naam)}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              // Nog aan het inspreken? Dan stoppen we de microfoon; die stuurt het daarna zelf.
              if (listening) micRef.current?.stop();
              else void send();
            }}
          >
            <input
              ref={inputRef}
              value={interim || input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              disabled={sending || phase === "oordeel"}
              className={`field !py-2.5 min-w-0 ${mode === "hamer" ? "ring-4 ring-coral/40" : ""}`}
            />
            <MicButton
              ref={micRef}
              onListening={setListening}
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
            <button className="btn-primary !px-4 shrink-0" disabled={sending || !(input.trim() || interim.trim() || listening)}>
              {sending ? <Spinner /> : listening ? "Stuur ➤" : phase === "laatste_woord" ? "Zeg het" : mode === "hamer" ? "Besluit" : "Zeg"}
            </button>
          </form>
          {listening && <p className="text-xs text-ink/60 -mt-1">🎙️ Ik luister… Klaar? Druk op <b>Stuur</b> (of nog een keer op de microfoon).</p>}

          {phase === "laatste_woord" ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-ghost !py-1.5 text-sm"
                disabled={sending}
                onClick={async () => {
                  if (await post("overslaan")) resume();
                }}
              >
                Nee, rond maar af
              </button>
            </div>
          ) : (
            phase !== "oordeel" && (
              <>
              {reading && !paused && phase === "debat" && (
                <div className="flex items-center gap-2">
                  {reading === "wachten" && tempo === "zelf" ? (
                    <button onClick={() => skipRef.current?.()} className="btn-primary !py-2 !px-5 animate-pop">
                      Volgende spreker ▸
                    </button>
                  ) : (
                    <button onClick={() => skipRef.current?.()} className="btn-ghost !py-1.5 !px-4 text-sm" title="Toon alles meteen en ga door (of druk op →)">
                      ⏭ Volgende
                    </button>
                  )}
                  <span className="text-xs text-ink/55 hidden sm:inline">of druk op →</span>
                </div>
              )}
              <div className="flex gap-1.5 text-sm overflow-x-auto pb-0.5 -mx-1 px-1 sm:flex-wrap sm:overflow-visible">
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
                  🧭 Richting
                </Ctrl>
                <Ctrl onClick={() => setMode(mode === "vraag" ? "opmerking" : "vraag")} active={mode === "vraag"}>
                  ❓ Vraag aan één rol
                </Ctrl>
                <Ctrl onClick={() => void onlyAdvice()} active={false}>
                  ⚡ Alleen het advies
                </Ctrl>
                {paused && !stopPanel && phase === "debat" && (
                  <button onClick={resume} className="shrink-0 ml-auto underline text-sm whitespace-nowrap">
                    ▶ Laat ze verder praten
                  </button>
                )}
              </div>
              </>
            )
          )}
        </div>
      </Stage>

      {menuRole && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)}>
          <div
            className="absolute left-1/2 top-40 -translate-x-1/2 w-[min(92vw,320px)] rounded-2xl border-2 border-ink bg-white shadow-[4px_4px_0_0_var(--color-ink)] p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2 pt-1 pb-2 text-sm font-semibold">
              {menuRole.naam} <span className="font-normal text-ink/60">· {menuRole.isJury ? "Voorzitter" : menuRole.functie}</span>
            </p>
            {menuRole.id !== activeId && (
              <button
                className="w-full text-left rounded-xl px-3 py-2 hover:bg-sun"
                onClick={() => {
                  setMenuFor(null);
                  void quip(menuRole.id);
                }}
              >
                💬 Tik aan
              </button>
            )}
            <button
              className="w-full text-left rounded-xl px-3 py-2 hover:bg-sun"
              onClick={() => {
                setMenuFor(null);
                setMode("vraag");
                setTarget(menuRole.id);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            >
              ❓ Stel {firstName(menuRole.naam)} een vraag
            </button>
            <button
              className="w-full text-left rounded-xl px-3 py-2 hover:bg-sun"
              onClick={() => {
                setMenuFor(null);
                setEditing(menuRole.id);
              }}
            >
              ✏️ Persona aanpassen
            </button>
          </div>
        </div>
      )}

      {editing && roles.some((r) => r.id === editing) && (
        <PersonaEditor
          runId={run.id}
          cast={run.cast}
          role={roles.find((r) => r.id === editing)!}
          prep={run.prep[editing]}
          index={roles.findIndex((r) => r.id === editing)}
          models={data.models}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload();
          }}
        />
      )}

      {showCost && (
        <div className="absolute inset-x-0 bottom-0 z-40 max-h-[75%] overflow-y-auto bg-cream border-t-2 border-ink rounded-t-3xl p-5 shadow-[0_-6px_0_0_var(--color-ink)]">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-center mb-3">
              <h2 className="font-display font-extrabold text-xl flex-1">Tokens en kosten van dit debat</h2>
              <button onClick={() => setShowCost(false)} aria-label="Sluiten" className="text-xl">
                ✕
              </button>
            </div>
            <CostPanel usage={data.usage} roles={roles} />
          </div>
        </div>
      )}

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
  if (a === "vraag") return `❓ aan ${firstName(roles.find((r) => r.id === m.meta.target)?.naam ?? "")}`;
  if (a === "laatste_woord") return "laatste woord";
  return undefined;
}

function Ctrl({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border-2 px-3 py-1.5 font-medium transition ${active ? "bg-ink text-cream border-ink" : "bg-white border-ink hover:bg-sun"}`}
    >
      {children}
    </button>
  );
}

/** Duidelijk maken waar je op wacht: wie nog bezig is, hoeveel er klaar zijn en wanneer het vanzelf begint. */
function PrepBanner({ roles, prep, started, onStart }: { roles: Role[]; prep: Prep; started: number; onStart: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const debaters = roles.filter((r) => !r.isJury);
  const pending = debaters.filter((r) => {
    const s = prep[r.id]?.homeworkStatus;
    return s !== "klaar" && s !== "mislukt";
  });
  const done = debaters.length - pending.length;
  const left = Math.max(0, Math.ceil((started + PREP_TIMEOUT_MS - now) / 1000));
  const klok = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const namen = pending.map((r) => firstName(r.naam));
  const wie = namen.length > 1 ? `${namen.slice(0, -1).join(", ")} en ${namen.at(-1)}` : namen[0];
  return (
    <div className="w-full max-w-2xl rounded-3xl bg-sky border-2 border-ink px-4 sm:px-5 py-3 shadow-[3px_3px_0_0_var(--color-ink)] animate-pop space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-display font-extrabold text-base sm:text-lg">
          Huiswerk: {done} van {debaters.length} klaar
        </span>
        <span className="text-xs sm:text-sm text-ink/70">Het debat begint vanzelf{pending.length ? ` (uiterlijk over ${klok})` : ""}</span>
      </div>
      <div className="h-2 rounded-full bg-white border border-ink/30 overflow-hidden" aria-hidden>
        <div className="h-full bg-ink transition-all duration-700" style={{ width: `${debaters.length ? (done / debaters.length) * 100 : 100}%` }} />
      </div>
      <p className="text-sm text-ink/80">
        {pending.length ? (
          <>
            Iedereen zoekt vooraf een paar feiten op over jouw vraag. We wachten nog op <b>{wie}</b>.
          </>
        ) : (
          "Iedereen is klaar. We beginnen…"
        )}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <FunWait lines={prepLines(pending)} size="lg" />
        {pending.length > 0 && (
          <button onClick={onStart} className="btn-ghost !py-1.5 text-sm shrink-0" title="Wie nog niet klaar is, doet mee zonder die feiten">
            Nu beginnen, zonder {namen.length > 1 ? "hun" : "dat"} huiswerk
          </button>
        )}
      </div>
    </div>
  );
}

/** 'Alleen het advies': de vergadering loopt op de server; hier zie je alleen hoe ver hij is. */
function AutoView({ data, onWatch, onRetry, error }: { data: RunPayload; onWatch: () => void; onRetry: () => void; error: Err }) {
  const { run, messages, step } = data;
  const roles = run.cast.rollen;
  const debaters = roles.filter((r) => !r.isJury);
  const turns = messages.filter((m) => m.kind === "turn" && m.content && !m.meta.streaming);
  const expected = debaters.length * run.cast.rondes + 2; // opening + beurten + advies
  const pct = Math.min(96, Math.round((turns.length / expected) * 100));
  const failed = [...messages].reverse().find((m) => m.kind === "system" && m.meta.autorunError)?.meta.autorunError;
  const stuck = autorunState(messages) === "fout";
  const next = step?.type === "turn" ? roles.find((r) => r.id === step.roleId) : undefined;
  const pendingPrep = debaters.filter((r) => {
    const s = run.prep[r.id]?.homeworkStatus;
    return s !== "klaar" && s !== "mislukt";
  });
  const last = turns.at(-1);
  const lastRole = last ? roles.find((r) => r.id === last.role_id) : undefined;
  const limit = run.cast.kostenlimiet ?? null;

  let title: string;
  let lines: string[];
  if (!turns.length && pendingPrep.length) {
    title = "De rollen doen hun huiswerk";
    lines = prepLines(pendingPrep);
  } else if (next && !next.isJury) {
    title = `Nu aan het woord: ${firstName(next.naam)} (${next.functie})`;
    lines = turnWaitLines(next);
  } else if (next && step?.type === "turn" && step.meta.opening) {
    title = "De voorzitter opent de vergadering";
    lines = turnWaitLines(next);
  } else {
    title = "De voorzitter zet alles op een rij";
    lines = JURY_LINES;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">⚡ Alleen het advies</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl leading-tight mt-1">{run.title ?? run.question}</h1>
        </div>

        <div className="flex flex-wrap gap-3">
          {roles.map((r, i) => (
            <div key={r.id} className={`flex flex-col items-center w-16 ${next?.id === r.id ? "" : "opacity-60"}`}>
              <Portrait name={r.naam} portraits={run.prep[r.id]?.portraits} index={i} size={48} active={next?.id === r.id} />
              <span className="mt-1 text-[11px] text-center leading-tight">{firstName(r.naam)}</span>
            </div>
          ))}
        </div>

        <div className="rounded-3xl bg-sky border-2 border-ink px-5 py-4 shadow-[3px_3px_0_0_var(--color-ink)] space-y-3">
          {stuck ? (
            <>
              <p className="font-display font-extrabold text-lg">De vergadering liep vast</p>
              <ErrorNote error={failed ? { message: failed.error, oplossing: failed.oplossing } : { message: "Er ging iets mis." }} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary !py-2" onClick={onRetry}>
                  Opnieuw proberen
                </button>
                <button className="btn-ghost !py-2" onClick={onWatch}>
                  👀 Zelf verder kijken
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-display font-extrabold text-base sm:text-lg">{title}</span>
                <span className="text-sm text-ink/70">
                  {turns.length} van ongeveer {expected} beurten
                </span>
              </div>
              <div className="h-2 rounded-full bg-white border border-ink/30 overflow-hidden" aria-hidden>
                <div className="h-full bg-ink transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
              <div className="min-h-[4.5rem] flex items-center">
                <FunWait lines={lines} size="lg" />
              </div>
              {last && lastRole && (
                <p className="text-sm text-ink/75 line-clamp-2">
                  <b>{firstName(lastRole.naam)}</b> zei net: &ldquo;{extractSources(last.content).clean.slice(0, 160)}
                  {last.content.length > 160 ? "…" : ""}&rdquo;
                </p>
              )}
            </>
          )}
        </div>

        <ErrorNote error={error} />

        <div className="flex flex-wrap items-center gap-3">
          {!stuck && (
            <button className="btn-ghost !py-2" onClick={onWatch}>
              👀 Toch meekijken
            </button>
          )}
          <span className="text-sm text-ink/60">
            Je kunt dit scherm gerust sluiten. Het advies komt bij <Link href="/geschiedenis" className="underline">Geschiedenis</Link> te staan.
          </span>
        </div>
        <p className="text-xs text-ink/55">
          Kosten tot nu toe: {euro(run.cost_eur)}
          {limit ? ` van max ${euro(limit)}` : ""}. Is het maximum bereikt, dan rondt de voorzitter vanzelf af.
        </p>
      </div>
    </div>
  );
}
