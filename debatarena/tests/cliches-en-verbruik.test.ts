import assert from "node:assert";
import { applyCliches, CLICHES, clicheTurnLines, orderForRound } from "../src/lib/cliches";
import { turnInstruction, roleSystem } from "../src/lib/prompts";
import { nextStep } from "../src/lib/planner";
import { summarizeUsage, tokens, addUsage, emptyUsage } from "../src/lib/usage";
import type { Cast, Message, Role, Run } from "../src/lib/types";

const role = (id: string, x: Partial<Role> = {}): Role => ({
  id, naam: `${id} Jansen`, functie: "Manager", perspectief: "p", instructie: "i", zin: "z", modelKey: "claude-sterk",
  stemId: null, webzoeken: false, isJury: false, isKritisch: false, uiterlijk: "u", ...x,
});
const cast = (x: Partial<Cast> = {}): Cast => ({
  titel: "t", rondes: 3, stemmen: "uit", bijlages: {},
  rollen: [role("a", { isKritisch: true }), role("b"), role("c"), role("j", { isJury: true })], ...x,
});

// Alle 27 clichés uit de lijst zijn er, met unieke id's
assert.equal(CLICHES.length, 27);
assert.equal(new Set(CLICHES.map((c) => c.id)).size, 27);

// Uit: niemand speelt een cliché
const off = applyCliches({ ...cast(), cliches: false, rollen: cast().rollen.map((r) => ({ ...r, cliche: "parkeerder" })) });
assert(off.rollen.every((r) => r.cliche === null));

// Aan: minstens 2, uniek, niet de Jury, eerst niet-kritische rollen
const on = applyCliches({ ...cast(), cliches: true });
const withC = on.rollen.filter((r) => r.cliche);
assert(withC.length >= 2);
assert.equal(new Set(withC.map((r) => r.cliche)).size, withC.length);
assert.equal(on.rollen.find((r) => r.isJury)!.cliche, null);
assert.equal(on.rollen.find((r) => r.isKritisch)!.cliche ?? null, null, "kritische klant liever zonder cliché");
// Stabiel: nog een keer toepassen verandert niets
assert.deepEqual(applyCliches(on), on);
// Dubbel en ongeldig worden opgeschoond
const dup = applyCliches({ ...cast(), cliches: true, rollen: [role("a", { cliche: "parkeerder" }), role("b", { cliche: "parkeerder" }), role("c", { cliche: "bestaat-niet" }), role("j", { isJury: true, cliche: "cynicus" })] });
assert.equal(dup.rollen.filter((r) => r.cliche === "parkeerder").length, 1);
assert(!dup.rollen.some((r) => r.cliche === "bestaat-niet"));
assert.equal(dup.rollen.find((r) => r.isJury)!.cliche, null);

// Volgorde: Late Binnenkomer als laatste in ronde 1, Rondvraagterrorist als laatste in de laatste ronde
const late = [role("x", { cliche: "late-binnenkomer" }), role("y"), role("z", { cliche: "rondvraagterrorist" })];
assert.deepEqual(orderForRound(late, 1, 3).map((r) => r.id), ["y", "z", "x"]);
assert.deepEqual(orderForRound(late, 2, 3).map((r) => r.id), ["x", "y", "z"]);
assert.deepEqual(orderForRound(late, 3, 3).map((r) => r.id), ["x", "y", "z"].filter((i) => i !== "z").concat("z"));

// Beurtinstructies per ronde
const stil = { cliche: "stille-aanwezigheid" };
assert.equal(clicheTurnLines(stil, 1, 3).maxWords, 8);
assert.match(clicheTurnLines(stil, 3, 3).lines.join(" "), /Volgens mij is alles wel gezegd/);
assert.match(clicheTurnLines({ cliche: "late-binnenkomer" }, 1, 3).lines.join(" "), /liep een beetje uit/);
assert.equal(clicheTurnLines({ cliche: "late-binnenkomer" }, 2, 3).lines.length, 0);
assert.equal(clicheTurnLines({ cliche: "dominator" }, 2, 3).factor, 1.8);
assert.deepEqual(clicheTurnLines({ cliche: null }, 1, 3), { lines: [], factor: 1 });

// Prompt: cliché in de rol, woordgrens in de beurt, ongecensureerd alleen bij de rol zelf
const run = { id: "r", question: "Vraag?", cast: { ...cast(), cliches: true, rollen: [role("a", { cliche: "dominator", ongezouten: true }), role("b", { cliche: "stille-aanwezigheid" }), role("j", { isJury: true })] }, prep: {} } as unknown as Run;
const sysA = roleSystem(run, run.cast.rollen[0], [], { withFacts: false });
assert.match(sysA, /JE VERGADERCLICHÉ: De Dominator/);
assert.match(sysA, /ONGECENSUREERD \(/);
assert.match(sysA, /ONGECENSUREERD \([^]*$/, "staat als laatste");
assert.doesNotMatch(roleSystem(run, run.cast.rollen[1], [], { withFacts: false }), /ONGECENSUREERD/);
assert.match(turnInstruction({ run, role: run.cast.rollen[0], messages: [], round: 2, meta: {} }), /maximaal 234 woorden/);
assert.match(turnInstruction({ run, role: run.cast.rollen[1], messages: [], round: 1, meta: {} }), /maximaal 8 woorden/);

// Planner volgt de clichévolgorde
const r2 = { cast: { rondes: 2, stemmen: "uit", bijlages: {}, titel: "t", rollen: [role("x", { cliche: "late-binnenkomer" }), role("y"), role("j", { isJury: true })] }, result: null, prep: {} } as unknown as Run;
const opened = [{ seq: 1, kind: "turn", role_id: "j", round: 1, tag: null, meta: { opening: true }, content: "Welkom", sources: [] }] as unknown as Message[];
assert.equal((nextStep(r2, opened) as { roleId: string }).roleId, "y");

// Verbruik optellen
const u = addUsage({ ...emptyUsage("anthropic", "m"), inputTokens: 10, outputTokens: 5, costUsd: 1 }, { ...emptyUsage(), cachedTokens: 7, costUsd: 0.5 });
assert.equal(u.inputTokens, 10);
assert.equal(u.cachedTokens, 7);
assert.equal(u.costUsd, 1.5);
const s = summarizeUsage(
  [
    { kind: "beurt", role_id: "a", provider: "xai", model: "grok-4.7", input_tokens: 100, cached_tokens: 50, output_tokens: 20, units: 0, cost_eur: 0.01 },
    { kind: "beurt", role_id: "a", provider: "xai", model: "grok-4.7", input_tokens: 100, cached_tokens: 50, output_tokens: 20, units: 0, cost_eur: 0.01 },
    { kind: "portret", role_id: "b", provider: "openai", model: "gpt-image-1", input_tokens: 0, cached_tokens: 0, output_tokens: 0, units: 3, cost_eur: 0.03 },
  ],
  { a: "Anna", b: "Bert" },
);
assert.equal(s.total.calls, 3);
assert.equal(s.perRole.find((r) => r.roleId === "a")!.inputTokens, 200);
assert.equal(s.perRole[0].label, "Bert", "duurste eerst");
assert.equal(s.perKind.find((k) => k.label === "Debatbeurten")!.outputTokens, 40);
assert.equal(tokens(950), "950");
assert.equal(tokens(12_345), "12k");
assert.equal(tokens(1_500), "1,5k");

// Modellen kiezen uit wat de sleutel mag gebruiken
import { pickModel } from "../src/lib/model-pick";
import { MODELS } from "../src/lib/config";
const m = (k: string) => MODELS.find((x) => x.key === k)!;
const gemini = ["models/gemini-2.5-pro", "models/gemini-2.5-flash", "models/gemini-2.5-flash-lite", "models/gemini-3-pro-preview", "models/gemini-3-pro-image-preview"];
assert.equal(pickModel(gemini, m("gemini-sterk")), "gemini-3-pro-preview");
assert.equal(pickModel(gemini, m("gemini-snel")), "gemini-2.5-flash");
assert.equal(pickModel(["gemini-3.1-pro", "gemini-2.5-pro"], m("gemini-sterk")), "gemini-3.1-pro", "bestaande naam blijft");
assert.equal(pickModel(["grok-4.7", "grok-4-fast", "grok-code-fast-1"], m("grok-snel")), "grok-4-fast");
assert.equal(pickModel(["grok-4", "grok-3-mini", "grok-2-image-1212"], m("grok-sterk")), "grok-4");
assert.equal(pickModel(["gpt-5", "gpt-5-mini", "gpt-4o"], m("gpt-sterk")), "gpt-5");
assert.equal(pickModel(["gemini-2.5-pro"], m("gemini-snel")), "gemini-2.5-pro", "geen snelle variant: neem de sterke");
assert.equal(pickModel([], m("gemini-sterk")), "gemini-3.1-pro", "lege lijst: config-naam");

// Spreektaal en Nederlandse context in elke rol
assert.match(sysA, /ZO PRAAT JE/);
assert.match(sysA, /Nederlandse bedrijven/);

// De Jury is altijd een slimme, nette voorzitter
import { fixJury } from "../src/lib/jury";
const juryBase = { id: "j", naam: "Jan", functie: "Jury", perspectief: "", instructie: "", zin: "", uiterlijk: "", stemId: null, webzoeken: false, isKritisch: false, isJury: true, customModel: null } as never as Parameters<typeof fixJury>[0];
const j1 = fixJury({ ...juryBase, modelKey: "grok-sterk", ongezouten: true, cliche: "dominator" });
assert.equal(j1.ongezouten, false);
assert.equal(j1.cliche, null);
assert.ok(!j1.modelKey.startsWith("grok") && m(j1.modelKey).tier === "sterk", j1.modelKey);
assert.equal(fixJury({ ...juryBase, modelKey: "gpt-snel" }).modelKey, "gpt-sterk", "zelfde aanbieder, sterker model");
assert.equal(fixJury({ ...juryBase, modelKey: "claude-sterk" }).modelKey, "claude-sterk");
const notJury = { ...juryBase, isJury: false, modelKey: "grok-sterk", ongezouten: true };
assert.equal(fixJury(notJury).ongezouten, true, "andere rollen blijven zoals ze zijn");

// Inhoud voorop: elke rol brengt vakkennis in en de rondes bouwen op naar een besluit
assert.match(sysA, /WAT JE INBRENGT/);
assert.match(turnInstruction({ run, role: run.cast.rollen[1], messages: [], round: 2, meta: {} }), /Tussenronde: ga in op het sterkste argument/);
assert.match(turnInstruction({ run, role: run.cast.rollen[1], messages: [], round: 3, meta: {} }), /laatste ronde\. Kom met je eindvoorstel/);
assert.doesNotMatch(sysA, /minstens één keer/, "ongecensureerd zonder verplichte vloek");

// Fun-modus: één schakelaar; serieus blijft serieus, fun voegt humor toe, de Jury blijft een slimme voorzitter
import { isFun } from "../src/lib/cliches";
import { portraitKey } from "../src/lib/prep";
assert.equal(isFun({ cliches: true }), true, "oude debatten met clichés tellen als fun");
assert.equal(isFun({ fun: false, cliches: true }), false);
assert.match(sysA, /FUN-MODUS/);
const serious = { ...run, cast: { ...run.cast, fun: false } } as Run;
assert.doesNotMatch(roleSystem(serious, serious.cast.rollen[0], [], { withFacts: false }), /FUN-MODUS/);
assert.match(roleSystem(serious, serious.cast.rollen[0], [], { withFacts: false }), /subtiel doorschemeren/);
assert.doesNotMatch(roleSystem(run, run.cast.rollen[2], [], { withFacts: false }), /FUN-MODUS/, "de Jury doet niet mee aan de grappen");
const pr = run.cast.rollen[0];
assert.notEqual(portraitKey(pr, { fun: true }), portraitKey(pr, { fun: false }), "fun aan/uit tekent opnieuw");
assert.equal(portraitKey(pr, { fun: false, cliches: true }), portraitKey({ ...pr, cliche: null }, {}), "serieus: cliché telt niet mee");

// Slimheid: iedereen houdt zijn eigen AI, de voorzitter blijft de sterkste
import { applyNiveau, estimateCost, niveauOf, turnModel } from "../src/lib/niveau";
const nv = { ...cast(), rondes: 3, rollen: [role("a", { modelKey: "claude-sterk" }), role("b", { modelKey: "gpt-sterk" }), role("j", { isJury: true, modelKey: "claude-sterk" })] } as Cast;
const vlotCast = applyNiveau(nv, "vlot");
assert.deepEqual(vlotCast.rollen.map((r) => r.modelKey), ["claude-snel", "gpt-snel", "claude-sterk"]);
assert.equal(niveauOf({ rollen: vlotCast.rollen }), "vlot", "oude debatten: afgeleid uit de modellen");
assert.equal(turnModel(m("claude-sterk"), "slimst").effort, "medium");
assert.equal(turnModel(m("gpt-sterk"), "slimst").reasoning, "medium");
assert.equal(turnModel(m("grok-sterk"), "slimst").reasoning, null, "Grok kent geen effort");
assert.equal(turnModel(m("claude-sterk"), "slim").effort, "low");
assert.ok(estimateCost(nv, "vlot") < estimateCost(nv, "slim") && estimateCost(nv, "slim") < estimateCost(nv, "slimst"), "slimmer is duurder");
