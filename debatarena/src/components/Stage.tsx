"use client";

import { extractSources } from "@/lib/text";
import type { Mood, Role, Tag } from "@/lib/types";
import { useKonami, useLateNight, usePortraitSize } from "@/lib/hooks";
import { providerOf } from "@/lib/config";
import { AiBadge, Portrait } from "./ui";

export interface Bubble {
  who: string | "baas";
  text: string;
  tag?: Tag | null;
  sources?: string[];
  streaming?: boolean;
  note?: string;
}

/** Het podium: portretten naast elkaar, een tekstballon, en de baas achter zijn bureau. */
export function Stage({
  title,
  roles,
  portraits,
  activeId,
  mood,
  bubble,
  roundLabel,
  banner,
  looking,
  quips,
  onRoleClick,
  goldenChair,
  footer,
  children,
}: {
  title: string;
  roles: Role[];
  portraits: Record<string, Partial<Record<Mood, string>> | undefined>;
  activeId: string | null;
  mood: Mood;
  bubble: Bubble | null;
  roundLabel: string;
  banner?: React.ReactNode;
  looking?: Record<string, string | undefined>;
  quips?: Record<string, string | undefined>;
  onRoleClick?: (id: string) => void;
  goldenChair?: boolean;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const sunglasses = useKonami();
  const late = useLateNight();
  const size = usePortraitSize();
  const speaker = roles.find((r) => r.id === bubble?.who);
  const text = bubble ? extractSources(bubble.text) : null;
  const sources = [...new Set([...(bubble?.sources ?? []), ...(text?.sources ?? [])])];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 pt-3 flex items-center gap-3">
        <h1 className="font-display font-extrabold text-base sm:text-lg truncate flex-1">{title}</h1>
        <span className="shrink-0 rounded-full bg-ink text-cream text-xs sm:text-sm font-semibold px-3 py-1">{roundLabel}</span>
      </div>

      <div className="flex gap-3 sm:gap-6 px-4 pt-4 pb-2 overflow-x-auto sm:justify-center items-start">
        {roles.map((r, i) => {
          const active = r.id === activeId;
          return (
            <div key={r.id} className={`relative flex flex-col items-center shrink-0 ${r.isJury ? "sm:ml-4 sm:pl-6 sm:border-l-2 sm:border-dashed sm:border-ink/25" : ""}`} style={{ width: size + 24 }}>
              <Portrait
                name={r.naam}
                portraits={portraits[r.id]}
                mood={active ? mood : "neutraal"}
                index={i}
                size={size}
                active={active}
                dim={!!activeId && !active}
                sunglasses={sunglasses}
                mug={late}
                onClick={onRoleClick && !active ? () => onRoleClick(r.id) : undefined}
                title={onRoleClick && !active ? `Tik ${r.naam} aan` : r.naam}
              />
              <span className={`mt-1.5 text-xs sm:text-sm text-center leading-tight ${active ? "font-bold" : "font-medium"}`}>{r.naam.split(" ")[0]}</span>
              <span className="text-[10px] sm:text-xs text-ink/60 text-center leading-tight line-clamp-1">{r.isJury ? "Jury" : r.functie}</span>
              <span className="mt-1">
                <AiBadge role={r} size="xs" />
              </span>
              {looking?.[r.id] && (
                <span className="mt-1 text-[10px] sm:text-[11px] text-center text-ink/70 bg-sky rounded-lg px-1.5 py-0.5 line-clamp-2 animate-pop">{looking[r.id]}</span>
              )}
              {quips?.[r.id] && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full z-10 w-max max-w-[180px] text-xs bg-white border-2 border-ink rounded-2xl px-2.5 py-1.5 animate-pop shadow">
                  {quips[r.id]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {banner && <div className="px-4 pt-2 flex justify-center">{banner}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {bubble && (
          <div className="mx-auto max-w-2xl">
            <div
              className={`relative rounded-3xl border-2 border-ink p-4 sm:p-6 shadow-[4px_4px_0_0_var(--color-ink)] ${
                bubble.who === "baas" ? "bg-ink text-cream" : speaker?.isJury ? "bg-sun" : "bg-white"
              }`}
            >
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${bubble.who === "baas" ? "text-cream/70" : "text-ink/60"}`}>
                {bubble.who === "baas"
                  ? "Jij, de baas"
                  : speaker
                    ? `${speaker.naam} · ${speaker.isJury ? "Jury" : speaker.functie} · ${providerOf(speaker).naam}${speaker.ongezouten ? " 🌶️" : ""}`
                    : ""}
                {bubble.note && <span className="ml-2 normal-case tracking-normal font-normal">{bubble.note}</span>}
              </p>
              <p className={`text-[17px] sm:text-xl leading-relaxed whitespace-pre-wrap ${bubble.streaming ? "caret" : ""}`}>
                {text?.clean || (bubble.streaming ? "" : "…")}
              </p>
              {sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sources.map((s) => (
                    <span key={s} className="text-[11px] rounded-full bg-cream border border-ink/25 px-2 py-0.5 text-ink/80">
                      bron: {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t-2 border-ink bg-white/60">
        <div className="mx-auto max-w-3xl px-4 pt-3 pb-2 flex items-end gap-3">
          <Desk golden={!!goldenChair} />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
        {footer && <div className="mx-auto max-w-3xl px-4 pb-2 text-xs text-ink/60 flex items-center gap-3">{footer}</div>}
      </div>
    </div>
  );
}

function Desk({ golden }: { golden: boolean }) {
  return (
    <div className="hidden sm:flex flex-col items-center shrink-0" title={golden ? "Je 10e debat: een gouden bureaustoel!" : "Jij, de baas"}>
      <svg width="92" height="74" viewBox="0 0 92 74" aria-hidden>
        <rect x="30" y="4" width="32" height="34" rx="10" fill={golden ? "var(--color-gold)" : "#b9a88f"} stroke="#1e1b18" strokeWidth="2.5" />
        {golden && <text x="46" y="26" textAnchor="middle" fontSize="12">★</text>}
        <circle cx="46" cy="30" r="10" fill="#ffd6c9" stroke="#1e1b18" strokeWidth="2.5" />
        <path d="M32 50 q14 -14 28 0" fill="#1e1b18" />
        <rect x="4" y="46" width="84" height="12" rx="3" fill="#8b5e3c" stroke="#1e1b18" strokeWidth="2.5" />
        <rect x="10" y="58" width="8" height="14" fill="#8b5e3c" stroke="#1e1b18" strokeWidth="2.5" />
        <rect x="74" y="58" width="8" height="14" fill="#8b5e3c" stroke="#1e1b18" strokeWidth="2.5" />
        <rect x="58" y="40" width="16" height="6" rx="2" fill="#e4572e" stroke="#1e1b18" strokeWidth="2" />
      </svg>
      <span className="text-[11px] font-semibold -mt-0.5">De baas</span>
    </div>
  );
}
