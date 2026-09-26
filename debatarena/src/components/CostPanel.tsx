"use client";

import { euro } from "@/lib/client";
import { PROVIDERS, type Provider } from "@/lib/config";
import type { Role } from "@/lib/types";
import { tokens, type UsageLine, type UsageSummary } from "@/lib/usage";
import { AiBadge } from "./ui";

const EXTRA_PROVIDER: Record<string, string> = { elevenlabs: "ElevenLabs" };

/** Tokens en kosten van één debat, uitgesplitst. */
export function CostPanel({ usage, roles, compact = false }: { usage: UsageSummary; roles: Role[]; compact?: boolean }) {
  const t = usage.total;
  if (!t.calls) return <p className="text-sm text-ink/60">Nog geen verbruik.</p>;
  const roleById = new Map(roles.map((r) => [r.id, r]));
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Kosten" value={euro(t.costEur)} strong />
        <Stat label="Tokens erin" value={tokens(t.inputTokens)} />
        <Stat label="Uit cache" value={tokens(t.cachedTokens)} hint="Hergebruikte context, kost ongeveer 10%" />
        <Stat label="Tokens eruit" value={tokens(t.outputTokens)} />
      </div>
      <Table title="Per rol" rows={usage.perRole} first={(l) => {
        const r = roleById.get((l as UsageLine & { roleId: string }).roleId);
        return (
          <span className="flex items-center gap-1.5">
            <span className="truncate">{l.label}</span>
            {r && <AiBadge role={r} size="xs" />}
          </span>
        );
      }} />
      {!compact && <Table title="Per onderdeel" rows={usage.perKind} />}
      {!compact && (
        <Table
          title="Per model"
          rows={usage.perModel}
          first={(l) => {
            const p = (l as UsageLine & { provider: string }).provider;
            return (
              <span>
                {l.label} <span className="text-ink/50">({PROVIDERS[p as Provider]?.naam ?? EXTRA_PROVIDER[p] ?? p})</span>
              </span>
            );
          }}
        />
      )}
      <p className="text-xs text-ink/50">Schatting op basis van de prijzen in de configuratie. Afgebroken beurten zijn geschat.</p>
    </div>
  );
}

function Stat({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={`rounded-2xl border-2 border-ink/15 px-3 py-2 ${strong ? "bg-sun" : "bg-white"}`} title={hint}>
      <p className="text-[11px] text-ink/60">{label}</p>
      <p className="font-display font-extrabold text-lg leading-tight">{value}</p>
    </div>
  );
}

function Table({ title, rows, first }: { title: string; rows: UsageLine[]; first?: (l: UsageLine) => React.ReactNode }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="font-semibold mb-1">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-ink/50 text-xs">
              <th className="py-1 pr-2 font-medium" />
              <th className="py-1 px-2 font-medium text-right sm:hidden">Tokens</th>
              <th className="py-1 px-2 font-medium text-right hidden sm:table-cell">Erin</th>
              <th className="py-1 px-2 font-medium text-right hidden sm:table-cell">Cache</th>
              <th className="py-1 px-2 font-medium text-right hidden sm:table-cell">Eruit</th>
              <th className="py-1 pl-2 font-medium text-right">Kosten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.label} className="border-t border-ink/10">
                <td className="py-1.5 pr-2 max-w-[11rem] sm:max-w-[16rem] break-words">{first ? first(l) : l.label}</td>
                <td className="py-1.5 px-2 text-right tabular-nums sm:hidden">
                  {l.units && !l.inputTokens && !l.outputTokens ? "—" : tokens(l.inputTokens + l.cachedTokens + l.outputTokens)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums hidden sm:table-cell">{l.units && !l.inputTokens ? "—" : tokens(l.inputTokens)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums hidden sm:table-cell">{l.units && !l.inputTokens ? "—" : tokens(l.cachedTokens)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums hidden sm:table-cell">{l.units && !l.outputTokens ? "—" : tokens(l.outputTokens)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums font-semibold">{euro(l.costEur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
