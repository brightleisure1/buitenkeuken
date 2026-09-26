"use client";

import type { Role, RolePrep } from "@/lib/types";
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
  onEdit,
}: {
  role: Role;
  prep?: RolePrep;
  index: number;
  modelLabel?: string;
  readers?: string[];
  voiceOn: boolean;
  onToggleOngezouten?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className={`card p-4 flex gap-4 items-start animate-rise ${role.isJury ? "bg-sun" : ""}`} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="relative">
        <Portrait name={role.naam} portraits={prep?.portraits} index={index} size={72} />
        {prep?.portraitStatus === "bezig" && (
          <span className="absolute -bottom-1 -right-2 text-[10px] bg-white border border-ink rounded-full px-1.5 animate-bounce" title="De tekenaar is bezig">
            ✏️ tekent…
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 min-w-0 flex-1">
          <h3 className="font-display font-bold text-lg leading-tight">{role.naam}</h3>
          <span className="text-sm text-ink/70 break-words">{role.isJury ? "Voorzitter" : role.functie}</span>
          <span className="self-center">
            <AiBadge role={role} />
          </span>
        </div>
          {onEdit && (
            <button onClick={onEdit} className="shrink-0 text-sm font-semibold underline decoration-2 underline-offset-2 hover:text-coral whitespace-nowrap">
              ✏️ Aanpassen
            </button>
          )}
        </div>
        <p className="mt-1 text-[15px] leading-snug">{role.zin}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {role.isKritisch && <Badge className="bg-peach">Kritisch</Badge>}
          {role.isJury && <Badge className="bg-white">Geeft advies</Badge>}
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
        {!role.isJury && onToggleOngezouten && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-ink/15 bg-cream px-3 py-2">
            <span className="font-semibold text-sm">Censuur:</span>
            <CensorToggle value={!!role.ongezouten} onChange={(v) => v !== !!role.ongezouten && onToggleOngezouten()} />
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ children, className = "bg-cream" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full border border-ink/15 px-2 py-0.5 ${className}`}>{children}</span>;
}
