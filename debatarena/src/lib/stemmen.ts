import "server-only";
import type { Cast } from "./types";
import { debateVoices, listVoices } from "./voices";

/**
 * Stem per rol en voor de baas, zodat de hele vergadering te beluisteren is.
 * Rollen houden hun eigen stem; wie er geen heeft, krijgt een vrije (bij voorkeur Nederlandse) stem.
 */
export async function voiceMap(cast: Cast): Promise<Record<string, string>> {
  const all = await listVoices();
  if (!all.length) return {};
  const pool = await debateVoices();
  const known = new Set(all.map((v) => v.id));
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const r of cast.rollen) {
    if (r.stemId && known.has(r.stemId) && !used.has(r.stemId)) {
      out[r.id] = r.stemId;
      used.add(r.stemId);
    }
  }
  const free = () => pool.find((v) => !used.has(v.id)) ?? all.find((v) => !used.has(v.id)) ?? pool[0] ?? all[0];
  for (const r of cast.rollen) {
    if (!out[r.id]) {
      const v = free();
      out[r.id] = v.id;
      used.add(v.id);
    }
  }
  out.baas = free().id;
  return out;
}
