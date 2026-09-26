"use client";

import { useEffect, useState } from "react";
import type { Keten } from "@/lib/types";

type State = "klaar" | "bezig" | "straks" | "fout";
const FASEN = ["huiswerk", "verbreden", "samenvoegen", "review", "herschrijven", "slotcheck", "redactie", "klaar"] as const;
const AANTAL = FASEN.length;

/** Waar staan we? Oudere ketens hebben nog geen fase: afleiden uit de inhoud. */
function faseVan(k: Keten | null | undefined): number {
  if (!k) return 0;
  if (k.status === "klaar") return AANTAL - 1;
  if (k.fase === "versie1") return 1; // oudere ketens
  if (k.fase) return FASEN.indexOf(k.fase);
  if (!k.rondes.length) return 0;
  return k.rondes.at(-1)!.reviews.length ? 4 : 3;
}

type Stap = { titel: string; detail: string; state: State; lus?: boolean };

/** Compacte stappenbalk van de review-keten, live bijgewerkt. */
export function KetenFlow({ keten, meelezers }: { keten: Keten | null | undefined; meelezers: number }) {
  const k = keten;
  const fase = faseVan(k);
  const fout = k?.status === "fout";
  const st = (i: number): State => (fase > i ? "klaar" : fase === i ? (fout ? "fout" : k?.status === "klaar" ? "klaar" : "bezig") : "straks");
  const max = k?.maxRondes ?? 2;
  const ronde = Math.min(k?.rondes.at(-1)?.nr ?? 1, Math.max(max, k?.rondes.length ?? 1));
  const laatste = k?.rondes.filter((r) => r.oordelen.length).at(-1);
  const over = laatste ? laatste.oordelen.filter((o) => o.oordeel !== "niet").length : 0;

  const concepten = k?.concepten?.map((c) => c.ai).join(", ");
  const stappen: Stap[] = [
    { titel: "Huiswerk", detail: "feiten met bron", state: st(0) },
    { titel: "Eerste versies", detail: concepten || "2 tot 3 modellen", state: st(1) },
    { titel: "Samenvoegen", detail: k?.herkomst ? `${k.herkomst.filter((h) => h.status === "opgenomen").length} inzichten` : "tot versie 1", state: st(2) },
    { titel: "Reviews", detail: `${meelezers} rollen${k?.kruis ? ` + ${k.kruis.ai}` : ""}`, state: st(3), lus: true },
    { titel: "Herschrijven", detail: laatste ? `${over} van ${laatste.oordelen.length} overgenomen` : "eerst beoordelen", state: st(4), lus: true },
    { titel: "Slotcheck", detail: "voorzitter", state: st(5) },
    { titel: "Eindredactie", detail: "leesbaar en gecontroleerd", state: st(6) },
    { titel: "Advies", detail: k?.status === "klaar" ? "klaar" : "om op te besluiten", state: fase >= AANTAL - 1 ? "klaar" : "straks" },
  ];

  return (
    <section className="card px-4 py-4 sm:px-6 sm:py-5" aria-label="Voortgang van de review-keten">
      <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-8 sm:gap-0">
        {/* De review-lus: licht gemarkeerd achter 'Reviews' en 'Herschrijven' */}
        <li aria-hidden className="pointer-events-none absolute hidden sm:block inset-y-[-6px] left-[calc(3/8*100%)] w-[calc(2/8*100%)] rounded-2xl bg-coral/[0.06] ring-1 ring-coral/15">
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 text-[11px] font-medium text-coral ring-1 ring-coral/20">
            Ronde {ronde} van {max}
          </span>
        </li>
        {stappen.map((s, i) => (
          <li key={s.titel} className="relative flex items-center gap-3 sm:flex-col sm:gap-2 sm:text-center">
            {i > 0 && <span aria-hidden className={`absolute hidden sm:block top-[15px] right-1/2 w-full h-px ${s.state === "straks" ? "bg-ink/10" : "bg-ink/40"}`} />}
            <Bol state={s.state} nr={i + 1} />
            <span className="min-w-0">
              <span className={`block text-sm font-medium leading-tight ${s.state === "straks" ? "text-ink/45" : "text-ink"}`}>
                {s.titel}
                {s.lus && <span className="sm:hidden text-[11px] text-coral font-normal"> · ronde {ronde} van {max}</span>}
              </span>
              <span className="block text-[11px] leading-snug text-ink/50 mt-0.5">{s.state === "fout" ? "vastgelopen" : s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      {k?.status === "bezig" && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/70">
          <span className="h-1.5 w-1.5 rounded-full bg-coral animate-pulse" aria-hidden />
          {k.stap}
          {k.sinds && <Klok sinds={k.sinds} />}
          {k.fase && DUUR[k.fase] && <span className="text-xs text-ink/45">meestal {DUUR[k.fase]}</span>}
        </p>
      )}
    </section>
  );
}

/** Hoe lang een stap meestal duurt, zodat je weet waar je op wacht. */
const DUUR: Partial<Record<NonNullable<Keten["fase"]>, string>> = {
  huiswerk: "een halve minuut",
  versie1: "1 tot 2 minuten",
  verbreden: "1 tot 2 minuten",
  samenvoegen: "1 tot 2 minuten",
  redactie: "1 tot 2 minuten",
  review: "een halve minuut",
  herschrijven: "1 tot 2 minuten",
  slotcheck: "een halve minuut",
};

function Klok({ sinds }: { sinds: number }) {
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((nu - sinds) / 1000));
  return <span className="tabular-nums text-ink/50">· {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

function Bol({ state, nr }: { state: State; nr: number }) {
  const base = "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors";
  if (state === "klaar")
    return (
      <span className={`${base} bg-ink text-white`} aria-label="klaar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  if (state === "bezig")
    return (
      <span className={`${base} bg-white text-coral ring-2 ring-coral`} aria-current="step">
        <span className="absolute inset-0 rounded-full ring-4 ring-coral/20 animate-ping" aria-hidden />
        {nr}
      </span>
    );
  if (state === "fout") return <span className={`${base} bg-peach text-coral ring-2 ring-coral`}>!</span>;
  return <span className={`${base} bg-white text-ink/40 ring-1 ring-ink/15`}>{nr}</span>;
}
