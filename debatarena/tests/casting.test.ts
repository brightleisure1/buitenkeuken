import { normalizeCast } from "../src/lib/casting";
import { MODELS } from "../src/lib/config";
import assert from "node:assert";
const r = (id: string, x = {}) => ({ id, naam: id + " Jansen", functie: "Marketeer", perspectief: "p", instructie: "i", zin: "z", modelKey: "claude-sterk", stemId: "v1", webzoeken: false, isJury: false, isKritisch: false, ongezouten: false, uiterlijk: "u", ...x });
const raw = { titel: "Prijs", rondes: 9, stemmen: "jury" as const, bijlages: [{ bijlageId: "att1", voor: "cfo" }], rollen: [r("jury", { isJury: true }), r("cfo", { functie: "CFO" }), r("sales"), r("hr"), r("ops"), r("extra")] };
const voices = [{ id: "v1", naam: "A", omschrijving: "" }, { id: "v2", naam: "B", omschrijving: "" }];
const c = normalizeCast(raw, { models: MODELS, voices, attachments: [{ id: "att1" } as any] });
assert.equal(c.rollen.at(-1)!.isJury, true);
assert.equal(c.rollen.filter(x => !x.isJury).length, 4);
assert.equal(c.rollen.filter(x => x.isKritisch).length, 1);
assert.equal(c.rondes, 6);
assert.equal(c.bijlages.att1, "cfo");
assert(new Set(c.rollen.map(x => MODELS.find(m => m.key === x.modelKey)!.provider)).size >= 2);
// alleen anthropic beschikbaar → geen gpt
const c2 = normalizeCast({ ...raw, rollen: [r("a", { modelKey: "gpt-sterk" }), r("b"), r("klant", { functie: "Inkoper" })] }, { models: MODELS.filter(m => m.provider === "anthropic"), voices: [], attachments: [] });
assert(c2.rollen.every(x => x.modelKey.startsWith("claude")));
assert.equal(c2.rollen.find(x => x.id === "klant")!.isKritisch, true);
assert.equal(c2.stemmen, "uit");

// Ongezouten alleen bij Grok; Gemini kan niet webzoeken; alle AI's gemengd.
const c3 = normalizeCast(
  { ...raw, rollen: [r("a", { modelKey: "grok-sterk", ongezouten: true }), r("b", { modelKey: "gemini-sterk", webzoeken: true, ongezouten: true }), r("klant", { functie: "Inkoper", modelKey: "claude-sterk" }), r("jury", { isJury: true })] },
  { models: MODELS, voices: [], attachments: [] },
);
assert.equal(c3.rollen.find((x) => x.id === "a")!.ongezouten, true);
assert.equal(c3.rollen.find((x) => x.id === "b")!.ongezouten, false);
assert.equal(c3.rollen.find((x) => x.id === "b")!.webzoeken, false);
// Alles Claude terwijl er vier aanbieders zijn → wordt gemengd.
const c4 = normalizeCast({ ...raw, rollen: [r("a"), r("b"), r("c"), r("klant", { functie: "Klant" })] }, { models: MODELS, voices: [], attachments: [] });
const provs = new Set(c4.rollen.filter((x) => !x.isJury).map((x) => MODELS.find((m) => m.key === x.modelKey)!.provider));
assert(provs.size >= 2, "verschillende AI's");

