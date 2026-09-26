"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { extractSources } from "@/lib/text";
import type { Mood, Role, Tag } from "@/lib/types";
import { useKonami, useLateNight, usePortraitSize } from "@/lib/hooks";
import { AiBadge, Portrait } from "./ui";
import { FunWait } from "./FunWait";

export interface FeedItem {
  id: string;
  who: string | "baas" | "systeem";
  text: string;
  tag?: Tag | null;
  sources?: string[];
  streaming?: boolean;
  note?: string;
  /** Zinnetjes zolang er nog geen tekst is */
  waiting?: string[];
}

/** Titels als "Dr." of "Mr." niet als voornaam tonen. */
export function firstName(naam: string) {
  return naam.replace(/^(mr\.|dr\.|drs\.|ir\.|prof\.|ing\.)\s*/i, "").split(" ")[0] || naam;
}

/** Het podium: portretten, het doorlopende gesprek en de baas achter zijn bureau. */
export function Stage({
  title,
  roles,
  portraits,
  activeId,
  mood,
  feed,
  roundLabel,
  headerExtra,
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
  feed: FeedItem[];
  roundLabel: string;
  headerExtra?: React.ReactNode;
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
  const roleIndex = new Map(roles.map((r, i) => [r.id, i]));

  // Meescrollen, tenzij je zelf omhoog hebt gescrold om terug te lezen.
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const lastLen = feed.map((f) => f.text.length + (f.waiting ? 1 : 0)).join(",");
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [lastLen, stuck, banner]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 sm:px-4 pt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="font-display font-extrabold text-base sm:text-lg truncate flex-1 min-w-0">{title}</h1>
        <span className="shrink-0 rounded-full bg-ink text-cream text-xs sm:text-sm font-semibold px-3 py-1 sm:order-last">{roundLabel}</span>
        {headerExtra && <div className="basis-full sm:basis-auto flex flex-wrap gap-2">{headerExtra}</div>}
      </div>

      <div className="flex gap-2 sm:gap-4 px-3 sm:px-4 pt-2 pb-1 overflow-x-auto sm:justify-center items-start shrink-0">
        {roles.map((r, i) => {
          const active = r.id === activeId;
          return (
            <div
              key={r.id}
              className={`relative flex flex-col items-center shrink-0 ${r.isJury ? "sm:ml-2 sm:pl-4 sm:border-l-2 sm:border-dashed sm:border-ink/25" : ""}`}
              style={{ width: size + 34 }}
            >
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
                onClick={onRoleClick ? () => onRoleClick(r.id) : undefined}
                title={`${r.naam} — ${r.isJury ? "Jury" : r.functie}`}
              />
              <span className={`mt-1 text-xs sm:text-sm text-center leading-tight ${active ? "font-bold" : "font-medium"}`}>{firstName(r.naam)}</span>
              {size > 40 && (
                <span className="text-[10px] sm:text-[11px] text-ink/60 text-center leading-tight line-clamp-2 break-words w-full" title={r.functie}>
                  {r.isJury ? "Jury" : r.functie}
                </span>
              )}
              <span className="mt-0.5">
                <AiBadge role={r} size="xs" />
              </span>
              {looking?.[r.id] && (
                <span className="mt-1 text-[10px] sm:text-[11px] text-center text-ink/70 bg-sky rounded-lg px-1.5 py-0.5 line-clamp-2 animate-rise">{looking[r.id]}</span>
              )}
              {quips?.[r.id] && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-max max-w-[200px] text-xs bg-white border-2 border-ink rounded-2xl px-2.5 py-1.5 animate-pop shadow">
                  {quips[r.id]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {banner && <div className="px-3 pt-1 flex justify-center shrink-0">{banner}</div>}

      <div className="relative flex-1 min-h-0">
        <div ref={scroller} className="absolute inset-0 overflow-y-auto px-3 sm:px-4 py-3">
          <div className="mx-auto max-w-2xl space-y-3">
            {feed.map((f) => (
              <FeedBubble key={f.id} item={f} role={roles.find((r) => r.id === f.who)} index={roleIndex.get(f.who) ?? 0} portraits={portraits} />
            ))}
          </div>
        </div>
        {!stuck && (
          <button
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              setStuck(true);
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink text-cream text-sm font-semibold px-4 py-1.5 shadow-lg"
          >
            ↓ Naar het nieuwste
          </button>
        )}
      </div>

      <div className="border-t-2 border-ink bg-white/70 shrink-0">
        <div className="mx-auto max-w-3xl px-3 sm:px-4 pt-2.5 pb-1.5 flex items-end gap-3">
          <Desk golden={!!goldenChair} />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
        {footer && <div className="mx-auto max-w-3xl px-3 sm:px-4 pb-2 text-xs text-ink/60 flex flex-wrap items-center gap-x-3 gap-y-1.5">{footer}</div>}
      </div>
    </div>
  );
}

function FeedBubble({
  item,
  role,
  index,
  portraits,
}: {
  item: FeedItem;
  role?: Role;
  index: number;
  portraits: Record<string, Partial<Record<Mood, string>> | undefined>;
}) {
  if (item.who === "systeem") {
    return <p className="text-center text-xs text-ink/55 italic">{item.text}</p>;
  }
  const { clean, sources: inText } = extractSources(item.text);
  const sources = [...new Set([...(item.sources ?? []), ...inText])];
  if (item.who === "baas") {
    return (
      <div className="flex justify-end animate-rise">
        <div className="max-w-[85%] rounded-3xl rounded-br-md bg-ink text-cream px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cream/60">
            Jij, de baas{item.note ? ` · ${item.note}` : ""}
          </p>
          <p className="text-[15px] sm:text-base leading-relaxed whitespace-pre-wrap break-words">{clean}</p>
        </div>
      </div>
    );
  }
  const mood: Mood = item.tag === "bezwaar" ? "sceptisch" : item.tag === "akkoord" ? "enthousiast" : "neutraal";
  return (
    <div className="flex gap-2.5 items-start animate-rise">
      <div className="shrink-0 mt-1">
        <Portrait name={role?.naam ?? "?"} portraits={role ? portraits[role.id] : undefined} mood={mood} index={index} size={36} />
      </div>
      <div
        className={`min-w-0 flex-1 rounded-3xl rounded-tl-md border-2 px-4 py-2.5 ${
          item.streaming ? "border-coral bg-white shadow-[3px_3px_0_0_var(--color-ink)]" : role?.isJury ? "border-ink/15 bg-sun" : "border-ink/15 bg-white"
        }`}
      >
        <p className="text-[11px] sm:text-xs font-semibold text-ink/60 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-ink">{role?.naam ?? "Onbekend"}</span>
          <span className="font-normal break-words">· {role?.isJury ? "Jury" : role?.functie}</span>
          {role && <AiBadge role={role} size="xs" />}
          {item.note && <span className="font-normal italic">· {item.note}</span>}
        </p>
        {item.waiting && !clean ? (
          <p className="text-[15px] sm:text-base text-ink/60 py-0.5">
            <FunWait lines={item.waiting} every={1800} />
          </p>
        ) : (
          <p className={`text-[15px] sm:text-base leading-relaxed whitespace-pre-wrap break-words ${item.streaming ? "caret" : ""}`}>{clean}</p>
        )}
        {sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <span key={s} className="text-[11px] rounded-full bg-cream border border-ink/25 px-2 py-0.5 text-ink/80 break-all">
                bron: {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Desk({ golden }: { golden: boolean }) {
  return (
    <div className="hidden md:flex flex-col items-center shrink-0 [@media(max-height:760px)]:hidden" title={golden ? "Je 10e debat: een gouden bureaustoel!" : "Jij, de baas"}>
      <svg width="76" height="62" viewBox="0 0 92 74" aria-hidden>
        <rect x="30" y="4" width="32" height="34" rx="10" fill={golden ? "var(--color-gold)" : "#b9a88f"} stroke="#1e1b18" strokeWidth="2.5" />
        {golden && (
          <text x="46" y="26" textAnchor="middle" fontSize="12">
            ★
          </text>
        )}
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
