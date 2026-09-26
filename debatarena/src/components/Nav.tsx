"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Start" },
  { href: "/geschiedenis", label: "Geschiedenis" },
  { href: "/instellingen", label: "Instellingen" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="no-print sticky top-0 z-30 bg-cream/90 backdrop-blur border-b-2 border-ink">
      <div className="mx-auto max-w-6xl px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="font-display font-extrabold text-lg flex items-center gap-2 shrink-0">
          <span className="h-3.5 w-3.5 rounded-full bg-coral inline-block border-2 border-ink" />
          <span className="hidden min-[420px]:inline">Debatarena</span>
        </Link>
        <nav className="ml-auto flex gap-0.5 sm:gap-1 text-[13px] sm:text-sm">
          {LINKS.map((l) => {
            const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-2.5 sm:px-3 py-1.5 font-medium ${on ? "bg-ink text-cream" : "hover:bg-sun"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
