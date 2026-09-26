"use client";

import { useState } from "react";
import { api, euro } from "@/lib/client";
import { aiNaam, ketenKosten, ketenModellen } from "@/lib/keten-info";
import { NIVEAUS, niveauOf, type Niveau } from "@/lib/niveau";
import type { RunPayload } from "@/lib/payload";
import type { Cast } from "@/lib/types";
import { MicButton } from "./MicButton";
import { PersonaEditor } from "./PersonaEditor";
import { AiBadge, ErrorNote, Segmented, Spinner, toError } from "./ui";

type Err = { message: string; oplossing?: string } | null;

/** Het voorstel voor een review-keten: wie leest mee, wat staat vast, hoeveel rondes. */
export function KetenVoorstel({
  data,
  reload,
  onStart,
  onReset,
  starting,
}: {
  data: RunPayload;
  reload: () => Promise<unknown>;
  onStart: () => void;
  onReset: () => void;
  starting: boolean;
}) {
  const { run } = data;
  const cast = run.cast;
  const [error, setError] = useState<Err>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [antwoord, setAntwoord] = useState<string | null>(null);
  const [rv, setRv] = useState((cast.randvoorwaarden ?? []).join("\n"));
  const [intake, setIntake] = useState(cast.intake ?? []);
  const { auteur, kruis } = ketenModellen(data.keys);
  const reviewers = cast.rollen.filter((r) => !r.isJury);
  const voorzitter = cast.rollen.find((r) => r.isJury);

  async function save(next: Cast) {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: next } });
      await reload();
    } catch (e) {
      setError(toError(e));
    } finally {
      setSaving(false);
    }
  }

  async function sendChat(text: string) {
    const t = text.trim();
    if (!t) return;
    setChat("");
    setChatBusy(true);
    setError(null);
    try {
      const d = await api<{ antwoord: string }>(`/api/runs/${run.id}/chat`, { method: "POST", json: { text: t, chat: [] } });
      setAntwoord(d.antwoord);
      await reload();
    } catch (e) {
      setError(toError(e));
    } finally {
      setChatBusy(false);
    }
  }

  const editRole = cast.rollen.find((r) => r.id === editing);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 space-y-6">
      <div>
        <button onClick={onReset} className="text-sm text-ink/60 hover:text-ink">
          ← Ander vraagstuk
        </button>
        <h1 className="font-display text-3xl sm:text-4xl font-bold mt-2">{cast.titel || run.title}</h1>
        <p className="text-ink/70 mt-1">{run.question}</p>
      </div>

      <section className="card p-5 space-y-2">
        <h2 className="font-display font-bold text-lg">Zo werkt het</h2>
        <ol className="text-sm text-ink/75 space-y-1 list-decimal pl-5">
          <li>
            <b>{aiNaam(auteur)}</b> schrijft versie 1 van het advies (dat is wat je krijgt als je het één keer aan het slimste model vraagt).
          </li>
          <li>
            {reviewers.length} rollen lezen het vanuit hun eigen belang{kruis ? (
              <>
                , en <b>{aiNaam(kruis)}</b> leest het kritisch tegen als ander model
              </>
            ) : null}
            .
          </li>
          <li>{aiNaam(auteur)} beoordeelt elk punt (overnemen, deels of niet, met reden) en schrijft een betere versie.</li>
          <li>Dat herhaalt zich tot er niets wezenlijks meer te verbeteren valt. Daarna doet de voorzitter een slotcheck.</li>
        </ol>
        <p className="text-xs text-ink/55">Onderweg kun je zelf punten toevoegen of een oordeel omdraaien. Aan het eind vergelijk je blind versie 1 met de eindversie.</p>
      </section>

      {intake.length > 0 && (
        <section className="card p-5 space-y-3">
          <h2 className="font-display font-bold text-lg">Nog even checken</h2>
          <p className="text-sm text-ink/60">Met deze antwoorden wordt het advies een stuk scherper. Overslaan mag ook.</p>
          {intake.map((q, i) => (
            <label key={i} className="block text-sm">
              <span className="font-medium">{q.vraag}</span>
              <input
                className="field mt-1 !py-2"
                value={q.antwoord}
                onChange={(e) => setIntake(intake.map((x, j) => (j === i ? { ...x, antwoord: e.target.value } : x)))}
                onBlur={() => void save({ ...cast, intake })}
                placeholder="Jouw antwoord"
              />
            </label>
          ))}
        </section>
      )}

      <section className="card p-5 space-y-2">
        <h2 className="font-display font-bold text-lg">Wat staat al vast?</h2>
        <p className="text-sm text-ink/60">Randvoorwaarden waar het advies niet aan mag tornen, één per regel. Bijvoorbeeld: &ldquo;Maximaal €100.000&rdquo; of &ldquo;Geen ontslagen&rdquo;.</p>
        <textarea
          className="field !py-2"
          rows={3}
          value={rv}
          onChange={(e) => setRv(e.target.value)}
          onBlur={() => void save({ ...cast, randvoorwaarden: rv.split("\n").map((x) => x.trim()).filter(Boolean) })}
          placeholder="Optioneel"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-bold text-lg">Wie lezen er mee?</h2>
        {cast.rollen.map((r) => (
          <div key={r.id} className={`card p-4 flex gap-3 items-start ${r.isJury ? "bg-sun/50" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.naam}</span>
                <span className="text-sm text-ink/60">{r.isJury ? "Voorzitter, doet de slotcheck" : r.functie}</span>
                <AiBadge role={r} size="xs" />
                {r.isKritisch && <span className="text-[11px] rounded-full bg-peach px-2 py-0.5">Klant of gast</span>}
              </p>
              <p className="text-sm text-ink/75 mt-1">{r.perspectief}</p>
            </div>
            <button className="text-sm underline shrink-0" onClick={() => setEditing(r.id)}>
              Aanpassen
            </button>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendChat(chat);
          }}
        >
          <input className="field !py-2" value={chat} onChange={(e) => setChat(e.target.value)} placeholder='Bijv. "Voeg een jurist toe" of "Maak de klant een zakelijke inkoper"' disabled={chatBusy} />
          <MicButton onText={(t) => void sendChat(t)} onError={(m) => setError({ message: m })} />
          <button className="btn-ghost shrink-0" disabled={chatBusy || !chat.trim()}>
            {chatBusy ? <Spinner /> : "Pas aan"}
          </button>
        </form>
        {antwoord && <p className="text-sm rounded-xl bg-sky px-3 py-2">{antwoord}</p>}
      </section>

      <section className="card p-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <span className="flex items-center gap-2">
          <strong>Rondes</strong>
          <Segmented
            label="Rondes"
            value={String(Math.min(3, Math.max(1, cast.rondes || 2)))}
            onChange={(v) => void save({ ...cast, rondes: Number(v) })}
            options={["1", "2", "3"].map((n) => ({ value: n, label: n }))}
          />
        </span>
        <span className="flex items-center gap-2">
          <strong>Meelezers</strong>
          <Segmented
            label="Slimheid meelezers"
            value={niveauOf(cast)}
            onChange={(v) => void save({ ...cast, niveau: v as Niveau })}
            options={(Object.keys(NIVEAUS) as Niveau[]).map((n) => ({ value: n, label: NIVEAUS[n].naam }))}
          />
        </span>
        <label className="flex items-center gap-2">
          <strong>Max €</strong>
          <input
            className="field !py-1.5 !px-3 w-20"
            inputMode="decimal"
            defaultValue={cast.kostenlimiet ?? ""}
            aria-label="Maximale kosten in euro"
            onBlur={(e) => {
              const eur = Number(e.target.value.replace(",", "."));
              if (eur > 0 && eur !== cast.kostenlimiet) void save({ ...cast, kostenlimiet: eur });
            }}
          />
        </label>
        <span className="basis-full text-xs text-ink/60">
          Schatting: ongeveer {euro(Math.max(0.01, Math.round(ketenKosten(cast, data.keys) * 100) / 100))} voor de hele keten. Schrijver en tegenlezer zijn altijd de slimste modellen; de slimheid geldt voor de
          meelezers. {saving ? "Opslaan…" : ""}
        </span>
      </section>

      <ErrorNote error={error} onClose={() => setError(null)} />

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary text-lg px-8 py-3.5" disabled={starting || !auteur} onClick={onStart}>
          {starting ? <Spinner /> : "Start de review →"}
        </button>
        {!auteur && <span className="text-sm text-coral">Voeg bij Instellingen een sleutel van Anthropic, OpenAI of Google toe.</span>}
        {!kruis && auteur && <span className="text-sm text-ink/60">Tip: met een tweede AI-sleutel leest een ander model tegen. Dat maakt het advies sterker.</span>}
      </div>

      {editRole && (
        <PersonaEditor
          runId={run.id}
          cast={cast}
          role={editRole}
          prep={run.prep[editRole.id]}
          index={cast.rollen.findIndex((r) => r.id === editRole.id)}
          models={data.models}
          compact
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload();
          }}
        />
      )}
    </div>
  );
}
