"use client";

import { useCallback, useEffect, useState } from "react";
import { api, euro } from "@/lib/client";
import { ketenMarkdown } from "@/lib/keten-markdown";
import type { RunPayload } from "@/lib/payload";
import type { AdviesDoc, Keten, KetenRonde, Oordeel, Review, ReviewPunt } from "@/lib/types";
import { tokens } from "@/lib/usage";
import { CostPanel } from "./CostPanel";
import { KetenFlow } from "./KetenFlow";
import { Vergelijk } from "./ResultView";
import { ErrorNote, Spinner, toError } from "./ui";

type Err = { message: string; oplossing?: string } | null;

const ZWAARTE: Record<ReviewPunt["zwaarte"], string> = { hoog: "bg-coral text-white", midden: "bg-sun", laag: "bg-ink/5 text-ink/60" };
const OORDEEL: Record<Oordeel["oordeel"], { tekst: string; klas: string; dot: string }> = {
  over: { tekst: "Overgenomen", klas: "text-emerald-700", dot: "bg-emerald-500" },
  deels: { tekst: "Deels overgenomen", klas: "text-amber-700", dot: "bg-amber-400" },
  niet: { tekst: "Niet overgenomen", klas: "text-ink/55", dot: "bg-ink/25" },
};

/** Het werkblad van de review-keten: het document dat beter wordt, de reviews, de oordelen en jouw ingrepen. */
export function Werkblad({ id }: { id: string }) {
  const [data, setData] = useState<RunPayload | null>(null);
  const [error, setError] = useState<Err>(null);
  const [versie, setVersie] = useState<number | null>(null);
  const [ronde, setRonde] = useState<number | null>(null);
  const [opmerking, setOpmerking] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await api<RunPayload>(`/api/runs/${id}`);
    setData(d);
    return d;
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data ophalen; state wordt pas na de fetch gezet
    load()
      .then((d) => {
        // Liep de keten nog toen de server herstartte? Dan pakt dit hem weer op (dubbel starten kan niet).
        if (d.run.keten?.status === "bezig") void api(`/api/runs/${id}/keten`, { method: "POST", json: {} }).catch(() => {});
      })
      .catch((e) => setError(toError(e)));
  }, [load, id]);

  const bezig = data?.run.keten?.status === "bezig" || (data?.run.status === "running" && !data?.run.keten);
  useEffect(() => {
    if (!bezig) return;
    const t = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [bezig, load]);

  async function post(path: string, json: object) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", json });
      await load();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="flex-1 grid place-items-center p-6">{error ? <ErrorNote error={error} /> : <p className="text-sm text-ink/55">Het werkblad wordt geopend…</p>}</div>;
  }
  const { run } = data;
  const k: Keten | null | undefined = run.keten;
  const docs = k?.rondes ?? [];
  const toonVersie = versie ?? docs.length;
  const huidigDoc: AdviesDoc | undefined = docs[toonVersie - 1]?.doc;
  const vorigeRonde = docs[toonVersie - 2];
  const reviewRondes = docs.filter((r) => r.reviews.length);
  // Standaard de laatste ronde met oordelen (daar gebeurde het meeste), anders de laatste met reviews.
  const toonRonde = ronde ?? reviewRondes.filter((x) => x.oordelen.length).at(-1)?.nr ?? reviewRondes.at(-1)?.nr ?? null;
  const r = reviewRondes.find((x) => x.nr === toonRonde);
  const openBaas = (k?.baas.opmerkingen.filter((o) => !o.verwerkt).length ?? 0) + Object.keys(k?.baas.overrides ?? {}).length;
  const limit = run.cast.kostenlimiet ?? null;

  function download() {
    const blob = new Blob([ketenMarkdown(run)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(run.title ?? "advies").replace(/[^\w\- ]+/g, "").trim() || "advies"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8 space-y-5">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">Review-keten</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight">{run.title ?? run.question}</h1>
        <p className="text-sm text-ink/65">{run.question}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/65">
          {k?.auteur.ai && (
            <span>
              Schrijver: <b className="text-ink">{k.auteur.ai}</b>
              {k.kruis && (
                <>
                  {" "}
                  · Tegenlezer: <b className="text-ink">{k.kruis.ai}</b>
                </>
              )}
            </span>
          )}
          <span>
            {euro(run.cost_eur)}
            {limit ? ` van max ${euro(limit)}` : ""} · {tokens(data.usage.total.inputTokens + data.usage.total.cachedTokens + data.usage.total.outputTokens)} tokens
          </span>
          <span className="no-print flex gap-3 ml-auto">
            <button className="underline" onClick={download}>
              Markdown
            </button>
            <button className="underline" onClick={() => window.print()}>
              PDF
            </button>
          </span>
        </div>
      </header>

      <KetenFlow keten={k} meelezers={run.cast.rollen.filter((r) => !r.isJury).length} />

      {k?.status === "fout" && (
        <div className="card p-4 space-y-2">
          <ErrorNote error={k.fout ? { message: k.fout.error, oplossing: k.fout.oplossing } : { message: "Er ging iets mis." }} />
          <button className="btn-primary !py-2" disabled={busy} onClick={() => void post(`/api/runs/${id}/keten`, {})}>
            Opnieuw proberen
          </button>
        </div>
      )}
      {k?.budgetOp && k.status === "klaar" && (
        <div className="card p-4 text-sm flex flex-wrap items-center gap-3">
          <span>Het budget van deze keten was op, dus niet alle rondes zijn gedaan.</span>
          <button
            className="btn-ghost !py-1.5"
            disabled={busy}
            onClick={async () => {
              await api(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...run.cast, kostenlimiet: (limit ?? 0) + 1 } } });
              await post(`/api/runs/${id}/keten`, { extra: true });
            }}
          >
            + € 1 en nog een ronde
          </button>
        </div>
      )}
      <ErrorNote error={error} onClose={() => setError(null)} />

      {k?.slot && <Slot keten={k} />}

      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 items-start">
        {/* Het document */}
        <section className="card p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display font-bold text-lg mr-auto">Het advies</h2>
            {docs.map((d) => (
              <button
                key={d.nr}
                onClick={() => setVersie(d.nr)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${toonVersie === d.nr ? "bg-ink text-white border-ink" : "border-ink/15 bg-white"}`}
              >
                Versie {d.nr}
                {k?.status === "klaar" && d.nr === docs.length ? " · eind" : ""}
              </button>
            ))}
          </div>
          {huidigDoc ? (
            <>
              {vorigeRonde?.wijzigingen.length ? (
                <div className="rounded-xl bg-mint/70 px-3 py-2 text-sm">
                  <p className="font-semibold mb-1">Wat veranderde ten opzichte van versie {vorigeRonde.nr}</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {vorigeRonde.wijzigingen.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DocView doc={huidigDoc} />
            </>
          ) : (
            <div className="space-y-3 py-2" aria-busy="true" aria-label="Versie 1 wordt geschreven">
              <div className="h-6 w-3/4 rounded-lg bg-ink/[0.06] animate-pulse" />
              <div className="h-3 w-full rounded bg-ink/[0.05] animate-pulse" />
              <div className="h-3 w-11/12 rounded bg-ink/[0.05] animate-pulse" />
              <div className="h-3 w-4/5 rounded bg-ink/[0.05] animate-pulse" />
              <p className="pt-2 text-sm text-ink/55">Versie 1 verschijnt hier zodra hij klaar is. Dat duurt meestal een minuut of twee.</p>
            </div>
          )}
        </section>

        {/* De reviews */}
        <section className="space-y-4 min-w-0">
          <div className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-bold text-lg mr-auto">Reviews</h2>
              {reviewRondes.map((x) => (
                <button
                  key={x.nr}
                  onClick={() => setRonde(x.nr)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${toonRonde === x.nr ? "bg-ink text-white border-ink" : "border-ink/15 bg-white"}`}
                >
                  Ronde {x.nr}
                </button>
              ))}
            </div>
            {r ? (
              <Ronde ronde={r} keten={k!} busy={busy} onOverride={(punt, override) => void post(`/api/runs/${id}/keten/baas`, { punt, override })} />
            ) : (
              <p className="text-sm text-ink/60">{bezig ? "De eerste reviews komen zo binnen." : "Nog geen reviews."}</p>
            )}
          </div>

          <div className="card p-5 space-y-3 no-print">
            <h2 className="font-display font-bold text-lg">Jouw punt</h2>
            <p className="text-sm text-ink/60">Wat moet er volgens jou anders? De schrijver verwerkt het altijd in de volgende versie.</p>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!opmerking.trim()) return;
                void post(`/api/runs/${id}/keten/baas`, { opmerking }).then(() => setOpmerking(""));
              }}
            >
              <textarea className="field !py-2" rows={3} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} placeholder="Bijv. 'Reken ook met een scenario waarin de subsidie niet doorgaat.'" />
              <button className="btn-ghost !py-1.5" disabled={busy || !opmerking.trim()}>
                Toevoegen
              </button>
            </form>
            {k && k.baas.opmerkingen.length > 0 && (
              <ul className="text-sm space-y-1">
                {k.baas.opmerkingen.map((o) => (
                  <li key={o.id} className={o.verwerkt ? "text-ink/50" : ""}>
                    <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${o.verwerkt ? "bg-emerald-500" : "bg-coral"}`} aria-hidden />
                    {o.tekst}
                    {o.verwerkt ? " (verwerkt)" : ""}
                  </li>
                ))}
              </ul>
            )}
            {k?.status === "klaar" && (
              <button className={openBaas ? "btn-primary !py-2" : "btn-ghost !py-2"} disabled={busy} onClick={() => void post(`/api/runs/${id}/keten`, { extra: true })}>
                {busy ? <Spinner /> : openBaas ? `Verwerk jouw ${openBaas === 1 ? "punt" : `${openBaas} punten`} in een nieuwe ronde` : "Nog een ronde"}
              </button>
            )}
            {k?.status === "bezig" && openBaas > 0 && <p className="text-xs text-ink/55">Wordt meegenomen in de volgende versie.</p>}
          </div>
        </section>
      </div>

      {run.result && k?.status === "klaar" && <Vergelijk id={id} result={run.result} totalCost={run.cost_eur} onChange={() => void load()} keten />}

      <details className="card p-5">
        <summary className="cursor-pointer font-display font-bold text-lg">Tokens en kosten</summary>
        <div className="mt-4">
          <CostPanel usage={data.usage} roles={run.cast.rollen} />
        </div>
      </details>
    </div>
  );
}

function DocView({ doc }: { doc: AdviesDoc }) {
  return (
    <div className="space-y-4">
      <p className="font-display text-xl sm:text-2xl font-bold leading-snug">{doc.besluit}</p>
      <p className="text-[15px] leading-relaxed">{doc.samenvatting}</p>
      <div>
        <h3 className="font-semibold mb-1.5">Opties</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {doc.opties.map((o, i) => (
            <div key={i} className="rounded-xl border border-ink/10 p-3 text-sm">
              <p className="font-semibold">{o.optie}</p>
              <p className="text-ink/70 mt-1">
                <span className="text-emerald-700">+</span> {o.voor}
              </p>
              <p className="text-ink/70">
                <span className="text-coral">−</span> {o.tegen}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-1.5">Onderbouwing</h3>
        <div className="text-[15px] leading-relaxed space-y-2">
          {doc.analyse
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-1.5">Stappen</h3>
        <ol className="space-y-2 text-sm list-decimal pl-5">
          {doc.stappen.map((s, i) => (
            <li key={i}>
              <span className="font-semibold">{s.stap}</span> <span className="text-ink/70">— {s.waarom}</span>
              <span className="block text-xs text-ink/55 mt-0.5">
                Eerste actie: {s.eersteActie} · {s.eigenaar} · {s.termijn}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="font-semibold mb-1.5">Aannames om te checken</h3>
        <ul className="space-y-1.5 text-sm">
          {doc.aannames.map((a, i) => (
            <li key={i}>
              {a.aanname}
              <span className="block text-xs text-ink/55">
                Risico: {a.risico} · Test: {a.hoeTesten}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Ronde({ ronde, keten, busy, onOverride }: { ronde: KetenRonde; keten: Keten; busy: boolean; onOverride: (punt: string, override: "over" | "niet" | null) => void }) {
  // Alleen in de laatste beoordeelde ronde kun je nog een oordeel omdraaien (voor de volgende versie).
  const laatste = keten.rondes.filter((r) => r.oordelen.length).at(-1)?.nr === ronde.nr;
  return (
    <div className="space-y-4">
      {ronde.reviews.map((rv) => (
        <ReviewBlok key={rv.van} rv={rv} ronde={ronde} keten={keten} kanOmdraaien={laatste} busy={busy} onOverride={onOverride} />
      ))}
      {!ronde.oordelen.length && keten.status === "bezig" && <p className="text-xs text-ink/55">De schrijver beoordeelt deze punten nu…</p>}
    </div>
  );
}

function ReviewBlok({
  rv,
  ronde,
  keten,
  kanOmdraaien,
  busy,
  onOverride,
}: {
  rv: Review;
  ronde: KetenRonde;
  keten: Keten;
  kanOmdraaien: boolean;
  busy: boolean;
  onOverride: (punt: string, override: "over" | "niet" | null) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold flex flex-wrap items-center gap-2">
        {rv.soort === "kruis" ? "Tegenlezer" : rv.naam}
        <span className="font-normal text-ink/60">{rv.functie}</span>
        <span className="text-[10px] rounded-full bg-ink/5 px-1.5 py-px font-medium">{rv.ai}</span>
      </p>
      {rv.punten.length === 0 ? (
        <p className="text-sm text-ink/55 mt-1">Geen punten: vanuit deze blik is het advies goed.</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {rv.punten.map((p) => {
            const o = ronde.oordelen.find((x) => x.id === p.id);
            const ov = keten.baas.overrides[p.id];
            return (
              <li key={p.id} className="rounded-xl border border-ink/10 p-3 text-sm">
                <p>
                  <span className={`mr-1.5 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${ZWAARTE[p.zwaarte]}`}>{p.zwaarte}</span>
                  {p.punt}
                </p>
                <p className="text-xs text-ink/60 mt-1">Voorstel: {p.voorstel}</p>
                {o && (
                  <p className="text-xs mt-1.5">
                    <span className={`inline-flex items-center gap-1.5 font-semibold ${OORDEEL[o.oordeel].klas}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${OORDEEL[o.oordeel].dot}`} aria-hidden />
                      {OORDEEL[o.oordeel].tekst}
                    </span> <span className="text-ink/60">— {o.reden}</span>
                  </p>
                )}
                {!o && p.zwaarte === "laag" && ronde.oordelen.length > 0 && <p className="text-xs mt-1.5 text-ink/45">Klein punt, niet aan de schrijver voorgelegd.</p>}
                {o && kanOmdraaien && (
                  <p className="no-print text-xs mt-1.5 flex flex-wrap items-center gap-2">
                    {ov ? (
                      <>
                        <span className="font-semibold">Jij: {ov === "over" ? "toch overnemen" : "toch niet"}</span>
                        <button className="underline text-ink/60" disabled={busy} onClick={() => onOverride(p.id, null)}>
                          ongedaan maken
                        </button>
                      </>
                    ) : o.oordeel === "over" ? (
                      <button className="underline text-ink/60" disabled={busy} onClick={() => onOverride(p.id, "niet")}>
                        Toch niet overnemen
                      </button>
                    ) : (
                      <button className="underline text-ink/60" disabled={busy} onClick={() => onOverride(p.id, "over")}>
                        Toch overnemen
                      </button>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Slot({ keten }: { keten: Keten }) {
  const s = keten.slot!;
  const kleur = s.vertrouwen === "hoog" ? "bg-mint" : s.vertrouwen === "midden" ? "bg-sun" : "bg-peach";
  return (
    <section className="card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display font-bold text-lg mr-auto">Slotcheck van de voorzitter</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${kleur}`}>Vertrouwen: {s.vertrouwen}</span>
      </div>
      <p className="text-[15px] leading-relaxed">{s.oordeel}</p>
      <p className="text-sm text-ink/60">{s.waaromVertrouwen}</p>
      {s.laatsteAanvullingen.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">Nog om aan te denken</p>
          <ul className="list-disc pl-5">
            {s.laatsteAanvullingen.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {s.nietOvergenomen.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Bewust niet overgenomen ({s.nietOvergenomen.length})</summary>
          <ul className="mt-1 space-y-1">
            {s.nietOvergenomen.map((x, i) => (
              <li key={i}>
                {x.punt} <span className="text-ink/55">— {x.van}: {x.reden}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.besteInzicht?.tekst && (
        <p className="text-sm rounded-xl bg-lilac/70 px-3 py-2">
          <b>Beste inzicht uit de reviews:</b> &ldquo;{s.besteInzicht.tekst}&rdquo; <span className="text-ink/60">— {s.besteInzicht.van}</span>
        </p>
      )}
    </section>
  );
}
