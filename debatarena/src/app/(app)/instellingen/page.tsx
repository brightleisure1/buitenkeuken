"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, toError } from "@/components/ui";

type Key = "anthropic" | "openai" | "google" | "xai" | "elevenlabs";
type Info = { keys: Record<Key, string | null>; models: { key: string; label: string; provider: string; model: string }[] };

const PROVIDERS: { key: Key; name: string; waarvoor: string; waar: string }[] = [
  { key: "anthropic", name: "Anthropic (Claude)", waarvoor: "Rollen die met Claude praten, het samenstellen van het team en de Jury.", waar: "console.anthropic.com → API Keys" },
  { key: "openai", name: "OpenAI (GPT)", waarvoor: "Rollen die met GPT praten, de portretten en inspreken als je browser dat niet zelf kan.", waar: "platform.openai.com → API keys" },
  { key: "google", name: "Google (Gemini)", waarvoor: "Rollen die met Gemini praten. Optioneel.", waar: "aistudio.google.com → Get API key" },
  { key: "xai", name: "xAI (Grok)", waarvoor: "Rollen die met Grok praten, ook ongezouten als je dat aanzet. Optioneel.", waar: "console.x.ai → API Keys" },
  { key: "elevenlabs", name: "ElevenLabs", waarvoor: "Stemmen: de rollen praten hardop. Optioneel.", waar: "elevenlabs.io → Profiel → API Keys" },
];

export default function SettingsPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<{ message: string; oplossing?: string } | null>(null);

  useEffect(() => {
    api<Info>("/api/settings").then(setInfo).catch((e) => setError(toError(e)));
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Instellingen</h1>
        <p className="text-ink/70 mt-1">Je sleutels worden versleuteld opgeslagen en alleen op de server gebruikt.</p>
      </div>
      <ErrorNote error={error} />
      {!info && !error && <Spinner className="h-6 w-6" />}
      {info &&
        PROVIDERS.map((p) => (
          <KeyCard key={p.key} p={p} current={info.keys[p.key]} onSaved={(keys) => setInfo({ ...info, keys })} />
        ))}

      {info && (
        <section className="card p-5">
          <h2 className="font-display font-extrabold text-lg">Modellen</h2>
          <p className="text-sm text-ink/70 mt-1">
            Modellen en prijzen staan in één bestand: <code>src/lib/config.ts</code>. Een eigen modelnaam kies je per rol onder Geavanceerd.
          </p>
          <ul className="mt-3 text-sm space-y-1">
            {info.models.map((m) => (
              <li key={m.key} className="flex gap-2">
                <span className="font-semibold">{m.label}</span>
                <span className="text-ink/50">{m.model}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        className="btn-ghost"
        onClick={async () => {
          await fetch("/api/logout", { method: "POST" });
          window.location.href = "/login";
        }}
      >
        Uitloggen
      </button>
    </div>
  );
}

function KeyCard({
  p,
  current,
  onSaved,
}: {
  p: (typeof PROVIDERS)[number];
  current: string | null;
  onSaved: (keys: Record<Key, string | null>) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string; oplossing?: string } | null>(null);

  async function save() {
    setBusy("save");
    setStatus(null);
    try {
      const d = await api<{ keys: Record<Key, string | null> }>("/api/settings", { method: "POST", json: { [p.key]: value } });
      onSaved(d.keys);
      setValue("");
      await test(true);
    } catch (e) {
      const err = toError(e);
      setStatus({ ok: false, text: err.message, oplossing: err.oplossing });
    } finally {
      setBusy(null);
    }
  }

  async function test(afterSave = false) {
    if (!afterSave) setBusy("test");
    try {
      const d = await api<{ ok: boolean; melding?: string; error?: string; oplossing?: string }>("/api/settings/test", {
        method: "POST",
        json: { provider: p.key, key: afterSave ? undefined : value || undefined },
      });
      setStatus(d.ok ? { ok: true, text: d.melding ?? "Verbonden." } : { ok: false, text: d.error ?? "Dat lukte niet.", oplossing: d.oplossing });
    } catch (e) {
      const err = toError(e);
      setStatus({ ok: false, text: err.message, oplossing: err.oplossing });
    } finally {
      if (!afterSave) setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`De sleutel voor ${p.name} verwijderen?`)) return;
    setBusy("remove");
    try {
      const d = await api<{ keys: Record<Key, string | null> }>("/api/settings", { method: "POST", json: { [p.key]: null } });
      onSaved(d.keys);
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="font-display font-extrabold text-lg">{p.name}</h2>
          <p className="text-sm text-ink/70">{p.waarvoor}</p>
          <p className="text-xs text-ink/50 mt-0.5">Te vinden op: {p.waar}</p>
        </div>
        <span className={`text-xs rounded-full px-2 py-1 border ${current ? "bg-mint border-ink/30" : "bg-cream border-ink/20"}`}>
          {current ? `Ingesteld: ${current}` : "Nog niet ingesteld"}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          autoComplete="off"
          className="field !py-2"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={current ? "Plak een nieuwe sleutel om te vervangen" : "Plak hier je sleutel"}
        />
        <div className="flex gap-2 shrink-0">
          <button className="btn-primary !py-2" disabled={!value.trim() || !!busy} onClick={save}>
            {busy === "save" ? <Spinner /> : "Opslaan"}
          </button>
          <button className="btn-ghost !py-2" disabled={(!value.trim() && !current) || !!busy} onClick={() => test()}>
            {busy === "test" ? <Spinner /> : "Test verbinding"}
          </button>
        </div>
      </div>
      {status &&
        (status.ok ? (
          <p className="text-sm rounded-xl bg-mint px-3 py-2">✓ {status.text}</p>
        ) : (
          <ErrorNote error={{ message: status.text, oplossing: status.oplossing }} />
        ))}
      {current && (
        <button className="text-xs text-coral underline" onClick={remove} disabled={!!busy}>
          Sleutel verwijderen
        </button>
      )}
    </section>
  );
}
