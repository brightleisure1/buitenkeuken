import { MODELS, getModel, resolveModel, type ModelConfig } from "./config";
import type { Role } from "./types";

/**
 * De Jury is altijd een slimme, nuchtere voorzitter: nooit ongecensureerd,
 * geen vergadercliché en een sterk model (liever Claude of ChatGPT dan Grok).
 */
export function fixJury(role: Role, available: ModelConfig[] = MODELS): Role {
  if (!role.isJury) return role;
  const fixed: Role = { ...role, ongezouten: false, cliche: null };
  const current = resolveModel(role.modelKey, role.customModel);
  const strong = (p?: string) => available.find((m) => m.tier === "sterk" && m.provider !== "xai" && (!p || m.provider === p));
  if (current.provider === "xai" || getModel(role.modelKey)?.tier !== "sterk") {
    const pick = strong(current.provider === "xai" ? undefined : current.provider) ?? strong();
    if (pick && !role.customModel) fixed.modelKey = pick.key;
    if (current.provider === "xai") fixed.customModel = null;
  }
  return fixed;
}
