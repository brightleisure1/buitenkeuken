"use client";

import { useCallback, useEffect, useState } from "react";
import { api, datum, euro } from "@/lib/client";
import { KEY_INFO, detectProvider, keyWarning, type KeyProvider, type KeyStatus } from "@/lib/keys";
import { tokens } from "@/lib/usage";
import { ErrorNote, Spinner, toError } from "@/components/ui";
import { VoicePicker } from "@/components/VoicePicker";

type Info = {
  keys: Record<KeyProvider, string | null>;
  status: Partial<Record<KeyProvider, KeyStatus>>;
  usage: Record<string, { tokens: number; costEur: number; calls: number }>;
  models: { key: string; label: string; provider: string; model: string; gevraagd: string }[];
};
type Err = { message: string; oplossing?: string } | null;

const ORDER: KeyProvider[] = ["anthropic", "openai", "google", "xai", "elevenlabs"];

export default function SettingsPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<Err>(null);
  const [testing, setTesting] = useState<Partial<Record<KeyProvider, boolean>>>({});

  const load = useCallback(async () => {
    const d = await api<Info>("/api/settings");
    setInfo(d);
    window.dispatchEvent(new Event("sleutels-gewijzigd"));
    return d;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data ophalen; state wordt pas na de fetch gezet
    load().catch((e) => setError(toError(e)));
  }, [load]);

  const test = useCallback(
    async (p: KeyProvider) => {
      setTesting((t) => ({ ...t, [p]: true }));
      try {
        await api("/api/settings/test", { method: "POST", json: { provider: p } });
        await load();
      } catch (e) {
        setError(toError(e));
      } finally {
        setTesting((t) => ({ ...t, [p]: false }));
      }
    },
    [load],
  );

  async function testAll() {
    if (!info) return;
    await Promise.all(ORDER.filter((p) => info.keys[p]).map((p) => test(p)));
  }

  const aiCount = info ? ORDER.filter((p) => KEY_INFO[p].ai && info.keys[p]).length : 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h1 className="font-display text-3xl font-extrabold">Instellingen</h1>
          <p className="text-ink/70 mt-1">Je sleutels worden versleuteld opgeslagen en alleen op de server gebruikt.</p>
        </div>
        {info && ORDER.some((p) => info.keys[p]) && (
          <button className="btn-ghost !py-2" onClick={testAll} disabled={Object.values(testing).some(Boolean)}>
            {Object.values(testing).some(Boolean) ? <Spinner /> : "Test alle verbindingen"}
          </button>
        )}
      </div>

      <ErrorNote error={error} onClose={() => setError(null)} />
      {!info && !error && <Spinner className="h-6 w-6" />}

      {info && (
        <>
          {aiCount === 0 && (
            <div className="rounded-2xl border-2 border-coral bg-[#FFF1EC] p-4 text-sm">
              <p className="font-semibold">Nog geen AI-sleutel ingesteld.</p>
              <p className="text-ink/75">Plak hieronder een sleutel van Anthropic, OpenAI, Google of xAI. Eén is genoeg om te beginnen.</p>
            </div>
          )}

          <QuickPaste
            onSaved={async (d) => {
              setInfo(d);
              await test(d.detected);
            }}
          />

          <section className="card overflow-hidden">
            <div className="px-5 pt-5 pb-2 flex items-baseline">
              <h2 className="font-display font-extrabold text-lg flex-1">Je sleutels</h2>
              <span className="text-xs text-ink/50">Verbruik: laatste 30 dagen</span>
            </div>
            <ul>
              {ORDER.map((p) => (
                <KeyRow
                  key={p}
                  provider={p}
                  info={info}
                  testing={!!testing[p]}
                  onTest={() => test(p)}
                  onChanged={(i) => {
                    setInfo(i);
                    window.dispatchEvent(new Event("sleutels-gewijzigd"));
                  }}
                  onError={setError}
                />
              ))}
            </ul>
          </section>

          {info.keys.elevenlabs && (
            <section className="card p-5 space-y-2">
              <h2 className="font-display font-extrabold text-lg">Stemmen</h2>
              <VoicePicker />
            </section>
          )}

          <section className="card p-5">
            <h2 className="font-display font-extrabold text-lg">Modellen</h2>
            <p className="text-sm text-ink/70 mt-1">
              Werkt een model niet, dan neemt automatisch een ander het over. Welke modellen je sleutel mag gebruiken, halen we zelf op. Prijzen staan in <code>src/lib/config.ts</code>; een eigen modelnaam kies je per rol onder Geavanceerd.
            </p>
            <ul className="mt-3 text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {info.models.map((m) => (
                <li key={m.key} className={`flex gap-2 ${info.keys[m.provider as KeyProvider] ? "" : "opacity-45"}`}>
                  <span className="font-semibold">{m.label}</span>
                  <span className="text-ink/50 break-all">
                    {m.model}
                    {m.model !== m.gevraagd && <span title={`${m.gevraagd} bestaat niet bij jouw sleutel`}> (automatisch gekozen)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <button
        className="btn-ghost"
        onClick={async () => {
          await fetch("/api/logout", { method: "POST" });
          window.location.assign("/login");
        }}
      >
        Uitloggen
      </button>
    </div>
  );
}

/** Eén vak: plak een sleutel, wij herkennen van wie hij is. */
function QuickPaste({ onSaved }: { onSaved: (d: Info & { detected: KeyProvider }) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [show, setShow] = useState(false);
  const detected = value.trim() ? detectProvider(value) : null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const d = await api<Info & { detected: KeyProvider }>("/api/settings", { method: "POST", json: { auto: value } });
      setValue("");
      onSaved(d);
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 space-y-3 bg-sun">
      <div>
        <h2 className="font-display font-extrabold text-lg">Sleutel toevoegen</h2>
        <p className="text-sm text-ink/70">Plak een sleutel van welke aanbieder dan ook. Wij herkennen zelf van wie hij is en testen hem meteen.</p>
      </div>
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (detected) void save();
        }}
      >
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            className="field !py-2.5 pr-20"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Plak hier je API-sleutel"
            aria-label="API-sleutel"
          />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs underline">
            {show ? "Verberg" : "Toon"}
          </button>
        </div>
        <button className="btn-primary !py-2.5 shrink-0" disabled={!detected || busy}>
          {busy ? <Spinner /> : detected ? `Opslaan als ${KEY_INFO[detected].naam.split(" ")[0]}` : "Opslaan"}
        </button>
      </form>
      {value.trim() && (
        <p className="text-sm">
          {detected ? (
            <>
              Herkend: <strong>{KEY_INFO[detected].naam}</strong>
            </>
          ) : (
            <span className="text-coral">We herkennen deze sleutel niet. Plak hem in het juiste vak hieronder, bij &ldquo;Vervangen&rdquo;.</span>
          )}
        </p>
      )}
      <ErrorNote error={error} onClose={() => setError(null)} />
    </section>
  );
}

function KeyRow({
  provider,
  info,
  testing,
  onTest,
  onChanged,
  onError,
}: {
  provider: KeyProvider;
  info: Info;
  testing: boolean;
  onTest: () => void;
  onChanged: (i: Info) => void;
  onError: (e: Err) => void;
}) {
  const meta = KEY_INFO[provider];
  const masked = info.keys[provider];
  const status = info.status[provider];
  const usage = info.usage[provider];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const dot = !masked ? "bg-ink/20" : !status ? "bg-sun border border-ink/30" : status.ok ? "bg-[#2FB344]" : "bg-coral";
  const state = !masked ? "Niet ingesteld" : !status ? "Nog niet getest" : status.ok ? "Verbonden" : "Werkt niet";

  async function save() {
    setBusy(true);
    try {
      const d = await api<Info>("/api/settings", { method: "POST", json: { [provider]: value } });
      onChanged(d);
      setEditing(false);
      setValue("");
      onTest();
    } catch (e) {
      onError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`De sleutel van ${meta.naam} verwijderen?`)) return;
    try {
      onChanged(await api<Info>("/api/settings", { method: "POST", json: { [provider]: null } }));
    } catch (e) {
      onError(toError(e));
    }
  }

  return (
    <li className="border-t-2 border-ink/10 px-5 py-4 space-y-2" data-provider={provider}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`h-3 w-3 rounded-full shrink-0 ${dot}`} aria-hidden />
        <span className="font-semibold">{meta.naam}</span>
        <span className="text-xs rounded-full bg-cream border border-ink/15 px-2 py-0.5" data-testid={`status-${provider}`}>
          {state}
        </span>
        {masked && <code className="text-xs text-ink/60">{masked}</code>}
        <span className="ml-auto flex gap-3 text-sm">
          {masked && (
            <button onClick={onTest} disabled={testing} className="underline">
              {testing ? <Spinner /> : "Test"}
            </button>
          )}
          <button onClick={() => setEditing((e) => !e)} className="underline">
            {masked ? "Vervangen" : "Toevoegen"}
          </button>
          {masked && (
            <button onClick={remove} className="underline text-coral">
              Verwijderen
            </button>
          )}
        </span>
      </div>
      <p className="text-sm text-ink/65">
        {meta.waarvoor}{" "}
        <a href={meta.url} target="_blank" rel="noreferrer" className="underline">
          Sleutel halen
        </a>
      </p>
      {status && (
        <p className={`text-xs ${status.ok ? "text-ink/55" : "text-coral"}`}>
          {status.melding} · getest {datum(status.at)}
        </p>
      )}
      {usage && (
        <p className="text-xs text-ink/55">
          Verbruik: {tokens(usage.tokens)} tokens · {euro(usage.costEur)} · {usage.calls} aanroepen
        </p>
      )}
      {editing && (
        <form
          className="flex flex-col sm:flex-row gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            autoFocus
            className="field !py-2"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Plak je sleutel van ${meta.naam.split(" ")[0]}`}
          />
          <button className="btn-primary !py-2 shrink-0" disabled={!value.trim() || busy}>
            {busy ? <Spinner /> : "Opslaan en testen"}
          </button>
        </form>
      )}
      {editing && keyWarning(provider, value) && (
        <p className="text-sm text-coral" role="alert">
          ⚠️ {keyWarning(provider, value)}
        </p>
      )}
    </li>
  );
}
