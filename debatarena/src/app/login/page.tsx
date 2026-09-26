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
        <h1 className="font-display text-3xl font-extrabold">Debatarena</h1>
        <p className="text-ink/70 mt-1">Laat AI-rollen debatteren. Jij bent de baas.</p>
      </div>
      <label className="block">
        <span className="text-sm font-semibold">Wachtwoord</span>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="field mt-1" />
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
