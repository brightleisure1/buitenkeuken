"use client";

import { useEffect, useState } from "react";
import { resolveModel, supportsWebSearch } from "@/lib/config";
import { CLICHES } from "@/lib/cliches";
import type { Cast, Role } from "@/lib/types";
import { CensorToggle, Switch } from "./ui";

interface Voice {
  id: string;
  naam: string;
  omschrijving: string;
  nl?: boolean;
}

/** Handmatige instellingen, alleen onder "Geavanceerd". */
export function CastEditor({
  cast,
  models,
  attachments,
  onSave,
  saving,
}: {
  cast: Cast;
  models: { key: string; label: string }[];
  attachments: { id: string; name: string }[];
  onSave: (c: Cast) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Cast>(cast);
  const [voices, setVoices] = useState<Voice[]>([]);
  useEffect(() => {
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d) => setVoices(d.voices ?? []))
      .catch(() => {});
  }, []);

  const setRole = (id: string, patch: Partial<Role>) =>
    setDraft((d) => ({ ...d, rollen: d.rollen.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeRole = (id: string) => setDraft((d) => ({ ...d, rollen: d.rollen.filter((r) => r.id !== id) }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(cast);

  return (
    <div className="card p-5 space-y-5 bg-white">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-semibold">Aantal rondes</span>
          <input
            type="number"
            min={1}
            max={6}
            value={draft.rondes}
            onChange={(e) => setDraft({ ...draft, rondes: Number(e.target.value) })}
            className="field mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Stemmen</span>
          <select
            value={draft.stemmen}
            onChange={(e) => setDraft({ ...draft, stemmen: e.target.value as Cast["stemmen"] })}
            className="field mt-1"
            disabled={!voices.length}
          >
            <option value="uit">Uit</option>
            <option value="jury">Alleen de voorzitter</option>
            <option value="iedereen">Iedereen (beurten max. 80 woorden)</option>
          </select>
          {!voices.length && <span className="text-xs text-ink/60">Voeg een ElevenLabs-sleutel toe bij Instellingen om stemmen te gebruiken.</span>}
        </label>
      </div>

      <Switch checked={!!draft.cliches} onChange={(v) => setDraft({ ...draft, cliches: v, rollen: v ? draft.rollen : draft.rollen.map((r) => ({ ...r, cliche: null })) })}>
        <strong>🎭 Vergaderclichés</strong> <span className="text-ink/60">– kies hieronder per rol welk type hij speelt</span>
      </Switch>

      {attachments.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-1">Wie leest welke bijlage?</p>
          <div className="space-y-2">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{a.name}</span>
                <select
                  className="field !py-1.5 !w-auto"
                  value={draft.bijlages[a.id] ?? "iedereen"}
                  onChange={(e) => setDraft({ ...draft, bijlages: { ...draft.bijlages, [a.id]: e.target.value } })}
                >
                  <option value="iedereen">Iedereen</option>
                  {draft.rollen.map((r) => (
                    <option key={r.id} value={r.id}>
                      Alleen {r.naam}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {draft.rollen.map((r) => (
          <fieldset key={r.id} className="rounded-2xl border border-ink/15 p-4 space-y-3">
            <div className="flex gap-2 items-center">
              <input className="field !py-2 font-semibold" value={r.naam} onChange={(e) => setRole(r.id, { naam: e.target.value })} />
              {!r.isJury && (
                <button type="button" onClick={() => removeRole(r.id)} className="text-sm text-coral underline shrink-0">
                  Verwijder
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Functie" value={r.functie} onChange={(v) => setRole(r.id, { functie: v })} />
              <Field label="Perspectief" value={r.perspectief} onChange={(v) => setRole(r.id, { perspectief: v })} />
            </div>
            <Field label="Instructie" value={r.instructie} onChange={(v) => setRole(r.id, { instructie: v })} multiline />
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="font-semibold">Model</span>
                <select className="field mt-1 !py-2" value={r.modelKey} onChange={(e) => setRole(r.id, { modelKey: e.target.value })}>
                  {models.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Eigen modelnaam (optioneel)"
                value={r.customModel ?? ""}
                placeholder="bijv. claude-opus-5"
                onChange={(v) => setRole(r.id, { customModel: v })}
              />
              <label className="block text-sm">
                <span className="font-semibold">Stem</span>
                <select
                  className="field mt-1 !py-2"
                  value={r.stemId ?? ""}
                  onChange={(e) => setRole(r.id, { stemId: e.target.value || null })}
                  disabled={!voices.length}
                >
                  <option value="">Geen</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nl ? "🇳🇱 " : ""}
                      {v.naam}
                      {v.omschrijving ? ` — ${v.omschrijving}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className={`flex items-center gap-2 ${supportsWebSearch(resolveModel(r.modelKey, r.customModel)) ? "" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  checked={r.webzoeken}
                  disabled={!supportsWebSearch(resolveModel(r.modelKey, r.customModel))}
                  onChange={(e) => setRole(r.id, { webzoeken: e.target.checked })}
                />
                Webzoeken
                {!supportsWebSearch(resolveModel(r.modelKey, r.customModel)) && <span className="text-xs">(kan dit model niet)</span>}
              </label>
              {!r.isJury && (
                <span className="flex items-center gap-2">
                  Censuur: <CensorToggle size="xs" value={!!r.ongezouten} onChange={(v) => setRole(r.id, { ongezouten: v })} />
                </span>
              )}
              {!r.isJury && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.isKritisch}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        rollen: d.rollen.map((x) => ({ ...x, isKritisch: x.id === r.id ? e.target.checked : e.target.checked ? false : x.isKritisch })),
                      }))
                    }
                  />
                  Kritische klant/koper
                </label>
              )}
            </div>
            {draft.cliches && !r.isJury && (
              <label className="block text-sm">
                <span className="font-semibold">Vergadercliché</span>
                <select className="field mt-1 !py-2" value={r.cliche ?? ""} onChange={(e) => setRole(r.id, { cliche: e.target.value || null })}>
                  <option value="">Geen</option>
                  {CLICHES.map((c) => (
                    <option key={c.id} value={c.id} disabled={draft.rollen.some((x) => x.id !== r.id && x.cliche === c.id)}>
                      {c.naam} — {c.omschrijving}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Field label="Uiterlijk voor het portret (Engels)" value={r.uiterlijk} onChange={(v) => setRole(r.id, { uiterlijk: v })} />
          </fieldset>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" disabled={!dirty} onClick={() => setDraft(cast)}>
          Herstel
        </button>
        <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => onSave(draft)}>
          {saving ? "Opslaan…" : "Wijzigingen opslaan"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-semibold">{label}</span>
      {multiline ? (
        <textarea className="field mt-1 !py-2" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="field mt-1 !py-2" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
