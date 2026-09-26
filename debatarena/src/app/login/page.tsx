"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, toError } from "@/components/ui";

function LoginForm() {
  const params = useSearchParams();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; oplossing?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/login", { method: "POST", json: { password: pw } });
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(toError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm p-8 space-y-5">
      <div>
        <h1 className="font-display text-3xl font-bold">Debatarena</h1>
        <p className="text-ink/70 mt-1">Maak je besluit scherper met meerdere AI&apos;s.</p>
      </div>
      <label className="block">
        <span className="text-sm font-semibold">Pincode</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value.replace(/\s/g, ""))}
          className="field mt-1 text-center text-2xl tracking-[0.5em]"
          aria-label="Pincode"
        />
      </label>
      <ErrorNote error={error} />
      <button className="btn-primary w-full" disabled={busy || !pw}>
        {busy ? <Spinner /> : "Binnenkomen"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex-1 grid place-items-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
