"use client";

import type { Role, RolePrep } from "@/lib/types";
import { getModel } from "@/lib/config";
import { clicheOf } from "@/lib/cliches";
import { AiBadge, CensorToggle, Portrait } from "./ui";

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
          {role.ongezouten && <Badge className="bg-coral text-white border-coral">🌶️ Ongecensureerd</Badge>}
          {clicheOf(role) && (
            <span title={clicheOf(role)!.omschrijving}>
              <Badge className="bg-lilac">🎭 {clicheOf(role)!.naam}</Badge>
            </span>
          )}
          {role.webzoeken && <Badge>Zoekt op het web</Badge>}
          {voiceOn && role.stemId && <Badge>Praat hardop</Badge>}
          {readers?.map((r) => (
            <Badge key={r} className="bg-sky">
              Leest {r}
            </Badge>
          ))}
        </div>
        {isGrok && onToggleOngezouten && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink/70">Grok:</span>
            <CensorToggle value={!!role.ongezouten} onChange={(v) => v !== !!role.ongezouten && onToggleOngezouten()} />
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ children, className = "bg-cream" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full border border-ink/30 px-2 py-0.5 ${className}`}>{children}</span>;
}
