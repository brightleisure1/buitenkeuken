"use client";

import type { Role, RolePrep } from "@/lib/types";
import { getModel } from "@/lib/config";
import { AiBadge, Portrait } from "./ui";

export function RoleCard({
  role,
  prep,
  index,
  modelLabel,
  readers,
  voiceOn,
  onToggleOngezouten,
}: {
  role: Role;
  prep?: RolePrep;
  index: number;
  modelLabel?: string;
  readers?: string[];
  voiceOn: boolean;
  onToggleOngezouten?: () => void;
}) {
  const isGrok = getModel(role.modelKey)?.provider === "xai" || /^grok/i.test(role.customModel ?? "");
  return (
    <div className={`card p-4 flex gap-4 items-start animate-rise ${role.isJury ? "bg-sun" : ""}`} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="relative">
        <Portrait name={role.naam} portraits={prep?.portraits} index={index} size={72} />
        {prep?.portraitStatus === "bezig" && !prep.portraits?.neutraal && (
          <span className="absolute -bottom-1 -right-1 text-[10px] bg-white border border-ink rounded-full px-1.5">tekenen…</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="font-display font-extrabold text-lg leading-tight">{role.naam}</h3>
          <span className="text-sm text-ink/70">{role.isJury ? "Jury" : role.functie}</span>
          <span className="self-center">
            <AiBadge role={role} />
          </span>
        </div>
        <p className="mt-1 text-[15px] leading-snug">{role.zin}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {role.isKritisch && <Badge className="bg-peach">Kritisch</Badge>}
          {role.isJury && <Badge className="bg-white">Doet uitspraak</Badge>}
          {modelLabel && <Badge>{modelLabel}</Badge>}
          {role.ongezouten && <Badge className="bg-coral text-white border-coral">🌶️ Zonder filter</Badge>}
          {role.webzoeken && <Badge>Zoekt op het web</Badge>}
          {voiceOn && role.stemId && <Badge>Praat hardop</Badge>}
          {readers?.map((r) => (
            <Badge key={r} className="bg-sky">
              Leest {r}
            </Badge>
          ))}
        </div>
        {isGrok && onToggleOngezouten && (
          <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
            <span
              role="switch"
              aria-checked={!!role.ongezouten}
              className={`relative inline-block h-6 w-11 rounded-full border-2 border-ink transition ${role.ongezouten ? "bg-coral" : "bg-cream"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white border-2 border-ink transition-all ${role.ongezouten ? "left-5" : "left-0.5"}`} />
            </span>
            <input type="checkbox" className="sr-only" checked={!!role.ongezouten} onChange={onToggleOngezouten} />
            <span>
              <strong>Ongezouten</strong> <span className="text-ink/60">– Grok zegt alles zonder filter</span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

function Badge({ children, className = "bg-cream" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full border border-ink/30 px-2 py-0.5 ${className}`}>{children}</span>;
}
