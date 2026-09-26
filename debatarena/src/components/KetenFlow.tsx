"use client";

import type { Keten } from "@/lib/types";
import { FunWait } from "./FunWait";

type State = "klaar" | "bezig" | "straks" | "fout";
const FASEN = ["huiswerk", "versie1", "review", "herschrijven", "slotcheck", "klaar"] as const;

/** Waar staan we? Oudere ketens hebben nog geen fase: afleiden uit de inhoud. */
function faseVan(k: Keten | null | undefined): number {
  if (!k) return 0;
  if (k.status === "klaar") return 5;
  if (k.fase) return FASEN.indexOf(k.fase);
  if (!k.rondes.length) return 0;
  return k.rondes.at(-1)!.reviews.length ? 3 : 2;
}

/** Het flowschema van de review-keten, live bijgewerkt. */
export function KetenFlow({ keten, meelezers }: { keten: Keten | null | undefined; meelezers: number }) {
  const k = keten;
  const fase = faseVan(k);
  const fout = k?.status === "fout";
  const st = (i: number, doneFrom: number): State => (fase >= doneFrom ? "klaar" : fase === i ? (fout ? "fout" : "bezig") : "straks");
  const max = k?.maxRondes ?? 2;
  const ronde = Math.min(k?.rondes.at(-1)?.nr ?? 1, Math.max(max, k?.rondes.length ?? 1));
  const laatsteOordeel = k?.rondes.filter((r) => r.oordelen.length).at(-1);
  const over = laatsteOordeel ? laatsteOordeel.oordelen.filter((o) => o.oordeel !== "niet").length : 0;
  // In de lus horen lezen en herschrijven bij de huidige ronde.
  const lezen = st(2, 3);
  const herschrijfState = st(3, 4);

  return (
    <section className="card p-4 sm:p-5 space-y-3" aria-label="Voortgang van de review-keten">
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-2 lg:gap-0">
        <Node icon="❓" title="Vraag" detail="en jouw antwoorden" state="klaar" />
        <Pijl />
        <Node icon="🔎" title="Huiswerk" detail="feiten met bron" state={st(0, 1)} />
        <Pijl />
        <Node icon="✍️" title="Versie 1" detail={k?.auteur.ai ? `door ${k.auteur.ai}` : "slimste model"} state={st(1, 2)} />
        <Pijl />
        <div
          className={`relative rounded-2xl border border-dashed px-2.5 pt-5 pb-2.5 lg:mx-0.5 flex flex-col lg:flex-row lg:items-stretch gap-2 lg:gap-0 ${
            fase === 2 || fase === 3 ? "border-coral/60 bg-coral/[0.03]" : "border-ink/20"
          }`}
        >
          <span className="absolute -top-2.5 left-3 bg-white px-1.5 text-[11px] font-semibold text-ink/70">
            ↺ Ronde {ronde} van {max}
          </span>
          <div className="flex flex-col gap-2">
            <Node icon="👥" title="Meelezers" detail={`${meelezers} rollen`} state={lezen} />
            {k?.kruis !== null && <Node icon="🔍" title="Tegenlezer" detail={k?.kruis?.ai ?? "ander model"} state={lezen} />}
          </div>
          <Pijl />
          <Node
            icon="⚖️"
            title="Beoordelen en herschrijven"
            detail={laatsteOordeel ? `${over} van ${laatsteOordeel.oordelen.length} punten overgenomen` : "per punt: over, deels of niet"}
            state={herschrijfState}
          />
        </div>
        <Pijl />
        <Node icon="🧭" title="Slotcheck" detail="voorzitter" state={st(4, 5)} />
        <Pijl />
        <Node icon="✅" title="Advies" detail={k?.status === "klaar" ? `${k.rondes.length} versies` : "blind vergelijken"} state={fase >= 5 ? "klaar" : "straks"} />
      </div>
      {k?.status === "bezig" && (
        <div className="min-h-[2.5rem] flex items-center">
          <FunWait lines={[k.stap]} icon="⏳" />
        </div>
      )}
    </section>
  );
}

const STYLE: Record<State, string> = {
  klaar: "bg-ink text-white border-ink",
  bezig: "bg-white border-coral ring-4 ring-coral/15 animate-glow",
  straks: "bg-ink/[0.03] border-ink/10 text-ink/50",
  fout: "bg-peach border-coral",
};

function Node({ icon, title, detail, state }: { icon: string; title: string; detail: string; state: State }) {
  return (
    <div className={`rounded-xl border px-3 py-2 min-w-0 lg:min-w-[108px] lg:max-w-[150px] transition-colors ${STYLE[state]}`} aria-current={state === "bezig" ? "step" : undefined}>
      <p className="text-sm font-semibold leading-tight flex items-center gap-1.5">
        <span aria-hidden>{state === "klaar" ? "✓" : icon}</span>
        {title}
        {state === "bezig" && <span className="ml-auto h-2 w-2 rounded-full bg-coral animate-pulse" aria-label="bezig" />}
      </p>
      <p className={`text-[11px] leading-snug mt-0.5 ${state === "klaar" ? "text-white/70" : "text-ink/55"}`}>{state === "fout" ? "vastgelopen" : detail}</p>
    </div>
  );
}

function Pijl() {
  return (
    <span className="self-center text-ink/30 text-sm lg:px-1.5 leading-none" aria-hidden>
      <span className="hidden lg:inline">→</span>
      <span className="lg:hidden">↓</span>
    </span>
  );
}
