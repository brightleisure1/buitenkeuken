import { IMAGE, MODELS, USD_TO_EUR, getModel, resolveModel, type ModelConfig } from "./config";
import type { Cast, Role } from "./types";

/**
 * Hoe slim de deelnemers zijn. Slimmer = duurder.
 * De voorzitter is altijd het sterkste model en denkt diep na over het advies,
 * zodat de besluitvaardigheid nooit inlevert.
 */
export type Niveau = "vlot" | "slim" | "slimst";

export const NIVEAUS: Record<Niveau, { naam: string; uitleg: string; tier: "snel" | "sterk"; diep: boolean }> = {
  vlot: { naam: "Vlot", uitleg: "Snelle, goedkope modellen. Prima voor een eerste verkenning.", tier: "snel", diep: false },
  slim: { naam: "Slim", uitleg: "De sterkste modellen van elke AI.", tier: "sterk", diep: false },
  slimst: { naam: "Slimst", uitleg: "De sterkste modellen, en ze denken per beurt langer na. Het duurst.", tier: "sterk", diep: true },
};

/** Oude debatten zonder instelling: afleiden uit de modellen. */
export function niveauOf(cast: Pick<Cast, "niveau" | "rollen">): Niveau {
  if (cast.niveau && cast.niveau in NIVEAUS) return cast.niveau;
  const debaters = cast.rollen.filter((r) => !r.isJury);
  return debaters.length && debaters.every((r) => getModel(r.modelKey)?.tier === "snel") ? "vlot" : "slim";
}

/** Zet elke deelnemer op het model van zijn eigen AI dat bij het niveau hoort (eigen modelnamen blijven staan). */
export function applyNiveau(cast: Cast, niveau: Niveau, available: ModelConfig[] = MODELS): Cast {
  const tier = NIVEAUS[niveau].tier;
  const rollen = cast.rollen.map((r): Role => {
    if (r.isJury || r.customModel) return r;
    const provider = getModel(r.modelKey)?.provider;
    const pick = available.find((m) => m.provider === provider && m.tier === tier);
    return pick ? { ...r, modelKey: pick.key } : r;
  });
  return { ...cast, niveau, rollen };
}

/** Bij 'slimst' denken de modellen die dat kunnen per beurt langer na. */
export function turnModel(model: ModelConfig, niveau: Niveau): ModelConfig {
  if (!NIVEAUS[niveau].diep) return model;
  return {
    ...model,
    effort: model.effort ? "medium" : model.effort,
    reasoning: model.reasoning ? "medium" : model.reasoning,
  };
}

/** Ruwe schatting van de kosten van een hele vergadering in euro, per niveau. */
export function estimateCost(cast: Cast, niveau: Niveau): number {
  const rounds = cast.rondes;
  const diep = NIVEAUS[niveau].diep;
  const tier = NIVEAUS[niveau].tier;
  // Een beurt leest gemiddeld zo'n 6.000 tokens (grotendeels uit de cache) en zegt er zo'n 300 (plus denkwerk).
  const turnUsd = (m: ModelConfig) => {
    const cached = m.cachedFactor ?? 0.1;
    const input = 6000 * (0.3 + 0.7 * cached) * m.inputPrice;
    const output = (diep ? 1100 : 350) * m.outputPrice;
    return (input + output) / 1e6;
  };
  let usd = 0;
  for (const r of cast.rollen) {
    const current = resolveModel(r.modelKey, r.customModel);
    if (r.isJury) {
      // Opening, slotwoord en het uitgewerkte advies (diep nagedacht).
      usd += 2 * turnUsd(current) + (20000 * current.inputPrice + 4000 * current.outputPrice) / 1e6;
      continue;
    }
    const m = r.customModel ? current : (MODELS.find((x) => x.provider === current.provider && x.tier === tier) ?? current);
    usd += rounds * turnUsd(m);
  }
  // Portretten en huiswerk (grofweg).
  usd += cast.rollen.length * 3 * IMAGE.priceUsd + cast.rollen.filter((r) => !r.isJury).length * 0.03;
  return usd * USD_TO_EUR;
}
