import { splitTag, extractSources, splitSentences, applyShare } from "../src/lib/text";
import { nextStep } from "../src/lib/planner";
import assert from "node:assert";

// tags tijdens streamen
assert.deepEqual(splitTag("[bez"), { tag: null, rest: "", pending: true });
assert.deepEqual(splitTag("[bezwaar] Dat"), { tag: "bezwaar", rest: "Dat", pending: false });
assert.deepEqual(splitTag(" [Akkoord]Prima"), { tag: "akkoord", rest: "Prima", pending: false });
assert.equal(splitTag("Ik vind").tag, null);
assert.equal(splitTag("Ik vind dat we moeten").rest, "Ik vind dat we moeten");
// bronnen
const s = extractSources("De markt groeit 5% (bron: CBS). En de prijs stijgt (bron: offerte.pdf; Rabobank).");
assert.deepEqual(s.sources, ["CBS", "offerte.pdf", "Rabobank"]);
assert.equal(s.clean, "De markt groeit 5%. En de prijs stijgt.");
// zinnen
const z = splitSentences("Dit is zin een. En twee! Nog bez");
assert.deepEqual(z, { done: ["Dit is zin een.", "En twee!"], rest: "Nog bez" });
const z2 = splitSentences("Het kost 3.5 miljoen. Echt");
assert.deepEqual(z2, { done: ["Het kost 3.5 miljoen."], rest: "Echt" });

// planner
const role = (id: string, extra = {}) => ({ id, naam: id, functie: "f", perspectief: "", instructie: "", zin: "", modelKey: "claude-sterk", stemId: null, webzoeken: false, isJury: false, isKritisch: false, uiterlijk: "", ...extra });
const run: any = { cast: { rondes: 2, stemmen: "uit", bijlages: {}, titel: "t", rollen: [role("a", { isKritisch: true }), role("b"), role("c"), role("j", { isJury: true })] }, result: null, prep: {} };
let seq = 0;
const msgs: any[] = [];
const turn = (role_id: string, round: number, tag = "bezwaar", meta = {}) => msgs.push({ seq: ++seq, kind: "turn", role_id, round, tag, meta, content: "x", sources: [] });
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "j", round: 1, meta: { opening: true } }, "de voorzitter opent");
turn("j", 1, "voorstel", { opening: true });
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "a", round: 1, meta: {} });
turn("a", 1, "akkoord"); turn("b", 1, "akkoord"); turn("c", 1, "akkoord");
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "a", round: 1, meta: { extra: "eensgezind" } });
turn("a", 1, "bezwaar", { extra: "eensgezind" });
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "a", round: 2, meta: {} });
msgs.push({ seq: ++seq, kind: "boss", meta: { action: "vraag", target: "c" }, content: "?" });
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "c", round: 2, meta: { answer: true } });
turn("c", 2, "voorstel", { answer: true });
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "a", round: 2, meta: {} });
msgs.push({ seq: ++seq, kind: "system", meta: { wrapUp: true }, content: "" });
assert.deepEqual(nextStep(run, msgs), { type: "final_word" });
msgs.push({ seq: ++seq, kind: "system", meta: { finalWordSkipped: true }, content: "" });
assert.deepEqual(nextStep(run, msgs), { type: "turn", roleId: "j", round: 2, meta: { verdict: true } });
turn("j", 2, "voorstel", { verdict: true });
assert.deepEqual(nextStep(run, msgs), { type: "result" });
run.result = {};
assert.deepEqual(nextStep(run, msgs), { type: "done" });

// delen
const sh = applyShare(run.cast, [{ ...msgs[0], content: "Ik ben a en Acme BV betaalt 5000" }], { anonymous: false, redactions: ["Acme BV", "5000"] });
assert.equal(sh.messages[0].content, "Ik ben a en ███████ betaalt ████");
console.log("alles ok");

// 'Alleen het advies': de laatste aan/uit/fout-melding telt
import { autorunState } from "../src/lib/planner";
const sys = (meta: object) => ({ kind: "system", meta, content: "" }) as any;
assert.equal(autorunState([]), "uit");
assert.equal(autorunState([sys({ autorun: true })]), "aan");
assert.equal(autorunState([sys({ autorun: true }), sys({ wrapUp: true })]), "aan", "andere systeemberichten tellen niet");
assert.equal(autorunState([sys({ autorun: true }), sys({ autorunOff: true })]), "uit");
assert.equal(autorunState([sys({ autorun: true }), sys({ autorunError: { error: "x" } })]), "fout");
assert.equal(autorunState([sys({ autorunError: { error: "x" } }), sys({ autorun: true })]), "aan", "opnieuw proberen");

// Geen titels in namen
import { stripTitles } from "../src/lib/text";
assert.equal(stripTitles("Dr. Anneke de Wit"), "Anneke de Wit");
assert.equal(stripTitles("prof. dr. ir. Kees Jansen"), "Kees Jansen");
assert.equal(stripTitles("Mr Jan Visser"), "Jan Visser");
assert.equal(stripTitles("Petra Smit MBA"), "Petra Smit");
assert.equal(stripTitles("Kees de Vries, RA"), "Kees de Vries");
assert.equal(stripTitles("Iris Drost"), "Iris Drost", "gewone namen blijven heel");
assert.equal(stripTitles("Mira Ingen"), "Mira Ingen");
assert.equal(stripTitles("Dr."), "Dr.", "niet leeg maken");
