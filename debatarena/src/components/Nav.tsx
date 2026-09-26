"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Start" },
  { href: "/geschiedenis", label: "Geschiedenis" },
  { href: "/instellingen", label: "Instellingen" },
];

export function Nav() {
  const path = usePathname();
  const [noKey, setNoKey] = useState(false);
  useEffect(() => {
    const check = () =>
      fetch("/api/settings/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setNoKey(d ? !d.aiKey : false))
        .catch(() => {});
    check();
    window.addEventListener("sleutels-gewijzigd", check);
    return () => window.removeEventListener("sleutels-gewijzigd", check);
  }, [path]);
  return (
    <header className="no-print sticky top-0 z-30 bg-cream/75 backdrop-blur-xl border-b border-ink/10">
      <div className="mx-auto max-w-6xl px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="font-display font-bold text-lg flex items-center gap-2 shrink-0">
          <span className="h-3 w-3 rounded-full bg-coral inline-block shadow-[0_0_0_4px_rgb(255_90_54/0.18)]" />
          <span className="hidden min-[420px]:inline">Debatarena</span>
        </Link>
        <nav className="ml-auto flex gap-0.5 sm:gap-1 text-[13px] sm:text-sm">
          {LINKS.map((l) => {
            const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-2.5 sm:px-3 py-1.5 font-medium ${on ? "bg-ink text-white" : "text-ink/70 hover:text-ink hover:bg-ink/5"}`}
              >
                {l.label}
                {l.href === "/instellingen" && noKey && (
                  <span className="ml-1 inline-block h-2 w-2 rounded-full bg-coral align-middle" title="Er is nog geen AI-sleutel ingesteld" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
