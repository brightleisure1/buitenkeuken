"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { CLICHES } from "@/lib/cliches";
import { providerOf, resolveModel, supportsWebSearch } from "@/lib/config";
import type { Cast, Role, RolePrep } from "@/lib/types";
import { AiBadge, CensorToggle, ErrorNote, Portrait, Spinner, toError } from "./ui";

type Voice = { id: string; naam: string; omschrijving: string; nl?: boolean; preview?: string | null };

/** Alles van één persona aanpassen, in één scherm. */
export function PersonaEditor({
  runId,
  cast,
  role,
  prep,
  index,
  models,
  onClose,
  onSaved,
}: {
  runId: string;
  cast: Cast;
  role: Role;
  prep?: RolePrep;
  index: number;
  models: { key: string; label: string }[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [r, setR] = useState<Role>(role);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [busy, setBusy] = useState(false);
  const [redraw, setRedraw] = useState(false);
  const [error, setError] = useState<{ message: string; oplossing?: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/voices")
      .then((x) => x.json())
      .then((d) => setVoices(d.voices ?? []))
      .catch(() => {});
    return () => audio.current?.pause();
  }, []);

  const set = (patch: Partial<Role>) => setR((x) => ({ ...x, ...patch }));
  const model = resolveModel(r.modelKey, r.customModel);
  const canUncensor = !r.isJury;
  const canSearch = supportsWebSearch(model);
  const usedCliches = new Set(cast.rollen.filter((x) => x.id !== r.id).map((x) => x.cliche).filter(Boolean));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const rollen = cast.rollen.map((x) => {
        if (r.isKritisch && x.id !== r.id) return { ...x, isKritisch: false };
        return x.id === r.id ? r : x;
      });
      await api(`/api/runs/${runId}`, { method: "PATCH", json: { handmatig: true, cast: { ...cast, cliches: cast.cliches || !!r.cliche, rollen } } });
      await onSaved();
      onClose();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  async function newPortrait() {
    setRedraw(true);
    try {
      await api(`/api/runs/${runId}/portrait`, { method: "POST", json: { roleId: r.id } });
      await onSaved();
    } catch (e) {
      setError(toError(e));
    }
  }

  function play(url?: string | null) {
    audio.current?.pause();
    if (!url) return;
    audio.current = new Audio(url);
    void audio.current.play().catch(() => {});
  }

  const voice = voices.find((v) => v.id === r.stemId);

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-end sm:place-items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Persona ${role.naam} aanpassen`}
        className="bg-cream w-full sm:max-w-2xl max-h-[94dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-ink/15 p-5 sm:p-7 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4">
          <Portrait name={r.naam} portraits={prep?.portraits} index={index} size={72} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-2xl leading-tight break-words">{r.naam || "Naamloos"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <AiBadge role={r} />
              <button onClick={newPortrait} disabled={redraw} className="underline text-ink/70">
                {redraw || prep?.portraitStatus === "bezig" ? "✏️ De tekenaar is bezig…" : "🎨 Nieuw portret"}
              </button>
            </div>
          </div>
          <button onClick={onClose} aria-label="Sluiten" className="text-2xl leading-none self-start">
            ✕
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Naam" value={r.naam} onChange={(v) => set({ naam: v })} />
          <Field label="Functie" value={r.functie} onChange={(v) => set({ functie: v })} />
        </div>
        <Field label="Waar let deze persoon op? (perspectief)" value={r.perspectief} onChange={(v) => set({ perspectief: v })} multiline />
        <Field
          label="Instructie en manier van praten"
          hint="Bijv. 'Praat kortaf en droog. Wil eerst cijfers zien. Geen geduld voor vage plannen.'"
          value={r.instructie}
          onChange={(v) => set({ instructie: v })}
          multiline
          rows={4}
        />
        <Field label="Eén zin voor op de kaart" value={r.zin} onChange={(v) => set({ zin: v })} />

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-semibold">AI</span>
            <select className="field mt-1 !py-2" value={r.modelKey} onChange={(e) => set({ modelKey: e.target.value, customModel: null })}>
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Field label="Eigen modelnaam (optioneel)" value={r.customModel ?? ""} placeholder="bijv. gemini-2.5-pro" onChange={(v) => set({ customModel: v || null })} />
        </div>

        {canUncensor && (
          <div className="rounded-2xl border border-ink/15 bg-white p-3 flex flex-wrap items-center gap-3">
            <span className="font-semibold">Censuur</span>
            <CensorToggle value={!!r.ongezouten} onChange={(v) => set({ ongezouten: v })} />
            <span className="text-xs text-ink/60 basis-full">
              Ongecensureerd: brutaal, sarcastisch, vloeken mag. Sloopt argumenten, geen mensen.
              {model.provider !== "xai" ? ` ${providerOf(r).naam} blijft iets netter dan Grok.` : ""}
            </span>
          </div>
        )}

        <label className="block text-sm">
          <span className="font-semibold">Stem</span>
          <div className="mt-1 flex gap-2">
            <select className="field !py-2" value={r.stemId ?? ""} onChange={(e) => set({ stemId: e.target.value || null })} disabled={!voices.length}>
              <option value="">{voices.length ? "Geen stem" : "Voeg een ElevenLabs-sleutel toe voor stemmen"}</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nl ? "🇳🇱 " : ""}
                  {v.naam}
                  {v.omschrijving ? ` — ${v.omschrijving}` : ""}
                </option>
              ))}
            </select>
            {voice?.preview && (
              <button type="button" className="btn-ghost !px-3 !py-2 shrink-0" onClick={() => play(voice.preview)}>
                ▶
              </button>
            )}
          </div>
        </label>

        <label className="block text-sm">
          <span className="font-semibold">Vergadercliché</span>
          <select className="field mt-1 !py-2" value={r.cliche ?? ""} onChange={(e) => set({ cliche: e.target.value || null })} disabled={r.isJury}>
            <option value="">{r.isJury ? "De Jury speelt geen cliché" : "Geen"}</option>
            {CLICHES.map((c) => (
              <option key={c.id} value={c.id} disabled={usedCliches.has(c.id)}>
                {c.naam} — {c.omschrijving}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className={`flex items-center gap-2 ${canSearch ? "" : "opacity-50"}`}>
            <input type="checkbox" checked={r.webzoeken && canSearch} disabled={!canSearch} onChange={(e) => set({ webzoeken: e.target.checked })} />
            Zoekt op het web {canSearch ? "" : `(kan ${providerOf(r).naam} hier niet)`}
          </label>
          {!r.isJury && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={r.isKritisch} onChange={(e) => set({ isKritisch: e.target.checked })} />
              De kritische klant/koper
            </label>
          )}
        </div>

        <Field label="Uiterlijk voor het portret (Engels)" value={r.uiterlijk} onChange={(v) => set({ uiterlijk: v })} multiline />

        <ErrorNote error={error} onClose={() => setError(null)} />
        <div className="flex justify-end gap-2 sticky bottom-0 bg-cream pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Annuleren
          </button>
          <button className="btn-primary" disabled={busy || !r.naam.trim()} onClick={save}>
            {busy ? <Spinner /> : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  rows = 2,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-semibold">{label}</span>
      {multiline ? (
        <textarea className="field mt-1 !py-2" rows={rows} value={value} placeholder={hint ?? placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="field mt-1 !py-2" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
