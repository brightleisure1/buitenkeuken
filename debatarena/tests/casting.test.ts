import { normalizeCast } from "../src/lib/casting";
import { MODELS } from "../src/lib/config";
import assert from "node:assert";
const r = (id: string, x = {}) => ({ id, naam: id + " Jansen", functie: "Marketeer", perspectief: "p", instructie: "i", zin: "z", modelKey: "claude-sterk", stemId: "v1", webzoeken: false, isJury: false, isKritisch: false, uiterlijk: "u", ...x });
const raw = { titel: "Prijs", rondes: 9, stemmen: "jury" as const, bijlages: [{ bijlageId: "att1", voor: "cfo" }], rollen: [r("jury", { isJury: true }), r("cfo", { functie: "CFO" }), r("sales"), r("hr"), r("ops"), r("extra")] };
const voices = [{ id: "v1", naam: "A", omschrijving: "" }, { id: "v2", naam: "B", omschrijving: "" }];
const c = normalizeCast(raw, { models: MODELS, voices, attachments: [{ id: "att1" } as any] });
assert.equal(c.rollen.at(-1)!.isJury, true);
assert.equal(c.rollen.filter(x => !x.isJury).length, 4);
assert.equal(c.rollen.filter(x => x.isKritisch).length, 1);
assert.equal(c.rondes, 6);
assert.equal(c.bijlages.att1, "cfo");
assert(new Set(c.rollen.map(x => MODELS.find(m => m.key === x.modelKey)!.provider)).size === 2);
// alleen anthropic beschikbaar → geen gpt
const c2 = normalizeCast({ ...raw, rollen: [r("a", { modelKey: "gpt-sterk" }), r("b"), r("klant", { functie: "Inkoper" })] }, { models: MODELS.filter(m => m.provider === "anthropic"), voices: [], attachments: [] });
assert(c2.rollen.every(x => x.modelKey.startsWith("claude")));
assert.equal(c2.rollen.find(x => x.id === "klant")!.isKritisch, true);
assert.equal(c2.stemmen, "uit");
console.log("casting ok");
