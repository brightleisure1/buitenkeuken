"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";

type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSR(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type MicHandle = {
  /** Stop met luisteren; wat er is ingesproken gaat naar onText. */
  stop: () => void;
};

/**
 * Inspreken via Web Speech (nl-NL). Werkt de browser dat niet?
 * Dan nemen we audio op en laat OpenAI het uitschrijven.
 */
export function MicButton({
  onText,
  onInterim,
  onError,
  className = "",
  size = "md",
  ref,
  onListening,
}: {
  ref?: React.Ref<MicHandle>;
  /** Meldt of er nu geluisterd wordt */
  onListening?: (on: boolean) => void;
  onText: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (msg: string) => void;
  className?: string;
  size?: "md" | "lg";
}) {
  const [state, setState] = useState<"idle" | "listening" | "working">("idle");
  const recRef = useRef<SR | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");

  useImperativeHandle(ref, () => ({ stop }));
  useEffect(() => onListening?.(state !== "idle"), [state, onListening]);

  useEffect(() => () => {
    recRef.current?.stop();
    mediaRef.current?.stop();
  }, []);

  async function startFallback() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("working");
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, `spraak.${(rec.mimeType || "audio/webm").includes("mp4") ? "mp4" : "webm"}`);
        try {
          const res = await fetch("/api/stt", { method: "POST", body: fd });
          const d = await res.json();
          if (!res.ok) onError?.(`${d.error} ${d.oplossing ?? ""}`);
          else if (d.text) onText(d.text);
        } catch {
          onError?.("Uitschrijven lukte niet. Probeer het nog eens of typ je bericht.");
        }
        setState("idle");
      };
      mediaRef.current = rec;
      rec.start();
      setState("listening");
    } catch {
      onError?.("We mogen je microfoon niet gebruiken. Geef de browser toestemming en probeer het opnieuw.");
    }
  }

  function start() {
    const Ctor = getSR();
    if (!Ctor) return void startFallback();
    const rec = new Ctor();
    rec.lang = "nl-NL";
    rec.interimResults = true;
    rec.continuous = true;
    finalRef.current = "";
    interimRef.current = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      interimRef.current = interim;
      onInterim?.((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        recRef.current = null;
        setState("idle");
        void startFallback();
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        onError?.("Inspreken haperde. Probeer het nog eens of typ je bericht.");
      }
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      setState("idle");
      // Ook het laatste stukje dat nog niet 'definitief' was, telt mee.
      const t = `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, " ").trim();
      interimRef.current = "";
      if (t) onText(t);
      onInterim?.("");
    };
    recRef.current = rec;
    rec.start();
    setState("listening");
  }

  function stop() {
    if (recRef.current) recRef.current.stop();
    else if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
  }

  const dim = size === "lg" ? "h-14 w-14" : "h-11 w-11";
  return (
    <button
      type="button"
      onClick={() => (state === "listening" ? stop() : state === "idle" ? start() : undefined)}
      aria-label={state === "listening" ? "Stop met inspreken" : "Inspreken"}
      title={state === "listening" ? "Klik om te stoppen" : "Inspreken"}
      className={`${dim} shrink-0 rounded-full border-2 border-ink grid place-items-center transition ${
        state === "listening" ? "bg-coral text-white animate-pulse" : state === "working" ? "bg-sun" : "bg-white hover:bg-sun"
      } ${className}`}
    >
      {state === "working" ? (
        <span className="h-4 w-4 rounded-full border-2 border-ink border-t-transparent animate-spin" />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
