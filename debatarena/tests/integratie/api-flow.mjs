// Doorloopt de hele app via de API, tegen een echte database en de nepwolk.
// Start eerst: tests/integratie/omgeving.sh start
import assert from "node:assert/strict";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3200";
const FAKE = process.env.FAKE_URL ?? "http://127.0.0.1:54321";
let cookie = "";
let passed = 0;

async function call(path, { method = "GET", json, form, raw, noAuth } = {}) {
  const res = await fetch(APP + path, {
    method,
    redirect: "manual",
    headers: { ...(noAuth ? {} : { cookie }), ...(json !== undefined ? { "content-type": "application/json" } : {}) },
    body: json !== undefined ? JSON.stringify(json) : form,
  });
  if (raw) return res;
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    passed++;
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const fakeLog = async () => (await fetch(`${FAKE}/__log`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 25000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Wachten op ${what} duurde te lang`);
    await sleep(300);
  }
}

/** Speelt één stap; bij een beurt leest hij de NDJSON-stream. */
async function turn(runId, { abortAfter } = {}) {
  const ctrl = new AbortController();
  const res = await fetch(`${APP}/api/runs/${runId}/turn`, { method: "POST", headers: { cookie }, signal: ctrl.signal });
  if (res.headers.get("content-type")?.includes("application/json")) return { json: await res.json() };
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) events.push(JSON.parse(line));
      }
      if (abortAfter && events.filter((e) => e.t === "delta").length >= abortAfter) {
        ctrl.abort();
        break;
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  }
  return { events };
}

const run = {};

await step("Inloggen: foute pincode geeft een nette melding", async () => {
  const r = await call("/api/login", { method: "POST", json: { password: "nee" }, noAuth: true });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /pincode klopt niet/);
  assert.ok(r.data.oplossing);
});

await step("Zonder inloggen geen toegang tot de API", async () => {
  const r = await call("/api/runs", { noAuth: true });
  assert.equal(r.status, 401);
});

await step("Inloggen met de juiste pincode", async () => {
  const r = await call("/api/login", { method: "POST", json: { password: "test123" }, noAuth: true, raw: true });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
});

await step("Zonder sleutels: lampje in de navigatie en duidelijke fout bij samenstellen", async () => {
  const s = await call("/api/settings/status");
  assert.equal(s.data.aiKey, false);
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Test?" } });
  assert.equal(c.status, 400);
  assert.match(c.data.error, /geen AI-sleutel/);
});

const KEYS = {
  anthropic: "sk-ant-api03-" + "a".repeat(40),
  openai: "sk-proj-" + "b".repeat(40),
  google: "AIza" + "c".repeat(35),
  xai: "xai-" + "d".repeat(40),
  elevenlabs: "sk_" + "e".repeat(48),
};

await step("Sleutels plakken: aanbieder wordt automatisch herkend", async () => {
  for (const [provider, key] of Object.entries(KEYS)) {
    const r = await call("/api/settings", { method: "POST", json: { auto: key } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.detected, provider);
    assert.ok(r.data.keys[provider].includes("…"), "sleutel wordt gemaskeerd getoond");
    assert.ok(!JSON.stringify(r.data).includes(key), "volledige sleutel komt nooit terug");
  }
  const bad = await call("/api/settings", { method: "POST", json: { auto: "hallo" } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /niet herkennen|herkennen deze sleutel niet/);
});

await step("Verbindingstest per aanbieder, uitslag wordt onthouden", async () => {
  for (const provider of Object.keys(KEYS)) {
    const r = await call("/api/settings/test", { method: "POST", json: { provider } });
    assert.equal(r.data.ok, true, `${provider}: ${JSON.stringify(r.data)}`);
  }
  const wrong = await call("/api/settings/test", { method: "POST", json: { provider: "anthropic", key: "sk-ant-fout" } });
  assert.equal(wrong.data.ok, false);
  assert.equal(wrong.data.error, "Anthropic accepteert deze sleutel niet.");
  const x = await call("/api/settings/test", { method: "POST", json: { provider: "xai", key: "sk-pil" + "x".repeat(40) } });
  assert.equal(x.data.ok, false);
  assert.equal(x.data.error, "xAI accepteert deze sleutel niet.");
  assert.match(x.data.oplossing, /OpenAI.*"xai-"/);
  const s = await call("/api/settings");
  for (const p of Object.keys(KEYS)) assert.equal(s.data.status[p].ok, true, `${p} status bewaard`);
  assert.match(s.data.status.google.melding, /modellen beschikbaar/);
  const byKey = Object.fromEntries(s.data.models.map((m) => [m.key, m.model]));
  assert.equal(byKey["gemini-sterk"], "gemini-3-pro-preview", "Gemini: onbekende naam vervangen door het beste beschikbare model");
  assert.equal(byKey["gemini-snel"], "gemini-2.5-flash", "Gemini snel: geen lite of image");
  assert.equal(byKey["claude-sterk"], "claude-opus-5-5", "bestaande namen blijven staan");
  const st = await call("/api/settings/status");
  assert.equal(st.data.aiKey, true);
});

await step("Bijlages uploaden: tekst en afbeelding", async () => {
  const fd = new FormData();
  fd.append("file", new Blob(["maand;omzet\njan;100\nfeb;120"], { type: "text/csv" }), "omzet.csv");
  const a = await call("/api/attachments", { method: "POST", form: fd });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const fd2 = new FormData();
  fd2.append("file", new Blob([Buffer.from("iVBORw0KGgo=", "base64")], { type: "image/png" }), "grafiek.png");
  const b = await call("/api/attachments", { method: "POST", form: fd2 });
  assert.equal(b.status, 200);
  const fd3 = new FormData();
  fd3.append("file", new Blob(["x"], { type: "application/zip" }), "archief.zip");
  const c = await call("/api/attachments", { method: "POST", form: fd3 });
  assert.equal(c.status, 400);
  assert.match(c.data.oplossing, /pdf, docx/);
  run.attachments = [a.data.attachment.id, b.data.attachment.id];
});

await step("Stel samen: gemengde AI's, clichés, stemmen en bijlages", async () => {
  const t = Date.now();
  const r = await call("/api/compose", {
    method: "POST",
    json: { modus: "vergadering", question: "Moeten we de prijzen met 10% verhogen? Graag met vergaderclichés.", attachmentIds: run.attachments },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Date.now() - t < 5000, "voorstel binnen 5 seconden");
  const cast = r.data.run.cast;
  assert.ok(cast.rollen.every((x) => !/\b(dr|mr|prof|ir|drs)\./i.test(x.naam)), "geen titels in namen");
  assert.equal(cast.stemmen, "uit", "stemmen staan standaard uit");
  assert.ok(cast.rollen.every((x) => x.stemId), "maar iedereen heeft wel een stem klaarstaan");
  run.id = r.data.run.id;
  run.cast = cast;
  const debaters = cast.rollen.filter((x) => !x.isJury);
  assert.equal(cast.rollen.filter((x) => x.isJury).length, 1);
  assert.ok(debaters.length >= 3 && debaters.length <= 4);
  assert.equal(debaters.filter((x) => x.isKritisch).length, 1);
  const providers = new Set(cast.rollen.map((x) => x.modelKey.split("-")[0]));
  assert.ok(providers.size >= 3, `mix van AI's: ${[...providers]}`);
  assert.equal(cast.cliches, true);
  assert.ok(debaters.filter((x) => x.cliche).length >= 2, "minstens twee clichés");
  assert.ok(!cast.rollen.find((x) => x.isJury).cliche, "Jury speelt geen cliché");
  assert.equal(new Set(cast.rollen.map((x) => x.stemId)).size, cast.rollen.length, "iedereen een andere stem");
  assert.ok(cast.rollen.every((x) => x.stemId?.startsWith("nl")), `alleen Nederlandse stemmen: ${cast.rollen.map((x) => x.stemId)}`);
  assert.equal(cast.bijlages[run.attachments[0]], "cfo");
  assert.ok(!cast.rollen.some((x) => x.ongezouten), "Grok standaard gecensureerd");
  const gem = cast.rollen.find((x) => x.modelKey.startsWith("gemini"));
  assert.equal(gem.webzoeken, false, "Gemini kan niet webzoeken");
});

await step("Achtergrond: portretten (3 stemmingen) en huiswerk met bronnen", async () => {
  const d = await waitFor(async () => {
    const r = await call(`/api/runs/${run.id}`);
    const prep = r.data.run.prep;
    const ok = r.data.run.cast.rollen.every(
      (x) => prep[x.id]?.portraitStatus === "klaar" && (x.isJury || prep[x.id]?.homeworkStatus === "klaar"),
    );
    return ok && r.data;
  }, "portretten en huiswerk");
  for (const x of d.run.cast.rollen) {
    const p = d.run.prep[x.id].portraits;
    assert.ok(p.neutraal && p.sceptisch && p.enthousiast, `3 portretten voor ${x.naam}`);
  }
  const cfo = d.run.prep.cfo;
  assert.ok(cfo.facts.length > 0, "CFO heeft feiten");
  assert.ok(cfo.looking.some((l) => l.startsWith("Zoekt:")), "live zichtbaar wat de CFO zoekt");
  const img = await fetch(d.run.prep.cfo.portraits.neutraal);
  assert.equal(img.status, 200);
  const kinds = new Set(d.usage.perKind.map((k) => k.label));
  assert.ok(kinds.has("Portretten") && kinds.has("Huiswerk") && kinds.has("Team samenstellen"), [...kinds].join(","));
});

await step("Stemmen: Nederlandse stemmen herkend, eigen keuze mogelijk, stem voor de baas", async () => {
  const v = await call("/api/voices");
  assert.equal(v.data.voices.length, 10);
  assert.deepEqual(v.data.voices.filter((x) => x.nl).map((x) => x.id).sort(), ["nlAnna", "nlBram", "nlCarla", "nlDaan", "nlEva"]);
  assert.deepEqual(v.data.voices.filter((x) => x.vlaams).map((x) => x.id).sort(), ["beFrank", "beLies"], "Vlaamse stemmen herkend");
  assert.ok(v.data.inUse.every((id) => id.startsWith("nl")), "automatisch alleen Nederlandse, geen Vlaamse");
  assert.equal(v.data.uitspraak, "nederlands", "standaard de beste Nederlandse uitspraak");
  const pick = await call("/api/voices", { method: "POST", json: { ids: ["nlAnna", "nlBram"] } });
  assert.deepEqual(pick.data.inUse.sort(), ["nlAnna", "nlBram"]);
  const back = await call("/api/voices", { method: "POST", json: { ids: [] } });
  assert.equal(back.data.inUse.length, 5);
  const r = await call(`/api/runs/${run.id}`);
  const stemmen = r.data.stemmen;
  assert.ok(stemmen.baas, "de baas heeft een stem");
  assert.equal(new Set(Object.values(stemmen)).size, Object.keys(stemmen).length, "iedereen een eigen stem");
});

await step("Persona aanpassen: naam, instructie en stem", async () => {
  const r = await call(`/api/runs/${run.id}`);
  const cast = r.data.run.cast;
  const rollen = cast.rollen.map((x) => (x.id === "cfo" ? { ...x, naam: "Pieter de Groot", instructie: "Praat kortaf en droog.", stemId: "nlDaan" } : x));
  const p = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { handmatig: true, cast: { ...cast, rollen } } });
  const cfo = p.data.run.cast.rollen.find((x) => x.id === "cfo");
  assert.equal(cfo.instructie, "Praat kortaf en droog.");
  assert.equal(cfo.stemId, "nlDaan");
  const portrait = await call(`/api/runs/${run.id}/portrait`, { method: "POST", json: { roleId: "cfo" } });
  assert.equal(portrait.status, 200);
  await waitFor(async () => (await call(`/api/runs/${run.id}`)).data.run.prep.cfo.portraitStatus === "klaar", "nieuw portret");
  run.cast = p.data.run.cast;
});

await step("Aanpassen via chat: Grok ongecensureerd en 3 rondes", async () => {
  const r = await call(`/api/runs/${run.id}/chat`, { method: "POST", json: { text: "Maak Grok ongecensureerd en doe 3 rondes", chat: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.antwoord, /3 rondes/);
  const grok = r.data.run.cast.rollen.find((x) => x.modelKey.startsWith("grok"));
  assert.equal(grok.ongezouten, true);
  assert.equal(r.data.run.cast.rondes, 3);
  run.cast = r.data.run.cast;
});

await step("Geavanceerd: clichés uit/aan, ongecensureerd bij elke deelnemer", async () => {
  const off = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: { ...run.cast, cliches: false } } });
  assert.ok(off.data.run.cast.rollen.every((x) => !x.cliche));
  const on = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: { ...off.data.run.cast, cliches: true } } });
  assert.ok(on.data.run.cast.rollen.filter((x) => x.cliche).length >= 2, "clichés automatisch uitgedeeld");
  const claude = on.data.run.cast.rollen.find((x) => x.modelKey.startsWith("claude"));
  const trick = { ...on.data.run.cast, rollen: on.data.run.cast.rollen.map((x) => (x.id === claude.id ? { ...x, ongezouten: true } : x)) };
  const t = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: trick } });
  assert.equal(t.data.run.cast.rollen.find((x) => x.id === claude.id).ongezouten, true, "ook Claude kan ongecensureerd");
  run.cast = t.data.run.cast;
});

await step("Fun-modus: één schakelaar zet clichés en karikaturen aan of uit", async () => {
  assert.equal(run.cast.fun, true, "gevraagd om clichés = fun-modus");
  const imgs = async () => (await fakeLog()).filter((l) => l.provider === "openai-image").length;
  const before = await imgs();
  const off = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: { ...run.cast, fun: false } } });
  assert.equal(off.data.run.cast.fun, false);
  assert.ok(off.data.run.cast.rollen.every((x) => !x.cliche), "serieus: geen clichés");
  await waitFor(async () => (await imgs()) > before, "nieuwe, nette portretten");
  const on = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: { ...off.data.run.cast, fun: true } } });
  assert.equal(on.data.run.cast.fun, true);
  assert.ok(on.data.run.cast.rollen.filter((x) => x.cliche).length >= 2, "fun: clichés uitgedeeld");
  const keep = on.data.run.cast.rollen.map((x) => x.id === run.cast.rollen.find((r) => r.ongezouten)?.id ? { ...x, ongezouten: true } : x);
  const t = await call(`/api/runs/${run.id}`, { method: "PATCH", json: { cast: { ...on.data.run.cast, rollen: keep } } });
  run.cast = t.data.run.cast;
});

await step("Start debat en ronde 1: iedereen eens → verdacht eensgezind, extra beurt kritische rol", async () => {
  await call(`/api/runs/${run.id}/start`, { method: "POST" });
  const opening = await turn(run.id);
  const os = opening.events.find((e) => e.t === "start");
  assert.equal(os.step.meta.opening, true, "de voorzitter opent de vergadering");
  assert.equal(os.message.role_id, run.cast.rollen.find((x) => x.isJury).id);
  assert.ok((await fakeLog()).some((l) => /opent hem hardop/.test(l.user ?? "")), "opening-instructie verstuurd");
  const debaters = run.cast.rollen.filter((x) => !x.isJury);
  for (let i = 0; i < debaters.length; i++) {
    const t = await turn(run.id);
    const start = t.events.find((e) => e.t === "start");
    assert.ok(start, JSON.stringify(t));
    assert.equal(t.events.find((e) => e.t === "tag")?.tag, "akkoord");
    const end = t.events.find((e) => e.t === "end");
    assert.ok(!end.message.content.startsWith("["), "tag is verborgen");
    assert.deepEqual(end.message.sources, ["CBS"], "bron als label");
    assert.ok(!end.message.content.includes("(bron:"), "bron uit de tekst gehaald");
  }
  const extra = await turn(run.id);
  const s = extra.events.find((e) => e.t === "start");
  assert.equal(s.step.meta.extra, "eensgezind");
  assert.equal(s.message.role_id, run.cast.rollen.find((x) => x.isKritisch).id);
});

await step("Hamer: besluit, volgende beurt gaat ervan uit", async () => {
  const r = await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "hamer", text: "We verhogen niet vóór juni" } });
  assert.equal(r.status, 200);
  const empty = await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "hamer", text: "" } });
  assert.equal(empty.status, 400);
  assert.match(empty.data.oplossing, /besluit/);
  const t = await turn(run.id);
  assert.ok(t.events.find((e) => e.t === "end"));
  const last = (await fakeLog()).filter((l) => l.user?.includes("Ronde 2 van 3")).at(-1);
  assert.match(last.user, /BESLOTEN DOOR DE BAAS[\s\S]*We verhogen niet vóór juni/);
  assert.match(last.user, /De baas heeft net besloten: "We verhogen niet vóór juni"/);
});

await step("Vraag aan één rol: die rol antwoordt direct", async () => {
  const target = run.cast.rollen.find((x) => x.isKritisch).id;
  await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "vraag", text: "Wat is voor jou de pijngrens?", target } });
  const t = await turn(run.id);
  const s = t.events.find((e) => e.t === "start");
  assert.equal(s.message.role_id, target);
  assert.equal(s.step.meta.answer, true);
});

await step("Hand opsteken midden in een beurt: tekst tot dan toe wordt bewaard als onderbroken", async () => {
  await turn(run.id, { abortAfter: 2 });
  await sleep(600);
  const r = await call(`/api/runs/${run.id}`);
  const last = r.data.messages.filter((m) => m.kind === "turn").at(-1);
  assert.equal(last.meta.interrupted, true, JSON.stringify(last.meta));
  assert.equal(last.meta.streaming, false);
  assert.ok(last.content.length > 0);
  await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "opmerking", text: "Denk aan de contracten tot juni" } });
});

await step("Model valt uit: een ander model neemt het over", async () => {
  const grok = run.cast.rollen.find((x) => x.modelKey.startsWith("grok"));
  await fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify({ provider: "xai", status: 500, times: 50, path: "/chat" }) });
  await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "vraag", text: "Wat vind jij?", target: grok.id } });
  const t = await turn(run.id);
  await fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify({ provider: "xai", status: 500, times: 0 }) });
  const end = t.events.find((e) => e.t === "end");
  assert.ok(end, `beurt lukte toch: ${JSON.stringify(t.events.find((e) => e.t === "error"))}`);
  assert.equal(end.message.meta.fallback?.van, "Grok");
  assert.notEqual(end.message.meta.fallback?.naar, "Grok");
  assert.equal(end.message.role_id, grok.id, "de vervanger sprak namens de Grok-rol");
});

await step("Prompts: ongecensureerd, clichés, prompt caching", async () => {
  const log = await fakeLog();
  assert.ok(!log.some((l) => l.unknownModel), "geen verzoeken met een onbekende modelnaam");
  assert.ok(log.some((l) => l.provider === "google" && l.model === "gemini-3-pro-preview"), "Gemini met de juiste naam");
  const turns = log.filter((l) => /Ronde \d van/.test(l.user ?? ""));
  const grokRole = run.cast.rollen.find((x) => x.modelKey.startsWith("grok"));
  const isGrokRole = (l) => l.system.includes(`Naam: ${grokRole.naam}`);
  const grokTurns = turns.filter(isGrokRole);
  assert.ok(grokTurns.some((l) => l.provider === "xai"), "Grok heeft gesproken");
  assert.ok(grokTurns.every((l) => l.system.includes("ONGECENSUREERD (")), "de Grok-persona is ongecensureerd, ook als een vervanger spreekt");
  const spicy = new Set(run.cast.rollen.filter((x) => x.ongezouten && !x.isJury).map((x) => `Naam: ${x.naam}`));
  const isSpicy = (l) => [...spicy].some((n) => l.system.includes(n));
  assert.ok(turns.filter((l) => !isSpicy(l)).every((l) => !l.system.includes("ONGECENSUREERD (")), "wie netjes staat, blijft netjes");
  assert.ok(turns.filter(isSpicy).every((l) => /ONGECENSUREERD:/.test(l.user)), "ook in elke beurt herinnerd");
  const juryRole = run.cast.rollen.find((x) => x.isJury);
  assert.ok(log.filter((l) => l.system?.includes(`Naam: ${juryRole.naam}`)).every((l) => !l.system.includes("ONGECENSUREERD (")), "de Jury blijft netjes");
  assert.ok(turns.some((l) => l.system.includes("JE VERGADERCLICHÉ")), "cliché in de rolinstructie");
  assert.ok(turns.every((l) => l.system.includes("ZO PRAAT JE") && l.system.includes("Nederlandse bedrijven")), "spreektaal en Nederlandse context");
  const claude = turns.filter((l) => l.provider === "anthropic");
  assert.ok(claude.length && claude.every((l) => l.hasCache), "Claude-beurten gebruiken cache_control");
  const gpt = log.filter((l) => l.provider === "openai" && l.stream && /Ronde/.test(l.user ?? ""));
  assert.ok(gpt.every((l) => l.cacheKey), "GPT-beurten hebben een prompt_cache_key");
});

await step("Afronden → laatste woord → advies voorzitter → resultaat", async () => {
  await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "afronden" } });
  const fw = await turn(run.id);
  assert.equal(fw.json.step.type, "final_word");
  await call(`/api/runs/${run.id}/boss`, { method: "POST", json: { action: "laatste_woord", text: "Let vooral op de kosten" } });
  const verdict = await turn(run.id);
  const s = verdict.events.find((e) => e.t === "start");
  assert.equal(s.step.meta.verdict, true);
  run.verdictId = s.message.id;
  const next = await turn(run.id);
  assert.equal(next.json.step.type, "result");
  const r = await call(`/api/runs/${run.id}/result`, { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.result.besluitenVanDeBaas, ["We verhogen niet vóór juni"]);
  const juryReq = (await fakeLog()).filter((l) => l.schemaProps?.includes("uitslag")).at(-1);
  assert.match(juryReq.user, /vergadercliché/, "Jury weet van de clichés");
  const again = await turn(run.id);
  assert.equal(again.json.step.type, "done");
});

await step("Hamvraag: blind vergelijken met één vraag aan het slimste model", async () => {
  const before = (await call(`/api/runs/${run.id}`)).data.run.cost_eur;
  const v = await call(`/api/runs/${run.id}/vergelijk`, { method: "POST", json: {} });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.match(v.data.vergelijking.advies.uitslag, /nieuwe klanten/);
  assert.ok(["debat", "enkel"].includes(v.data.vergelijking.aIs), "willekeurige volgorde");
  assert.ok(!v.data.vergelijking.keuze, "nog niet gekozen");
  const req = (await fakeLog()).filter((l) => l.schemaProps?.includes("uitslag") && !l.schemaProps.includes("besluitenVanDeBaas")).at(-1);
  assert.equal(req.model, "claude-opus-5-5", "het slimste Claude-model");
  assert.match(req.user, /We verhogen niet vóór juni/, "met dezelfde vaststaande besluiten");
  const again = await call(`/api/runs/${run.id}/vergelijk`, { method: "POST", json: {} });
  assert.equal(again.data.vergelijking.advies.uitslag, v.data.vergelijking.advies.uitslag, "maar één keer betalen");
  const k = await call(`/api/runs/${run.id}/vergelijk`, { method: "POST", json: { keuze: "debat" } });
  assert.equal(k.data.vergelijking.keuze, "debat");
  const list = await call("/api/runs");
  assert.equal(list.data.runs.find((x) => x.id === run.id).keuze, "debat", "telt mee in de geschiedenis");
  const after = (await call(`/api/runs/${run.id}`)).data;
  assert.ok(after.run.cost_eur > before, "kosten van de vergelijking tellen mee");
  assert.ok(after.usage.perKind.some((x) => x.label === "Vergelijking (één vraag)"));
});

await step("Slimheid: vlot, slim en slimst kiezen andere modellen; de voorzitter blijft de sterkste", async () => {
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Nieuwe leverancier kiezen?" } });
  const id = c.data.run.id;
  assert.equal(c.data.run.cast.niveau, "slim");
  const tierOf = (key) => (key.endsWith("-snel") ? "snel" : "sterk");
  assert.ok(c.data.run.cast.rollen.filter((r) => !r.isJury).every((r) => tierOf(r.modelKey) === "sterk"), "slim = sterkste modellen");
  const vlot = await call(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...c.data.run.cast, niveau: "vlot" } } });
  assert.ok(vlot.data.run.cast.rollen.filter((r) => !r.isJury).every((r) => r.modelKey.endsWith("-snel")), "vlot = snelle modellen");
  const jury = vlot.data.run.cast.rollen.find((r) => r.isJury);
  assert.match(jury.modelKey, /sterk/, "de voorzitter blijft het sterkste model");
  const providers = (cast) => cast.rollen.map((r) => r.modelKey.split("-")[0]).join(",");
  assert.equal(providers(vlot.data.run.cast), providers(c.data.run.cast), "iedereen houdt zijn eigen AI");
  const slimst = await call(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...vlot.data.run.cast, niveau: "slimst" } } });
  assert.equal(slimst.data.run.cast.niveau, "slimst");
  await call(`/api/runs/${id}/start`, { method: "POST" });
  await fetch(`${FAKE}/__reset`);
  for (let i = 0; i < 4; i++) await turn(id);
  const log = await fakeLog();
  const deep = log.filter((l) => /Ronde \d van/.test(l.user ?? "") && l.provider === "anthropic");
  const gpt = log.filter((l) => /Ronde \d van/.test(l.user ?? "") && l.provider === "openai");
  assert.ok(deep.length + gpt.length > 0, "er spraken Claude- of GPT-rollen");
  assert.ok(deep.every((l) => l.effort === "medium") && gpt.every((l) => l.reasoning === "medium"), "slimst denkt langer na");
  await call(`/api/runs/${id}`, { method: "DELETE" });
});

await step("Tokens en kosten per debat kloppen", async () => {
  const r = await call(`/api/runs/${run.id}`);
  const u = r.data.usage;
  assert.ok(u.total.inputTokens > 0 && u.total.outputTokens > 0 && u.total.cachedTokens > 0);
  const kinds = u.perKind.map((k) => k.label);
  for (const k of ["Team samenstellen", "Team aanpassen (chat)", "Portretten", "Huiswerk", "Debatbeurten", "Slotadvies van de voorzitter"]) {
    assert.ok(kinds.includes(k), `onderdeel ${k} ontbreekt in ${kinds}`);
  }
  for (const x of run.cast.rollen) assert.ok(u.perRole.some((p) => p.roleId === x.id), `verbruik voor ${x.naam}`);
  const providers = new Set(u.perModel.map((m) => m.provider));
  for (const p of ["anthropic", "openai", "google", "xai"]) assert.ok(providers.has(p), `model van ${p}`);
  // Achtergrondtaken (hoogtepunten) kunnen nog lopen: wacht tot de optelsom en het debattotaal gelijk zijn.
  await waitFor(async () => {
    const x = (await call(`/api/runs/${run.id}`)).data;
    return x.run.highlights && Math.abs(x.usage.total.costEur - x.run.cost_eur) < 0.00002;
  }, "kosten optellen tot het debattotaal", 10000);
  const list = await call("/api/runs");
  assert.ok(list.data.runs.find((x) => x.id === run.id).tokens > 1000);
  const settings = await call("/api/settings");
  assert.ok(settings.data.usage.xai.tokens > 0, "verbruik per aanbieder bij Instellingen");
});

await step("Stem: ElevenLabs-audio wordt per zin gecachet", async () => {
  const body = { runId: run.id, messageId: run.verdictId, idx: 0, text: "Mijn uitspraak.", voiceId: "nlAnna" };
  const r = await fetch(`${APP}/api/tts`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(r.headers.get("content-type"), "audio/mpeg");
  assert.equal((await r.arrayBuffer()).byteLength, 2048);
  await waitFor(async () => (await call(`/api/runs/${run.id}`)).data.messages.find((m) => m.id === run.verdictId).audio.length === 1, "audio opgeslagen");
  const again = await fetch(`${APP}/api/tts`, { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(again.status, 302, "tweede keer uit de cache");
  const u = (await call(`/api/runs/${run.id}`)).data.usage;
  assert.ok(u.perKind.some((k) => k.label === "Stemmen"));
  const tts = (await fakeLog()).filter((l) => l.provider === "elevenlabs");
  assert.equal(tts.at(-1).model, "eleven_multilingual_v2", "Nederlands accent-model");
  await call("/api/voices", { method: "POST", json: { uitspraak: "snel" } });
  const fast = await fetch(`${APP}/api/tts`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ ...body, idx: 1 }) });
  await fast.arrayBuffer();
  assert.equal((await fakeLog()).filter((l) => l.provider === "elevenlabs").at(-1).model, "eleven_flash_v2_5");
  await call("/api/voices", { method: "POST", json: { uitspraak: "nederlands" } });
});

await step("De hele vergadering als mp3", async () => {
  const r = await fetch(`${APP}/api/runs/${run.id}/audio`, { headers: { cookie } });
  assert.equal(r.headers.get("content-type"), "audio/mpeg");
  assert.match(r.headers.get("content-disposition") ?? "", /attachment/);
  const size = (await r.arrayBuffer()).byteLength;
  const msgs = (await call(`/api/runs/${run.id}`)).data.messages.filter((m) => (m.kind === "turn" || m.kind === "boss") && m.content);
  const parts = msgs.reduce((n, m) => n + m.audio.length, 0);
  assert.equal(size, parts * 2048, "alle stukken van elk bericht, in volgorde");
  assert.ok(msgs.every((m) => m.audio.length), "alle audio is nu bewaard");
  const said = (await fakeLog()).filter((l) => l.provider === "elevenlabs");
  assert.ok(said.every((l) => !/\*[^*]+\*/.test(l.text)), "regieaanwijzingen niet uitgesproken");
});

await step("Hoogtepunten worden op de achtergrond gekozen", async () => {
  const h = await waitFor(async () => (await call(`/api/runs/${run.id}`)).data.run.highlights, "hoogtepunten");
  assert.ok(h.length >= 3 && h.length <= 4);
});

await step("Tik een rol aan: kort zinnetje in karakter", async () => {
  const r = await call(`/api/runs/${run.id}/quip`, { method: "POST", json: { roleId: "cfo" } });
  assert.equal(r.data.text, "Ik zit hier heus wel op te letten.");
});

await step("Delen: anoniem, weggepoetst, publieke replay en kaart", async () => {
  const s = await call(`/api/runs/${run.id}/share`, { method: "POST", json: { publish: true, anonymous: true, redactions: ["zes procent"] } });
  run.token = s.data.token;
  assert.ok(run.token);
  const page = await call(`/replay/${run.token}`, { noAuth: true });
  assert.equal(page.status, 200);
  const og = page.data.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  assert.ok(og?.startsWith("http://127.0.0.1:3200/api/public/card/"), `volledig og:image-adres, kreeg ${og}`);
  assert.ok(!page.data.includes("Pieter de Groot"), "namen anoniem");
  assert.ok(!page.data.includes("zes procent"), "woorden weggepoetst");
  assert.ok(!page.data.includes("instructie\":\"Geen complimenten"), "instructies niet publiek");
  for (const f of ["square", "story"]) {
    const c = await fetch(`${APP}/api/public/card/${run.token}?format=${f}`);
    assert.equal(c.headers.get("content-type"), "image/png");
    assert.ok((await c.arrayBuffer()).byteLength > 10000, `kaart ${f}`);
  }
  const priv = await call(`/api/runs/${run.id}/card`, { noAuth: true });
  assert.equal(priv.status, 401);
  await call(`/api/runs/${run.id}/share`, { method: "DELETE" });
  const gone = await call(`/replay/${run.token}`, { noAuth: true });
  assert.equal(gone.status, 404);
});

await step("Team bewaren en hergebruiken: direct klaar, portretten hergebruikt", async () => {
  const t = await call("/api/templates", { method: "POST", json: { runId: run.id } });
  assert.equal(t.status, 200);
  await fetch(`${FAKE}/__reset`);
  const r = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Nieuwe vraag", templateId: t.data.template.id } });
  assert.equal(r.status, 200);
  await sleep(1500);
  const log = await fakeLog();
  assert.equal(log.filter((l) => l.provider === "openai-image").length, 0, "geen nieuwe portretten");
  assert.ok(!log.some((l) => l.schemaProps?.includes("rollen")), "geen AI-call voor samenstellen");
  run.second = r.data.run.id;
});

await step("Vergadering beëindigen zonder uitspraak, en later alsnog laten oordelen", async () => {
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Snel een tweede vergadering" } });
  const id = c.data.run.id;
  await call(`/api/runs/${id}/start`, { method: "POST" });
  await turn(id);
  const s = await call(`/api/runs/${id}/stop`, { method: "POST" });
  assert.equal(s.data.status, "stopped");
  const next = await turn(id);
  assert.equal(next.json.step.type, "done", "na stoppen praat niemand meer");
  const list = await call("/api/runs");
  assert.equal(list.data.runs.find((x) => x.id === id).status, "stopped");
  const r = await call(`/api/runs/${id}/result`, { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal((await call(`/api/runs/${id}`)).data.run.status, "done");
  await call(`/api/runs/${id}`, { method: "DELETE" });
});

await step("Voorzitter: nooit ongecensureerd, altijd een sterk model (geen Grok)", async () => {
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Budget en jury testen" } });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const jury = c.data.run.cast.rollen.find((x) => x.isJury);
  assert.ok(!jury.modelKey.startsWith("grok"), "Jury is geen Grok");
  assert.ok(!jury.ongezouten);
  assert.equal(c.data.run.cast.kostenlimiet, 2, "standaardlimiet €2");
  const trick = { ...c.data.run.cast, rollen: c.data.run.cast.rollen.map((x) => (x.isJury ? { ...x, ongezouten: true, modelKey: "grok-sterk" } : x)) };
  const t = await call(`/api/runs/${c.data.run.id}`, { method: "PATCH", json: { handmatig: true, cast: trick } });
  const j = t.data.run.cast.rollen.find((x) => x.isJury);
  assert.equal(j.ongezouten, false, "Jury kan niet ongecensureerd");
  assert.ok(!j.modelKey.startsWith("grok"), "Jury wordt geen Grok");
  assert.match(j.modelKey, /sterk/, "Jury krijgt een sterk model");
  run.budget = c.data.run.id;
});

await step("Kostenlimiet: stopt nieuwe beurten, ophogen gaat door, afronden mag nog", async () => {
  const id = run.budget;
  const cost = await waitFor(async () => {
    const r = await call(`/api/runs/${id}`);
    return r.data.run.cost_eur >= 0.01 && r.data.run;
  }, "kosten van de voorbereiding");
  const low = await call(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...cost.cast, kostenlimiet: 0.01 } } });
  assert.equal(low.data.run.cast.kostenlimiet, 0.01);
  await call(`/api/runs/${id}/start`, { method: "POST" });
  const stop = await turn(id);
  assert.equal(stop.json?.step?.type, "budget", JSON.stringify(stop));
  assert.equal(stop.json.step.limit, 0.01);
  const quip = await call(`/api/runs/${id}/quip`, { method: "POST", json: { roleId: low.data.run.cast.rollen[0].id } });
  assert.equal(quip.status, 402);
  assert.match(quip.data.error ?? quip.data.message ?? JSON.stringify(quip.data), /kostenlimiet/);
  const up = await call(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...low.data.run.cast, kostenlimiet: 50 } } });
  assert.equal(up.data.run.cast.kostenlimiet, 50);
  const go = await turn(id);
  assert.ok(go.events?.find((e) => e.t === "end"), "na ophogen gaat het debat door");
  await call(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...up.data.run.cast, kostenlimiet: 0.01 } } });
  assert.equal((await turn(id)).json.step.type, "budget");
  await call(`/api/runs/${id}/boss`, { method: "POST", json: { action: "afronden" } });
  assert.equal((await turn(id)).json.step.type, "final_word");
  await call(`/api/runs/${id}/boss`, { method: "POST", json: { action: "laatste_woord", text: "Graag een helder besluit" } });
  const verdict = await turn(id);
  assert.equal(verdict.events?.find((e) => e.t === "start")?.step.meta.verdict, true, "de voorzitter mag boven de limiet nog afronden");
  const r = await call(`/api/runs/${id}/result`, { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await call(`/api/runs/${id}`, { method: "DELETE" });
});

await step("Alleen het advies: de server speelt de hele vergadering af", async () => {
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Moeten we op zondag open?" } });
  const id = c.data.run.id;
  await call(`/api/runs/${id}/start`, { method: "POST" });
  const a = await call(`/api/runs/${id}/autorun`, { method: "POST" });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const t = await turn(id);
  assert.ok(t.json?.busy || t.json?.step, "de browser speelt niet mee zolang de server bezig is");
  const done = await waitFor(async () => {
    const r = await call(`/api/runs/${id}`);
    return r.data.run.status === "done" && r.data;
  }, "het advies", 60000);
  assert.ok(done.run.result?.uitslag, "er is een advies");
  const turns = done.messages.filter((m) => m.kind === "turn");
  assert.ok(turns[0].meta.opening, "begint met de opening");
  assert.ok(turns.at(-1).meta.verdict, "eindigt met het slotadvies");
  assert.equal(turns.filter((m) => !m.meta.opening && !m.meta.verdict && !m.meta.extra).length, done.run.cast.rollen.filter((r) => !r.isJury).length * done.run.cast.rondes, "alle rondes gespeeld");
  assert.ok(!turns.some((m) => m.meta.streaming || m.meta.interrupted), "geen halve beurten");
  await call(`/api/runs/${id}`, { method: "DELETE" });
});

await step("Alleen het advies: bij de kostenlimiet rondt de voorzitter vanzelf af", async () => {
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Nieuwe koffieautomaat?" } });
  const id = c.data.run.id;
  const cur = await waitFor(async () => {
    const r = await call(`/api/runs/${id}`);
    return r.data.run.cost_eur >= 0.01 && r.data.run;
  }, "kosten van de voorbereiding");
  await call(`/api/runs/${id}`, { method: "PATCH", json: { cast: { ...cur.cast, kostenlimiet: 0.01 } } });
  await call(`/api/runs/${id}/start`, { method: "POST" });
  await call(`/api/runs/${id}/autorun`, { method: "POST" });
  const done = await waitFor(async () => {
    const r = await call(`/api/runs/${id}`);
    return r.data.run.status === "done" && r.data;
  }, "het advies", 60000);
  assert.ok(done.messages.some((m) => m.kind === "system" && m.meta.wrapUp && m.meta.budget), "afgerond vanwege het budget");
  assert.ok(done.run.result, "toch een advies");
  await call(`/api/runs/${id}`, { method: "DELETE" });
});

await step("Alleen het advies: toch meekijken stopt de server, de arena neemt het over", async () => {
  const c = await call("/api/compose", { method: "POST", json: { modus: "vergadering", question: "Vierdaagse werkweek?" } });
  const id = c.data.run.id;
  await call(`/api/runs/${id}/start`, { method: "POST" });
  await call(`/api/runs/${id}/autorun`, { method: "POST" });
  await call(`/api/runs/${id}/autorun`, { method: "DELETE" });
  await sleep(1500);
  const before = (await call(`/api/runs/${id}`)).data;
  assert.notEqual(before.run.status, "done", "de server is gestopt");
  const t = await waitFor(async () => {
    const x = await turn(id);
    return x.events ? x : null;
  }, "een beurt vanuit de arena");
  assert.ok(t.events.find((e) => e.t === "end"), "de arena speelt weer zelf");
  await call(`/api/runs/${id}`, { method: "DELETE" });
});

await step("Review-keten: samenstellen met vragen vooraf, zonder portretten of stemmen", async () => {
  await fetch(`${FAKE}/__reset`);
  const c = await call("/api/compose", { method: "POST", json: { question: "Moeten we dynamische prijzen invoeren op onze parken?" } });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const cast = c.data.run.cast;
  assert.equal(cast.modus, "keten", "de review-keten is de standaard");
  assert.equal(cast.stemmen, "uit");
  assert.equal(cast.rondes, 2);
  assert.deepEqual(cast.intake.map((x) => x.vraag), ["Wat is het maximale budget?", "Wanneer moet het besluit vallen?"]);
  const intake = cast.intake.map((x, i) => ({ ...x, antwoord: i === 0 ? "Maximaal €80.000" : "" }));
  const p = await call(`/api/runs/${c.data.run.id}`, { method: "PATCH", json: { cast: { ...cast, intake, randvoorwaarden: ["Geen prijsverhoging voor vaste gasten dit jaar"] } } });
  assert.equal(p.data.run.cast.randvoorwaarden[0], "Geen prijsverhoging voor vaste gasten dit jaar");
  await sleep(1500);
  assert.equal((await fakeLog()).filter((l) => l.provider === "openai-image").length, 0, "geen portretten in de keten");
  run.keten = c.data.run.id;
});

await step("Review-keten: versie 1, reviews van rollen én een ander model, oordelen, versie 2, slotcheck", async () => {
  const id = run.keten;
  const s = await call(`/api/runs/${id}/keten`, { method: "POST", json: {} });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const done = await waitFor(async () => {
    const r = await call(`/api/runs/${id}`);
    if (r.data.run.keten?.status === "fout") throw new Error(JSON.stringify(r.data.run.keten.fout));
    return r.data.run.keten?.status === "klaar" && r.data;
  }, "de keten", 60000);
  const k = done.run.keten;
  assert.equal(k.auteur.ai, "Claude");
  assert.equal(k.kruis.ai, "ChatGPT", "een ander model leest tegen");
  assert.equal(k.rondes.length, 2, "na ronde 2 viel er niets wezenlijks meer te verbeteren");
  const r1 = k.rondes[0];
  const debaters = done.run.cast.rollen.filter((r) => !r.isJury).length;
  assert.equal(r1.reviews.filter((r) => r.soort === "persona").length, debaters, "elke rol leest mee");
  assert.ok(r1.reviews.some((r) => r.soort === "kruis"), "de tegenlezer leest mee");
  const ids = r1.reviews.flatMap((r) => r.punten.map((p) => p.id));
  assert.deepEqual(r1.oordelen.map((o) => o.id).sort(), [...ids].sort(), "elk punt krijgt een oordeel");
  assert.ok(r1.oordelen.some((o) => o.oordeel === "niet"), "niet alles wordt klakkeloos overgenomen");
  assert.ok(r1.wijzigingen.length > 0);
  assert.equal(k.rondes[1].oordelen.length, 0, "alleen kleine punten over: geen nieuwe versie");
  assert.match(k.eind.besluit, /versie 2/);
  assert.equal(k.slot.vertrouwen, "midden");
  assert.equal(done.run.status, "done");
  assert.match(done.run.result.vergelijking.label, /versie 1/, "blind vergelijken: versie 1 tegen de eindversie");
  const labels = done.usage.perKind.map((x) => x.label);
  for (const l of ["Verduidelijkende vragen", "Eerste versie", "Reviews vanuit de rollen", "Tegenlezer (ander model)", "Beoordelen en herschrijven", "Slotcheck voorzitter"]) assert.ok(labels.includes(l), `kosten: ${l}`);
  const log = await fakeLog();
  const v1 = log.find((l) => l.schemaProps?.includes("besluit") && l.schemaProps.includes("analyse"));
  assert.equal(v1.model, "claude-opus-5-5", "versie 1 door het slimste Claude-model");
  assert.equal(v1.effort, "high", "diep nagedacht");
  assert.match(v1.user, /Maximaal €80.000/, "met het antwoord op de vraag vooraf");
  assert.match(v1.user, /VASTE RANDVOORWAARDEN[^]*vaste gasten/, "met de randvoorwaarden");
  const kruis = log.find((l) => l.schemaProps?.includes("punten") && /tegenlezer/i.test(l.system));
  assert.equal(kruis.model, "gpt-5.5");
  const herz = log.find((l) => l.schemaProps?.includes("oordelen"));
  assert.match(herz.user, /Wees niet volgzaam/);
});

await step("Review-keten: de baas grijpt in en vraagt nog een ronde", async () => {
  const id = run.keten;
  const k = (await call(`/api/runs/${id}`)).data.run.keten;
  const afgewezen = k.rondes[0].oordelen.find((o) => o.oordeel === "niet");
  const o = await call(`/api/runs/${id}/keten/baas`, { method: "POST", json: { punt: afgewezen.id, override: "over" } });
  assert.equal(o.data.keten.baas.overrides[afgewezen.id], "over");
  await call(`/api/runs/${id}/keten/baas`, { method: "POST", json: { opmerking: "Reken ook een scenario zonder subsidie door." } });
  const leeg = await call(`/api/runs/${id}/keten/baas`, { method: "POST", json: {} });
  assert.equal(leeg.status, 400);
  const e = await call(`/api/runs/${id}/keten`, { method: "POST", json: { extra: true } });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  const done = await waitFor(async () => {
    const r = await call(`/api/runs/${id}`);
    return r.data.run.keten?.status === "klaar" && r.data.run.status === "done" && r.data;
  }, "de extra ronde", 60000);
  const k2 = done.run.keten;
  assert.equal(k2.rondes.length, 3, "een nieuwe versie met jouw punten");
  assert.ok(k2.baas.opmerkingen.every((x) => x.verwerkt), "jouw punt is verwerkt");
  assert.deepEqual(k2.baas.overrides, {});
  const herz = (await fakeLog()).filter((l) => l.schemaProps?.includes("oordelen")).at(-1);
  assert.match(herz.user, /OPMERKINGEN VAN DE BAAS[^]*zonder subsidie/);
  assert.match(herz.user, /ALSNOG OVERNEMEN/);
  const list = await call("/api/runs");
  assert.equal(list.data.runs.find((x) => x.id === id).modus, "keten");
});

await step("Eenmalige storing: de app probeert het vanzelf opnieuw", async () => {
  await fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify({ provider: "anthropic", status: 529, times: 1 }) });
  const r = await call(`/api/runs/${run.id}/quip`, { method: "POST", json: { roleId: "cfo" } });
  assert.equal(r.status, 200);
});

await step("Aanhoudende storing bij één aanbieder: een ander neemt het over", async () => {
  await fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify({ provider: "anthropic", status: 429, times: 50 }) });
  const r = await call(`/api/runs/${run.id}/quip`, { method: "POST", json: { roleId: "cfo" } });
  await fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify({ provider: "anthropic", status: 429, times: 0 }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

await step("Alles faalt: foutmelding in gewone taal met oplossing", async () => {
  for (const provider of ["anthropic", "openai", "google", "xai"]) {
    await fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify({ provider, status: 429, times: 0 }) });
  }
  // De nepwolk onthoudt één storing tegelijk; zet ze na elkaar en laat alles falen via een foute sleutel.
  for (const [provider, key] of Object.entries({ anthropic: "sk-ant-fout" + "x".repeat(30), openai: "sk-proj-fout" + "x".repeat(30), google: "AIzafout" + "x".repeat(31), xai: "xai-fout" + "x".repeat(30) })) {
    await call("/api/settings", { method: "POST", json: { [provider]: key } });
  }
  const r = await call(`/api/runs/${run.id}/quip`, { method: "POST", json: { roleId: "cfo" } });
  assert.ok(r.status >= 400, `status ${r.status}`);
  assert.ok(r.data.error && r.data.oplossing, JSON.stringify(r.data));
  assert.match(r.data.oplossing, /probeerden ook/);
  for (const [provider, key] of Object.entries(KEYS)) {
    if (provider !== "elevenlabs") await call("/api/settings", { method: "POST", json: { [provider]: key } });
  }
});

await step("Inspreken via OpenAI als de browser het niet kan", async () => {
  const fd = new FormData();
  fd.append("audio", new Blob([Buffer.alloc(500)], { type: "audio/webm" }), "spraak.webm");
  const r = await call("/api/stt", { method: "POST", form: fd });
  assert.equal(r.data.text, "Dit is ingesproken tekst.");
});

await step("Debat verwijderen ruimt alles op", async () => {
  await call(`/api/runs/${run.second}`, { method: "DELETE" });
  const r = await call(`/api/runs/${run.second}`);
  assert.equal(r.status, 404);
});

await step("Pincode raden wordt geblokkeerd na 5 foute pogingen", async () => {
  const probeer = (password) => call("/api/login", { method: "POST", json: { password }, noAuth: true });
  for (let i = 0; i < 5; i++) assert.equal((await probeer(`000${i}`)).status, 401);
  const zesde = await probeer("0009");
  assert.equal(zesde.status, 429);
  assert.match(zesde.data.error, /Te vaak/);
  assert.equal((await probeer("test123")).status, 429, "ook de goede pincode wacht even");
});

console.log(`\nAlle ${passed} stappen geslaagd. Debat om in de browser te bekijken: ${run.id}`);
