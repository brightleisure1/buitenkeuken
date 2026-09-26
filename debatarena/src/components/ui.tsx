"use client";

import { useState } from "react";
import type { Mood } from "@/lib/types";
import { initials } from "@/lib/text";

export function ErrorNote({ error, onClose }: { error: { message: string; oplossing?: string } | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-2xl border-2 border-coral bg-[#FFF1EC] p-4 text-sm flex gap-3 items-start">
      <span className="text-lg leading-none">⚠️</span>
      <div className="flex-1">
        <p className="font-semibold">{error.message}</p>
        {error.oplossing && <p className="mt-1 text-ink/75">{error.oplossing}</p>}
      </div>
      {onClose && (
        <button onClick={onClose} className="text-ink/50 hover:text-ink" aria-label="Sluiten">
          ✕
        </button>
      )}
    </div>
  );
}

export function toError(e: unknown) {
  const err = e as { message?: string; oplossing?: string };
  return { message: err.message ?? "Er ging iets mis.", oplossing: err.oplossing };
}

export function CopyButton({ text, label = "Kopieer" }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="no-print text-xs rounded-full border border-ink/20 px-3 py-1 hover:bg-ink hover:text-cream transition"
    >
      {done ? "Gekopieerd ✓" : label}
    </button>
  );
}

const BG = ["bg-peach", "bg-sky", "bg-mint", "bg-lilac", "bg-sun", "bg-rose"];

export function Portrait({
  name,
  portraits,
  mood = "neutraal",
  index = 0,
  size = 96,
  active = false,
  dim = false,
  sunglasses = false,
  mug = false,
  onClick,
  title,
}: {
  name: string;
  portraits?: Partial<Record<Mood, string>>;
  mood?: Mood;
  index?: number;
  size?: number;
  active?: boolean;
  dim?: boolean;
  sunglasses?: boolean;
  mug?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const src = portraits?.[mood] ?? portraits?.neutraal;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? name}
      disabled={!onClick}
      style={{ width: size, height: size }}
      className={`relative shrink-0 rounded-full border-[3px] border-ink overflow-visible transition-all duration-300 ${
        active ? "ring-4 ring-coral ring-offset-2 ring-offset-cream scale-105" : ""
      } ${dim ? "opacity-55 grayscale-[35%]" : ""} ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <span className={`absolute inset-0 rounded-full overflow-hidden grid place-items-center ${BG[index % BG.length]}`}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="font-display font-extrabold" style={{ fontSize: size / 3 }}>
            {initials(name)}
          </span>
        )}
      </span>
      {sunglasses && (
        <span className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ top: size * 0.26, fontSize: size * 0.42 }}>
          🕶️
        </span>
      )}
      {mug && (
        <span className="absolute -right-2 -bottom-1 pointer-events-none" style={{ fontSize: size * 0.3 }}>
          ☕
        </span>
      )}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin ${className}`} />;
}
