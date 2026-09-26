"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SpeechQueue } from "@/lib/speech";
import { TAG_MOOD } from "@/lib/text";
import type { Highlight, Message, Mood, Role } from "@/lib/types";
import { Stage, firstName, type FeedItem } from "./Stage";

const SPEEDS = [1, 2, 4];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Regieaanwijzingen (*pakt spullen in*) niet uitspreken. */
const speakable = (t: string) => t.replace(/\*[^*]+\*/g, "").replace(/\s+/g, " ").trim();

/** Speelt een afgerond debat opnieuw af: tekst, en stemmen als die er zijn (of ingesproken kunnen worden). */
export function ReplayPlayer({
  title,
  roles,
  portraits,
  messages,
  highlights,
  rounds,
  goldenChair,
  extra,
  fullHeight,
  runId,
  voices,
  listen = false,
}: {
  title: string;
  roles: Role[];
  portraits: Record<string, Partial<Record<Mood, string>> | undefined>;
  messages: Message[];
  highlights: Highlight[] | null;
  rounds: number;
  goldenChair?: boolean;
  extra?: React.ReactNode;
  fullHeight?: boolean;
  /** Met runId + voices kan de speler ontbrekende audio laten inspreken (alleen in de app, niet publiek). */
  runId?: string;
  voices?: Record<string, string>;
  listen?: boolean;
}) {
  const [onlyHighlights, setOnlyHighlights] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [sound, setSound] = useState(true);
  const speechRef = useRef<SpeechQueue | null>(null);
  const runRef = useRef(0);
  const speedRef = useRef(speed);
  const soundRef = useRef(sound);
  const prefetched = useRef(new Set<string>());
  useEffect(() => {
    speedRef.current = speed;
    soundRef.current = sound;
  }, [speed, sound]);

  const items = useMemo(() => {
    const all = messages.filter((m) => (m.kind === "turn" && m.content) || (m.kind === "boss" && m.content));
    if (!onlyHighlights || !highlights?.length) return all;
    const ids = new Set(highlights.map((h) => h.messageId));
    return all.filter((m) => ids.has(m.id));
  }, [messages, highlights, onlyHighlights]);

  const voiceOf = (m: Message) => (voices ? (m.kind === "boss" ? voices.baas : voices[m.role_id ?? ""]) : undefined);
  const canVoice = (m: Message) => !!(m.audio?.length || (runId && voiceOf(m)));
  const hasAudio = items.some(canVoice);

  useEffect(() => {
    speechRef.current?.setRate(speed);
  }, [speed]);
  useEffect(() => () => speechRef.current?.stop(), []);

  /** Alvast de volgende laten inspreken, zodat er geen gat valt. */
  function prefetch(m?: Message) {
    if (!m || !runId || m.audio?.length || prefetched.current.has(m.id)) return;
    const voiceId = voiceOf(m);
    if (!voiceId) return;
    prefetched.current.add(m.id);
    void fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, messageId: m.id, idx: 1000, text: speakable(m.content), voiceId }),
    })
      .then((r) => r.blob())
      .catch(() => prefetched.current.delete(m.id));
  }

  async function play(from: number) {
    const token = ++runRef.current;
    speechRef.current ??= new SpeechQueue();
    const speech = speechRef.current;
    speech.stop();
    speech.setRate(speedRef.current);
    setPlaying(true);
    setStarted(true);
    for (let i = from; i < items.length; i++) {
      if (runRef.current !== token) return;
      setIndex(i);
      setShown(0);
      const m = items[i];
      let voiced = false;
      if (soundRef.current) {
        if (m.audio?.length) {
          [...m.audio].sort((a, b) => a.idx - b.idx).forEach((a) => speech.playUrl(a.url));
          voiced = true;
        } else if (runId && voiceOf(m)) {
          speech.say({ runId, messageId: m.id, idx: 1000, text: speakable(m.content), voiceId: voiceOf(m)! });
          voiced = true;
        }
        prefetch(items[i + 1]);
      }
      const total = m.content.length;
      // Met stem: ongeveer op spreektempo meelezen; zonder stem: vlot doorlezen.
      const step = voiced ? 0.7 : 3;
      for (let c = 0; c < total; ) {
        if (runRef.current !== token) return;
        c = Math.min(total, c + step * speedRef.current);
        setShown(Math.floor(c));
        await sleep(40);
      }
      await speech.idle();
      if (runRef.current !== token) return;
      await sleep(700 / speedRef.current);
    }
    if (runRef.current === token) setPlaying(false);
  }

  function pause() {
    runRef.current++;
    speechRef.current?.stop();
    setPlaying(false);
    setShown(items[index]?.content.length ?? 0);
  }

  function restart(nextOnly = onlyHighlights) {
    runRef.current++;
    speechRef.current?.stop();
    setOnlyHighlights(nextOnly);
    setIndex(0);
    setShown(0);
    setPlaying(false);
    setStarted(false);
  }

  // Gesprek tot nu toe: alles vóór het huidige bericht, plus het huidige zover het getypt is.
  const feed: FeedItem[] = [];
  if (started) {
    items.slice(0, index + 1).forEach((m, i) => {
      const current = i === index;
      const text = current && playing ? m.content.slice(0, shown) : m.content;
      const streaming = current && playing && shown < m.content.length;
      const note = onlyHighlights ? highlights?.find((h) => h.messageId === m.id)?.waarom : m.meta.interrupted ? "onderbroken" : undefined;
      feed.push({ id: m.id, who: m.kind === "boss" ? "baas" : m.role_id!, text, tag: m.tag, sources: streaming ? [] : m.sources, streaming, note });
    });
  }
  const cur = items[Math.min(index, items.length - 1)];
  const role = roles.find((r) => r.id === cur?.role_id);
  const mood: Mood = cur?.tag ? TAG_MOOD[cur.tag] : "neutraal";
  const roundLabel = !started ? "Terugkijken" : cur?.meta.verdict ? "Uitspraak" : onlyHighlights ? "Hoogtepunten" : `Ronde ${cur?.round ?? 1} van ${rounds}`;

  return (
    <div className={`flex flex-col ${fullHeight ? "h-[100dvh]" : "h-[calc(100dvh-58px)]"}`}>
      <Stage
        title={title}
        roles={roles}
        portraits={portraits}
        activeId={started && cur?.kind === "turn" ? (role?.id ?? null) : null}
        mood={mood}
        feed={feed}
        roundLabel={roundLabel}
        goldenChair={goldenChair}
        banner={
          !started && items.length ? (
            <button onClick={() => void play(0)} className="btn-primary text-base mt-2">
              {hasAudio && (listen || sound) ? "🎧 Beluister de hele vergadering" : "▶ Speel de vergadering af"}
            </button>
          ) : undefined
        }
        footer={
          <span>
            {items.length ? Math.min(index + 1, items.length) : 0} / {items.length}
            {started && cur && ` · ${cur.kind === "boss" ? "de baas" : firstName(role?.naam ?? "")}`}
          </span>
        }
      >
        <div className="flex gap-2 items-center text-sm overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
          <button
            onClick={() => (playing ? pause() : void play(index >= items.length - 1 && shown >= (cur?.content.length ?? 0) && started ? 0 : started ? index : 0))}
            className="btn-primary !py-2 !px-5 shrink-0"
            disabled={!items.length}
          >
            {playing ? "⏸ Pauze" : "▶ Afspelen"}
          </button>
          <button onClick={() => restart()} className="btn-ghost !py-1.5 !px-3 shrink-0" title="Opnieuw beginnen">
            ⏮
          </button>
          <span className="flex items-center gap-1 shrink-0">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={`rounded-full px-2.5 py-1 border-2 ${speed === s ? "bg-ink text-cream border-ink" : "border-ink/30 bg-white"}`}>
                {s}x
              </button>
            ))}
          </span>
          {!!highlights?.length && (
            <button
              onClick={() => restart(!onlyHighlights)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 border-2 ${onlyHighlights ? "bg-lilac border-ink" : "border-ink/30 bg-white"}`}
            >
              ✨ Hoogtepunten
            </button>
          )}
          {hasAudio && (
            <button onClick={() => setSound((v) => !v)} className="shrink-0 whitespace-nowrap rounded-full px-3 py-1 border-2 border-ink/30 bg-white">
              {sound ? "🔊 Geluid aan" : "🔇 Geluid uit"}
            </button>
          )}
          <span className="ml-auto shrink-0">{extra}</span>
        </div>
      </Stage>
    </div>
  );
}
