import "server-only";
import { AppError } from "./errors";
import { getSetting } from "./settings";
import type { Run } from "./types";

export const DEFAULT_LIMIT_EUR = 2;

export async function defaultLimit(): Promise<number> {
  const v = await getSetting<{ eur: number }>("kostenlimiet").catch(() => null);
  return v && Number.isFinite(v.eur) && v.eur > 0 ? v.eur : DEFAULT_LIMIT_EUR;
}

/** Limiet van dit debat (null = geen limiet). */
export function limitOf(run: Run): number | null {
  const l = run.cast.kostenlimiet;
  return typeof l === "number" && l > 0 ? l : null;
}

export function overBudget(run: Run) {
  const l = limitOf(run);
  return l !== null && run.cost_eur >= l;
}

/** Gooit een nette fout als de limiet bereikt is. */
export function assertBudget(run: Run, wat: string) {
  if (!overBudget(run)) return;
  throw new AppError(
    `De kostenlimiet van deze vergadering (€${limitOf(run)!.toFixed(2).replace(".", ",")}) is bereikt, dus ${wat} kan niet meer.`,
    "Verhoog de limiet in de arena of op het voorstelscherm, of rond de vergadering af.",
    402,
  );
}
