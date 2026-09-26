"use client";

import { useEffect, useState } from "react";

/** Wisselende grappige zinnetjes in plaats van een draaiend rondje. */
export function FunWait({ lines, className = "", every = 2200 }: { lines: string[]; className?: string; every?: number }) {
  const [i, setI] = useState(0);
  const key = lines.join("|");
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), every);
    return () => clearInterval(t);
  }, [key, every]);
  if (!lines.length) return null;
  const line = lines[i % lines.length];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-live="polite">
      <span key={i} className="animate-rise">
        {line}
      </span>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((d) => (
          <span key={d} className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: `${d * 150}ms` }} />
        ))}
      </span>
    </span>
  );
}
