import { MODELS, PROVIDERS, USD_TO_EUR, resolveModel, type ModelConfig, type Provider } from "./config";
import { NIVEAUS, niveauOf } from "./niveau";
import type { Cast } from "./types";

/** Zelfde keuze als op de server: het slimste Claude schrijft, het slimste model van een andere AI leest tegen. */
export function ketenModellen(keys: Partial<Record<Provider, boolean>>): { auteur: ModelConfig | null; kruis: ModelConfig | null } {
  const strong = (p: Provider) => MODELS.find((m) => m.provider === p && m.tier === "sterk" && keys[p]);
  const auteur = strong("anthropic") ?? strong("openai") ?? strong("google") ?? null;
  const kruis = auteur ? ((["openai", "google", "anthropic", "xai"] as Provider[]).filter((p) => p !== auteur.provider).map(strong).find(Boolean) ?? null) : null;
  return { auteur, kruis };
}

export const aiNaam = (m: ModelConfig | null) => (m ? PROVIDERS[m.provider].naam : "—");

/** Ruwe schatting van de kosten van één review-keten in euro. */
export function ketenKosten(cast: Cast, keys: Partial<Record<Provider, boolean>>): number {
  const { auteur, kruis } = ketenModellen(keys);
  if (!auteur) return 0;
  const usd = (m: ModelConfig, inTok: number, outTok: number) => (inTok * m.inputPrice + outTok * m.outputPrice) / 1e6;
  const rondes = Math.min(3, Math.max(1, cast.rondes || 2));
  const tier = NIVEAUS[niveauOf(cast)].tier;
  let total = usd(auteur, 6000, 5000); // versie 1, diep nagedacht
  for (let r = 0; r < rondes; r++) {
    for (const role of cast.rollen.filter((x) => !x.isJury)) {
      const own = resolveModel(role.modelKey, role.customModel);
      const m = role.customModel ? own : (MODELS.find((x) => x.provider === own.provider && x.tier === tier) ?? own);
      total += usd(m, 6000, NIVEAUS[niveauOf(cast)].diep ? 1500 : 700);
    }
    if (kruis) total += usd(kruis, 7000, 2500);
    total += usd(auteur, 12000, 7000); // beoordelen en herschrijven
  }
  const vz = cast.rollen.find((r) => r.isJury);
  if (vz) total += usd(resolveModel(vz.modelKey, vz.customModel), 12000, 2500);
  total += cast.rollen.filter((r) => !r.isJury && r.webzoeken).length * 0.02;
  return total * USD_TO_EUR;
}
