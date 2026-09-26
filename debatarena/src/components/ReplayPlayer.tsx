"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SpeechQueue } from "@/lib/speech";
import { TAG_MOOD } from "@/lib/text";
import type { Highlight, Message, Mood, Role } from "@/lib/types";
import { Stage, type Bubble } from "./Stage";

const SPEEDS = [1, 2, 4];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Speelt een afgerond debat opnieuw af: tekst (en stemmen als die er zijn). */
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
}) {
  const [onlyHighlights, setOnlyHighlights] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [sound, setSound] = useState(true);
  const speechRef = useRef<SpeechQueue | null>(null);
  const runRef = useRef(0);
  const speedRef = useRef(speed);
  const soundRef = useRef(sound);
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

  const hasAudio = messages.some((m) => m.audio?.length);
  const cur = items[Math.min(index, items.length - 1)];

  useEffect(() => {
    speechRef.current?.setRate(speed);
  }, [speed]);

  useEffect(() => () => speechRef.current?.stop(), []);

  async function play(from: number) {
    const token = ++runRef.current;
    speechRef.current ??= new SpeechQueue();
    const speech = speechRef.current;
    speech.stop();
    speech.setRate(speedRef.current);
    setPlaying(true);
    for (let i = from; i < items.length; i++) {
      if (runRef.current !== token) return;
      setIndex(i);
      setShown(0);
      const m = items[i];
      if (soundRef.current && m.audio?.length) {
        [...m.audio].sort((a, b) => a.idx - b.idx).forEach((a) => speech.playUrl(a.url));
      }
      const total = m.content.length;
      for (let c = 0; c < total; ) {
        if (runRef.current !== token) return;
        c = Math.min(total, c + 3 * speedRef.current);
        setShown(c);
        await sleep(40);
      }
      await speech.idle();
      if (runRef.current !== token) return;
      await sleep(900 / speedRef.current);
    }
    if (runRef.current === token) setPlaying(false);
  }

  function pause() {
    runRef.current++;
    speechRef.current?.stop();
    setPlaying(false);
    setShown(cur?.content.length ?? 0);
  }

  function restart(nextOnly = onlyHighlights) {
    runRef.current++;
    speechRef.current?.stop();
    setOnlyHighlights(nextOnly);
    setIndex(0);
    setShown(0);
    setPlaying(false);
  }

  const role = roles.find((r) => r.id === cur?.role_id);
  const bubble: Bubble | null = cur
    ? cur.kind === "boss"
      ? { who: "baas", text: cur.content.slice(0, shown || (playing ? 0 : cur.content.length)), streaming: playing && shown < cur.content.length }
      : {
          who: cur.role_id!,
          text: cur.content.slice(0, shown || (playing ? 0 : cur.content.length)),
          sources: shown >= cur.content.length || !playing ? cur.sources : [],
          streaming: playing && shown < cur.content.length,
          note: onlyHighlights ? highlights?.find((h) => h.messageId === cur.id)?.waarom : undefined,
        }
    : null;
  const mood: Mood = cur?.tag ? TAG_MOOD[cur.tag] : "neutraal";
  const roundLabel = cur?.meta.verdict ? "Uitspraak" : onlyHighlights ? "Hoogtepunten" : `Ronde ${cur?.round ?? 1} van ${rounds}`;

  return (
    <div className={`flex flex-col ${fullHeight ? "h-[100dvh]" : "h-[calc(100dvh-58px)]"}`}>
      <Stage
        title={title}
        roles={roles}
        portraits={portraits}
        activeId={cur?.kind === "turn" ? (role?.id ?? null) : null}
        mood={mood}
        bubble={bubble}
        roundLabel={roundLabel}
        goldenChair={goldenChair}
        footer={
          <span>
            {items.length ? index + 1 : 0} / {items.length}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button onClick={() => (playing ? pause() : play(index >= items.length - 1 && shown >= (cur?.content.length ?? 0) ? 0 : index))} className="btn-primary !py-2 !px-5" disabled={!items.length}>
            {playing ? "⏸ Pauze" : "▶ Afspelen"}
          </button>
          <button onClick={() => restart()} className="btn-ghost !py-1.5 !px-3" title="Opnieuw beginnen">
            ⏮
          </button>
          <span className="flex items-center gap-1">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={`rounded-full px-2.5 py-1 border-2 ${speed === s ? "bg-ink text-cream border-ink" : "border-ink/30 bg-white"}`}>
                {s}x
              </button>
            ))}
          </span>
          {!!highlights?.length && (
            <button
              onClick={() => restart(!onlyHighlights)}
              className={`rounded-full px-3 py-1 border-2 ${onlyHighlights ? "bg-lilac border-ink" : "border-ink/30 bg-white"}`}
            >
              ✨ Alleen hoogtepunten
            </button>
          )}
          {hasAudio && (
            <button onClick={() => setSound((v) => !v)} className="rounded-full px-3 py-1 border-2 border-ink/30 bg-white">
              {sound ? "🔊 Geluid aan" : "🔇 Geluid uit"}
            </button>
          )}
          <span className="ml-auto">{extra}</span>
        </div>
      </Stage>
    </div>
  );
}
