"use client";

import { useEffect, useState } from "react";

const EMOJI = /^(\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;

/** Wisselende grappige zinnetjes in plaats van een draaiend rondje. */
export function FunWait({
  lines,
  className = "",
  every = 2200,
  size = "sm",
  icon = "💭",
}: {
  lines: string[];
  className?: string;
  every?: number;
  size?: "sm" | "lg";
  /** Icoon als een zinnetje zelf geen emoji heeft (alleen bij size="lg") */
  icon?: string;
}) {
  const [i, setI] = useState(0);
  const key = lines.join("|");
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), every);
    return () => clearInterval(t);
  }, [key, every]);
  if (!lines.length) return null;
  const line = lines[i % lines.length];
  const dots = (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className={`${size === "lg" ? "h-2 w-2" : "h-1.5 w-1.5"} rounded-full bg-current opacity-60 animate-bounce`}
          style={{ animationDelay: `${d * 150}ms` }}
        />
      ))}
    </span>
  );
  if (size === "sm") {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`} aria-live="polite">
        <span key={i} className="animate-rise">
          {line}
        </span>
        {dots}
      </span>
    );
  }
  const m = line.match(EMOJI);
  const emoji = m ? m[1] : icon;
  const text = m ? line.slice(m[0].length) : line;
  return (
    <span className={`flex items-center gap-3 ${className}`} aria-live="polite">
      <span key={`e${i}`} className="text-3xl sm:text-4xl leading-none animate-wiggle shrink-0" aria-hidden>
        {emoji}
      </span>
      <span className="flex flex-col gap-1.5 min-w-0">
        <span key={i} className="animate-rise text-base sm:text-lg font-semibold leading-snug line-clamp-2">
          {text}
        </span>
        {dots}
      </span>
    </span>
  );
}
