"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Segmented, Spinner, toError } from "./ui";

type Voice = { id: string; naam: string; omschrijving: string; nl: boolean; vlaams?: boolean; eigen: boolean; gender: string | null; preview: string | null };
type Uitspraak = "nederlands" | "snel";

/** Kies welke ElevenLabs-stemmen de Debatarena gebruikt. */
export function VoicePicker() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string; oplossing?: string } | null>(null);
  const [filter, setFilter] = useState<"alle" | "nl">("nl");
  const [uitspraak, setUitspraak] = useState<Uitspraak>("nederlands");
  const audio = useRef<HTMLAudioElement | null>(null);

  async function load(fresh = false) {
    try {
      const d = await api<{ voices: Voice[]; inUse: string[]; eigenKeuze: boolean; uitspraak?: Uitspraak }>(`/api/voices${fresh ? "?vernieuw=1" : ""}`);
      setVoices(d.voices);
      if (d.uitspraak) setUitspraak(d.uitspraak);
      setChosen(new Set(d.inUse));
      setOwn(d.eigenKeuze);
      if (!d.voices.some((v) => v.nl)) setFilter("alle");
    } catch (e) {
      setError(toError(e));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data ophalen; state wordt pas na de fetch gezet
    void load();
  }, []);

  async function save(ids: string[]) {
    setBusy(true);
    setSaved(false);
    try {
      const d = await api<{ inUse: string[] }>("/api/voices", { method: "POST", json: { ids } });
      setChosen(new Set(d.inUse));
      setOwn(ids.length > 0);
      setSaved(true);
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveUitspraak(v: Uitspraak) {
    setUitspraak(v);
    try {
      await api("/api/voices", { method: "POST", json: { uitspraak: v } });
    } catch (e) {
      setError(toError(e));
    }
  }

  function play(url: string | null) {
    audio.current?.pause();
    if (!url) return;
    audio.current = new Audio(url);
    void audio.current.play().catch(() => {});
  }

  if (!voices) return error ? <ErrorNote error={error} /> : <Spinner />;
  if (!voices.length) return <p className="text-sm text-ink/60">Voeg eerst een ElevenLabs-sleutel toe; dan verschijnen je stemmen hier.</p>;

  const nlCount = voices.filter((v) => v.nl).length;
  const shown = filter === "nl" ? voices.filter((v) => v.nl) : voices;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-ink/15 bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="font-semibold">Uitspraak</span>
        <Segmented
          label="Uitspraak"
          value={uitspraak}
          onChange={(v) => void saveUitspraak(v)}
          options={[
            { value: "nederlands", label: "🇳🇱 Beste Nederlands" },
            { value: "snel", label: "⚡ Snelst" },
          ]}
        />
        <span className="basis-full text-xs text-ink/55">
          Het snelle model klinkt soms Vlaams. &lsquo;Beste Nederlands&rsquo; houdt het Nederlandse accent beter vast (iets trager, ongeveer twee keer zo duur per zin).
        </span>
      </div>
      <p className="text-sm text-ink/70">
        {own
          ? "Je hebt zelf gekozen welke stemmen meedoen."
          : nlCount
            ? `Automatisch: de ${nlCount} Nederlandse stemmen uit je bibliotheek worden gebruikt.`
            : "We vonden geen stemmen met een Nederlands label. Kies hieronder zelf welke stemmen meedoen."}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setFilter("nl")} className={`rounded-full border-2 px-3 py-1 ${filter === "nl" ? "bg-ink text-cream border-ink" : "border-ink/30"}`}>
          🇳🇱 Nederlands ({nlCount})
        </button>
        <button onClick={() => setFilter("alle")} className={`rounded-full border-2 px-3 py-1 ${filter === "alle" ? "bg-ink text-cream border-ink" : "border-ink/30"}`}>
          Alle ({voices.length})
        </button>
        <button onClick={() => void load(true)} className="underline ml-auto">
          Lijst vernieuwen
        </button>
      </div>
      <ul className="max-h-80 overflow-y-auto rounded-2xl border-2 border-ink/15 divide-y divide-ink/10">
        {shown.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <input
              type="checkbox"
              aria-label={`Gebruik ${v.naam}`}
              checked={chosen.has(v.id)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(v.id);
                else next.delete(v.id);
                setChosen(next);
                setSaved(false);
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">
                {v.nl && "🇳🇱 "}
                {v.vlaams && "🇧🇪 "}
                {v.naam}
              </span>
              {v.vlaams && <span className="ml-1.5 text-[11px] rounded-full bg-peach px-1.5 py-0.5">Vlaams, doet niet mee</span>}
              <span className="block text-xs text-ink/55 truncate">{v.omschrijving || (v.eigen ? "Eigen stem" : "Standaardstem")}</span>
            </span>
            {v.preview && (
              <button onClick={() => play(v.preview)} className="text-xs underline shrink-0">
                ▶ Luister
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={error} onClose={() => setError(null)} />
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn-primary !py-2" disabled={busy || !chosen.size} onClick={() => void save([...chosen])}>
          {busy ? <Spinner /> : `Gebruik deze ${chosen.size} stemmen`}
        </button>
        {own && (
          <button className="btn-ghost !py-2" disabled={busy} onClick={() => void save([])}>
            Terug naar automatisch
          </button>
        )}
        {saved && <span className="text-sm">Opgeslagen ✓ Geldt voor nieuwe debatten.</span>}
      </div>
    </div>
  );
}
