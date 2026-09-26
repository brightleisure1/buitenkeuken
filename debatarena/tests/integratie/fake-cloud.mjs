// Nepwolk voor de integratietest: bootst Anthropic, OpenAI, Gemini, Grok, ElevenLabs
// en de Supabase REST/Storage-API na. Elk AI-verzoek wordt gelogd voor controles.
//
// Poort: FAKE_PORT (standaard 54321). REST wordt doorgestuurd naar POSTGREST_URL.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.FAKE_PORT ?? 54321);
const POSTGREST = process.env.POSTGREST_URL ?? "http://127.0.0.1:54330";
const STORE = process.env.FAKE_STORE ?? path.join(process.cwd(), ".fake-storage");
const JPEG = Buffer.from(fs.readFileSync(new URL("./tiny.jpg.b64", import.meta.url), "utf8").trim(), "base64");
fs.mkdirSync(STORE, { recursive: true });

/** Welke modellen elke nep-aanbieder kent (Google kent de config-namen expres niet). */
const MODEL_LISTS = {
  anthropic: ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5.5", "gpt-5.4-mini", "gpt-image-1", "gpt-4o-mini-transcribe"],
  google: ["models/gemini-2.5-pro", "models/gemini-2.5-flash", "models/gemini-2.5-flash-lite", "models/gemini-3-pro-preview", "models/gemini-3-pro-image-preview", "models/text-embedding-004"],
  xai: ["grok-4.7", "grok-4.3", "grok-code-fast-1", "grok-2-image"],
};
const knows = (provider, model) => MODEL_LISTS[provider].some((id) => id.replace(/^models\//, "") === model);

/** Alle AI-verzoeken, voor de test. */
const log = [];
let failNext = null; // { provider, status } → volgende verzoek naar die aanbieder faalt

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.FAKE_DELAY ?? 25);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

// ---------- wat zegt de nep-AI? ----------

function textOf(x) {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(textOf).join("\n");
  if (x.text) return x.text;
  if (x.content) return textOf(x.content);
  return "";
}

function adviesDoc(versie) {
  return {
    besluit: `Verhoog de prijzen gefaseerd met 6% (versie ${versie})`,
    samenvatting: "Verhoog in twee stappen. Ontzie vaste klanten het eerste jaar. Meet het effect per klantgroep.",
    opties: [
      { optie: "Gefaseerd 6%", voor: "Marge herstelt", tegen: "Risico op verloop" },
      { optie: "Niets doen", voor: "Geen onrust", tegen: "Marge daalt verder" },
    ],
    analyse: "De marge staat onder druk (bron: CBS).\n\nEen gefaseerde verhoging beperkt het verloop.",
    aannames: [{ aanname: "Klanten accepteren 6%", risico: "Verloop", hoeTesten: "Proef op twee parken" }],
    stappen: [{ stap: "Prijslijst herzien", waarom: "Nodig voor de verhoging", eersteActie: "Doorrekenen", eigenaar: "CFO", termijn: "2 weken" }],
  };
}

function field(text, label) {
  const m = text.match(new RegExp(`${label}: (.+)`));
  return m ? m[1].trim() : "";
}

let turnCounter = 0;

/** Kiest een antwoord op basis van wat er gevraagd wordt. */
function answer({ system, user, schemaProps }) {
  const all = `${system}\n${user}`;
  if (schemaProps) {
    // ---------- review-keten ----------
    if (schemaProps.includes("vragen")) return { json: { vragen: ["Wat is het maximale budget?", "Wanneer moet het besluit vallen?"] } };
    if (schemaProps.includes("oordelen") && schemaProps.includes("document")) {
      const ids = [...user.matchAll(/\[(r\d+-[pk][\d-]*)\]/g)].map((m) => m[1]);
      const versie = Number((user.match(/JOUW HUIDIGE VERSIE \(versie (\d+)\)/) ?? [])[1] ?? 1) + 1;
      return {
        json: {
          oordelen: ids.map((id, i) => ({ id, oordeel: i % 3 === 2 ? "niet" : i % 3 === 1 ? "deels" : "over", reden: i % 3 === 2 ? "Al gedekt in stap 2." : "Maakt het besluit sterker." })),
          document: adviesDoc(versie),
          wijzigingen: [`Versie ${versie}: risico voor vaste gasten uitgewerkt`, "Proef eerst op twee parken"],
        },
      };
    }
    if (schemaProps.includes("besluit") && schemaProps.includes("analyse")) return { json: adviesDoc(1) };
    if (schemaProps.includes("punten")) {
      const v = Number((user.match(/ADVIESDOCUMENT \(versie (\d+)\)/) ?? [])[1] ?? 1);
      const tegenlezer = /tegenlezer/i.test(system);
      if (v >= 2) return { json: { punten: [{ zwaarte: "laag", punt: "Kleine verduidelijking bij stap 3.", voorstel: "Noem de eigenaar." }] } };
      return {
        json: {
          punten: tegenlezer
            ? [
                { zwaarte: "hoog", punt: "De 6% is niet onderbouwd.", voorstel: "Reken met 3, 6 en 9% en de prijselasticiteit." },
                { zwaarte: "midden", punt: "Optie 'niets doen' ontbreekt.", voorstel: "Voeg die toe met de gevolgen voor de marge." },
              ]
            : [
                { zwaarte: "hoog", punt: `Vanuit mijn rol mis ik het effect op vaste klanten.`, voorstel: "Voeg een uitzondering voor vaste klanten toe." },
                { zwaarte: "laag", punt: "De termijn is krap.", voorstel: "Neem een maand extra." },
              ],
        },
      };
    }
    if (schemaProps.includes("vertrouwen")) {
      return {
        json: {
          oordeel: "Klaar om op te besluiten, mits de proef op twee parken slaagt.",
          vertrouwen: "midden",
          waaromVertrouwen: "De prijselasticiteit is nog een schatting.",
          laatsteAanvullingen: ["Informeer de ondernemingsraad vooraf."],
          nietOvergenomen: [{ punt: "Een maand extra", van: "CFO", reden: "Te veel vertraging." }],
          besteInzicht: { tekst: "Reken met drie scenario's in plaats van één percentage.", van: "Tegenlezer" },
        },
      };
    }
    if (schemaProps.includes("antwoord") && schemaProps.includes("cast")) return { json: castEdit(user) };
    if (schemaProps.includes("rollen") && schemaProps.includes("titel")) return { json: castFrom(user) };
    if (schemaProps.includes("uitslag") && !schemaProps.includes("besluitenVanDeBaas")) {
      return {
        json: {
          uitslag: "Verhoog met 4%, maar alleen voor nieuwe klanten",
          samenvatting: "Eén adviseur, diep nagedacht. Bestaande klanten ontzien.",
          strategie: [{ stap: "Nieuwe prijslijst", waarom: "Minder verloop", eersteActie: "Prijzen doorrekenen" }],
          aannames: [{ aanname: "Concurrent verlaagt niet", risico: "Klanten lopen weg", hoeTesten: "Prijzen concurrent volgen" }],
        },
      };
    }
    if (schemaProps.includes("uitslag")) return { json: juryResult(all) };
    if (schemaProps.includes("momenten")) return { json: highlights(user) };
    if (schemaProps.includes("feiten")) return { json: { feiten: [{ feit: "De markt groeit 4% per jaar", bron: "CBS" }] } };
  }
  if (/Doe je huiswerk/.test(user)) {
    return { text: JSON.stringify({ feiten: [{ feit: "Concurrent X verhoogde vorig jaar 7%", bron: "Retailnieuws" }, { feit: "Marge daalde naar 18%", bron: "jaarcijfers.pdf" }] }) };
  }
  if (/tikt je aan/.test(user)) return { text: "Ik zit hier heus wel op te letten." };

  const naam = field(system, "Naam") || "Iemand";
  const ronde = Number((user.match(/Ronde (\d+) van/) ?? [])[1] ?? 0);
  const verdict = /Doe nu je uitspraak/.test(user);
  turnCounter++;
  if (verdict) {
    const weekend = /Fijn weekend/.test(user) ? " Fijn weekend!" : "";
    return { text: `[voorstel] Mijn uitspraak: verhoog met zes procent, gefaseerd. Het grootste risico blijft klantverloop.${weekend}` };
  }
  const answerQ = user.match(/De baas stelt jou direct een vraag: "([^"]+)"/);
  if (answerQ) return { text: `[voorstel] Goede vraag van de baas. Mijn antwoord op "${answerQ[1]}": we testen het eerst bij twintig klanten.` };
  // Ronde 1: iedereen akkoord (dan volgt "verdacht eensgezind"). Daarna afwisselend.
  const eens = /Verdacht eensgezind|verdacht eensgezind/i.test(user) || /Iedereen was het in deze ronde/.test(user);
  const tag = eens ? "bezwaar" : ronde === 1 ? "akkoord" : turnCounter % 2 ? "bezwaar" : "voorstel";
  const baas = user.match(/De baas (?:zei net|geeft net richting|heeft net besloten): "([^"]+)"/);
  const reactie = baas ? `Over wat de baas zei, "${baas[1]}": dat neem ik mee. ` : "";
  const ongezouten = /ONGECENSUREERD \(/.test(system) ? "Wat een onzin, eerlijk gezegd. " : "";
  const cliche = (system.match(/JE VERGADERCLICHÉ: (.+)/) ?? [])[1];
  const clicheZin = cliche ? `(${cliche.trim()} spreekt.) ` : "";
  return {
    text: `[${tag}] ${reactie}${ongezouten}${clicheZin}Ik ben ${naam}. De marge staat onder druk, dus we moeten iets doen (bron: CBS). Mijn voorstel is een verhoging van zes procent. Daarna meten we het effect per klantgroep.`,
  };
}

function modelKeys(user) {
  const block = user.split("MODELLEN:")[1]?.split("\n\n")[0] ?? "";
  return [...block.matchAll(/^- ([a-z0-9-]+):/gm)].map((m) => m[1]);
}

function castFrom(user) {
  const keys = modelKeys(user);
  const pick = (want) => keys.find((k) => k.startsWith(want)) ?? keys[0];
  const voices = [...(user.split("STEMMEN:")[1]?.split("\n\n")[0] ?? "").matchAll(/^- ([A-Za-z0-9]+):/gm)].map((m) => m[1]);
  const atts = [...(user.split("BIJLAGES:")[1]?.split("\n\n")[0] ?? "").matchAll(/^- ([0-9a-f-]{36}):/gm)].map((m) => m[1]);
  const wantCliches = /vergadercliché|vergaderclich/i.test(user.split("VRAAGSTUK VAN DE BAAS:")[1] ?? "");
  const rol = (id, naam, functie, model, extra = {}) => ({
    id,
    naam,
    functie,
    perspectief: `Kijkt als ${functie.toLowerCase()}`,
    instructie: "Geen complimenten, wel concrete bezwaren en voorstellen.",
    zin: `${functie} met een duidelijke mening.`,
    modelKey: model,
    stemId: voices.shift() ?? null,
    webzoeken: false,
    isJury: false,
    isKritisch: false,
    ongezouten: false,
    cliche: "",
    uiterlijk: `a ${functie.toLowerCase()} in a blazer`,
    ...extra,
  });
  return {
    titel: "Prijsverhoging",
    rondes: 2,
    stemmen: voices.length ? "jury" : "uit",
    vergadercliches: wantCliches,
    bijlages: atts.map((a) => ({ bijlageId: a, voor: "cfo" })),
    rollen: [
      rol("inkoper", "Fatima El Amrani", "Inkoper", pick("gemini"), { isKritisch: true }),
      rol("cfo", "Pieter de Groot", "CFO", pick("claude"), { webzoeken: true, cliche: wantCliches ? "parkeerder" : "" }),
      rol("sales", "Lisa Chen", "Marketing & Guest Experience Manager voor alle vestigingen", pick("grok"), { cliche: wantCliches ? "managementtaal" : "" }),
      rol("jury", "Dr. Anneke de Wit", "Jury", pick("gpt"), { isJury: true }),
    ],
  };
}

function castEdit(user) {
  const raw = user.split("HUIDIGE CAST (JSON):\n")[1]?.split("\n\n")[0] ?? "{}";
  const cast = JSON.parse(raw);
  const req = (user.split("VERZOEK VAN DE BAAS:\n")[1] ?? "").split("\n\n")[0].toLowerCase();
  const done = [];
  const m = req.match(/(\d+) rondes/);
  if (m) {
    cast.rondes = Number(m[1]);
    done.push(`${m[1]} rondes`);
  }
  if (/ongecensureerd|zonder censuur/.test(req)) {
    cast.rollen.forEach((r) => r.modelKey.startsWith("grok") && (r.ongezouten = true));
    done.push("Grok ongecensureerd");
  } else if (/gecensureerd/.test(req)) {
    cast.rollen.forEach((r) => (r.ongezouten = false));
    done.push("Grok gecensureerd");
  }
  if (/clich/.test(req)) {
    cast.vergadercliches = !/geen|zonder|uit/.test(req);
    done.push(cast.vergadercliches ? "clichés aan" : "clichés uit");
  }
  if (/jurist/.test(req)) {
    cast.rollen.splice(cast.rollen.length - 1, 0, { ...cast.rollen[0], id: "jurist", naam: "Mr. Jan Visser", functie: "Jurist", isKritisch: false, cliche: "" });
    done.push("jurist toegevoegd");
  }
  if (/strenger/.test(req)) {
    cast.rollen[0].instructie += " Je bent extra streng.";
    done.push("strenger");
  }
  return { antwoord: `Aangepast: ${done.join(", ") || "niets"}.`, cast };
}

function juryResult(all) {
  return {
    uitslag: "Verhoog met 6%, gefaseerd",
    samenvatting: "De prijs gaat omhoog, maar in stappen. Grote klanten krijgen een overgang. Eerst testen.",
    besluitenVanDeBaas: [...all.matchAll(/DE BAAS \(HAMER, besluit\): (.+)/g)].map((m) => m[1]),
    strategie: [{ stap: "Verhoog 6% voor nieuwe klanten", waarom: "Laag risico", eersteActie: "Prijslijst aanpassen" }],
    aannames: [{ aanname: "Klanten accepteren 6%", risico: "Verloop", hoeTesten: "Test bij 20 klanten", onbewezen: true }],
    onenigheid: [{ punt: "Timing", standpuntPerRol: [{ rol: "Lisa Chen", standpunt: "Na juni" }] }],
    bronnen: [{ naam: "CBS", gebruiktDoor: "Pieter de Groot" }],
    volgendeStappen: ["Prijslijst", "Klantbrief"],
    besteQuote: { tekst: "De marge staat onder druk, dus we moeten iets doen.", rol: "Pieter de Groot" },
  };
}

function highlights(user) {
  const nums = [...user.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
  return { momenten: nums.slice(0, 3).map((n) => ({ nummer: n, waarom: "Scherp moment" })) };
}

// ---------- Anthropic ----------

async function anthropic(req, res, body) {
  const b = JSON.parse(body.toString() || "{}");
  const system = textOf(b.system);
  const user = textOf(b.messages?.at(-1)?.content);
  const schemaProps = b.output_config?.format?.schema ? Object.keys(b.output_config.format.schema.properties ?? {}) : null;
  const hasCache = JSON.stringify(b).includes('"cache_control"');
  log.push({ provider: "anthropic", model: b.model, stream: !!b.stream, system, user, schemaProps, hasCache, tools: b.tools?.map((t) => t.type), effort: b.output_config?.effort });
  const out = answer({ system, user, schemaProps });
  const text = out.json ? JSON.stringify(out.json) : out.text;
  const usage = { input_tokens: 1200, output_tokens: Math.ceil(text.length / 4), cache_read_input_tokens: hasCache ? 800 : 0, cache_creation_input_tokens: hasCache ? 300 : 0 };
  if (!b.stream) {
    return json(res, 200, {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: b.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage,
    });
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_fake", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
  let idx = 0;
  const searching = b.tools?.some((t) => String(t.type).startsWith("web_search"));
  if (searching) {
    send("content_block_start", { index: idx, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } });
    send("content_block_delta", { index: idx, delta: { type: "input_json_delta", partial_json: '{"query":"prijsverhoging groothandel 2026"}' } });
    send("content_block_stop", { index: idx++ });
    send("content_block_start", {
      index: idx,
      content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", title: "Retailnieuws: prijzen stijgen", url: "https://example.com", encrypted_content: "x", page_age: null }] },
    });
    send("content_block_stop", { index: idx++ });
  }
  send("content_block_start", { index: idx, content_block: { type: "text", text: "" } });
  for (const piece of text.match(/.{1,18}/gs) ?? []) {
    if (res.destroyed) return;
    send("content_block_delta", { index: idx, delta: { type: "text_delta", text: piece } });
    await sleep(DELAY);
  }
  send("content_block_stop", { index: idx });
  send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output_tokens, ...(searching ? { server_tool_use: { web_search_requests: 1 } } : {}) } });
  send("message_stop", {});
  res.end();
}

// ---------- OpenAI Responses ----------

async function responses(req, res, body) {
  const b = JSON.parse(body.toString() || "{}");
  const system = b.instructions ?? "";
  const user = textOf((b.input ?? []).flatMap((i) => i.content ?? []).map((c) => c.text ?? ""));
  const schemaProps = b.text?.format?.schema ? Object.keys(b.text.format.schema.properties ?? {}) : null;
  log.push({ provider: "openai", model: b.model, stream: !!b.stream, system, user, schemaProps, cacheKey: b.prompt_cache_key, tools: b.tools?.map((t) => t.type), reasoning: b.reasoning?.effort });
  const out = answer({ system, user, schemaProps });
  const text = out.json ? JSON.stringify(out.json) : out.text;
  const usage = { input_tokens: 1500, input_tokens_details: { cached_tokens: 700 }, output_tokens: Math.ceil(text.length / 4), output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 };
  const response = {
    id: "resp_fake",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: b.model,
    output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
    output_text: text,
    usage,
    parallel_tool_calls: true,
    tool_choice: "auto",
    tools: [],
    text: b.text ?? { format: { type: "text" } },
  };
  if (!b.stream) return json(res, 200, response);
  res.writeHead(200, { "content-type": "text/event-stream" });
  let seq = 0;
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
  send("response.created", { response: { ...response, status: "in_progress", output: [] } });
  if (b.tools?.some((t) => t.type === "web_search")) {
    send("response.output_item.done", { output_index: 0, item: { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "marges groothandel" } } });
  }
  for (const piece of text.match(/.{1,18}/gs) ?? []) {
    if (res.destroyed) return;
    send("response.output_text.delta", { item_id: "msg_1", output_index: 0, content_index: 0, delta: piece, logprobs: [] });
    await sleep(DELAY);
  }
  send("response.completed", { response });
  res.end();
}

// ---------- Chat Completions (Gemini en Grok) ----------

async function chat(provider, req, res, body) {
  const b = JSON.parse(body.toString() || "{}");
  if (!knows(provider, b.model)) {
    log.push({ provider, model: b.model, unknownModel: true });
    return json(res, 404, { error: { message: `The model ${b.model} does not exist`, type: "invalid_request_error", code: "model_not_found" } });
  }
  const system = textOf(b.messages?.find((m) => m.role === "system")?.content);
  const user = textOf(b.messages?.filter((m) => m.role === "user").at(-1)?.content);
  const schemaProps = b.response_format?.json_schema?.schema ? Object.keys(b.response_format.json_schema.schema.properties ?? {}) : null;
  log.push({ provider, model: b.model, stream: !!b.stream, system, user, schemaProps, reasoning: b.reasoning_effort });
  const out = answer({ system, user, schemaProps });
  const text = out.json ? JSON.stringify(out.json) : out.text;
  const usage = { prompt_tokens: 1300, completion_tokens: Math.ceil(text.length / 4), total_tokens: 0, prompt_tokens_details: { cached_tokens: 400 } };
  const base = { id: "chatcmpl_fake", created: Math.floor(Date.now() / 1000), model: b.model };
  if (!b.stream) {
    return json(res, 200, { ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text, refusal: null }, finish_reason: "stop", logprobs: null }], usage });
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const piece of text.match(/.{1,18}/gs) ?? []) {
    if (res.destroyed) return;
    res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
    await sleep(DELAY);
  }
  res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

// ---------- Supabase Storage ----------

function storage(req, res, url, body) {
  const m = url.pathname.match(/^\/storage\/v1\/object\/(public\/|authenticated\/)?([^/]+)\/(.+)$/);
  if (!m) return json(res, 404, { error: "not found" });
  const [, , bucket, key] = m;
  const file = path.join(STORE, bucket, decodeURIComponent(key));
  if (req.method === "POST" || req.method === "PUT") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    fs.writeFileSync(`${file}.type`, req.headers["content-type"] ?? "application/octet-stream");
    return json(res, 200, { Id: key, Key: `${bucket}/${key}` });
  }
  if (req.method === "GET" && fs.existsSync(file)) {
    const type = fs.existsSync(`${file}.type`) ? fs.readFileSync(`${file}.type`, "utf8") : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
    return res.end(fs.readFileSync(file));
  }
  return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
}

// ---------- PostgREST doorsturen ----------

function rest(req, res, url, body) {
  const target = new URL(url.pathname.replace(/^\/rest\/v1/, "") + url.search, POSTGREST);
  const headers = { ...req.headers };
  delete headers.authorization;
  delete headers.apikey;
  delete headers.host;
  delete headers["content-length"];
  const p = http.request(target, { method: req.method, headers: { ...headers, "content-length": body.length } }, (r) => {
    res.writeHead(r.statusCode ?? 500, r.headers);
    r.pipe(res);
  });
  p.on("error", (e) => json(res, 502, { message: e.message }));
  p.end(body);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = await readBody(req);
  const p = url.pathname;
  try {
    if (p === "/__log") return json(res, 200, log);
    if (p === "/__reset") {
      log.length = 0;
      return json(res, 200, { ok: true });
    }
    if (p === "/__fail") {
      failNext = JSON.parse(body.toString());
      return json(res, 200, { ok: true });
    }
    if (p.startsWith("/rest/v1")) return rest(req, res, url, body);
    if (p.startsWith("/storage/v1")) return storage(req, res, url, body);

    const provider = p.startsWith("/anthropic") ? "anthropic" : p.startsWith("/openai") ? "openai" : p.startsWith("/google") ? "google" : p.startsWith("/xai") ? "xai" : p.startsWith("/eleven") ? "elevenlabs" : null;
    if (failNext && failNext.provider === provider && failNext.times > 0 && (!failNext.path || p.includes(failNext.path))) {
      failNext.times--;
      return json(res, failNext.status, { error: { type: "error", message: "nepfout" } }, { "retry-after": "0" });
    }
    const auth = req.headers["x-api-key"] ?? req.headers["xi-api-key"] ?? req.headers.authorization ?? "";
    if (/fout|wrong|invalid|sk-pil/.test(String(auth))) {
      // xAI en Google geven bij een foute sleutel een 400, de rest een 401.
      const status = provider === "xai" || provider === "google" ? 400 : 401;
      return json(res, status, { error: { type: "authentication_error", message: "Incorrect API key provided" } });
    }

    if (p === "/anthropic/v1/messages") return anthropic(req, res, body);
    if (p === "/anthropic/v1/models") {
      const data = MODEL_LISTS.anthropic.map((id) => ({ id, type: "model", display_name: id, created_at: "2026-01-01T00:00:00Z" }));
      return json(res, 200, { data, has_more: false, first_id: data[0].id, last_id: data.at(-1).id });
    }
    if (p === "/openai/v1/responses") return responses(req, res, body);
    if (p === "/openai/v1/models" || p === "/google/models" || p === "/xai/models") {
      return json(res, 200, { object: "list", data: MODEL_LISTS[provider].map((id) => ({ id, object: "model", created: 0, owned_by: provider })) });
    }
    if (p === "/openai/v1/images/generations" || p === "/openai/v1/images/edits") {
      log.push({ provider: "openai-image", path: p, bytes: body.length });
      await sleep(80);
      return json(res, 200, { created: 0, data: [{ b64_json: JPEG.toString("base64") }] });
    }
    if (p === "/openai/v1/audio/transcriptions") return json(res, 200, { text: "Dit is ingesproken tekst." });
    if (p === "/google/chat/completions") return chat("google", req, res, body);
    if (p === "/xai/chat/completions") return chat("xai", req, res, body);
    if (p === "/eleven/v1/voices") {
      return json(res, 200, {
        voices: [
          // Standaard Engelse stemmen (die wil je niet)
          { voice_id: "enRachel", name: "Rachel", category: "premade", labels: { gender: "female", accent: "american" } },
          { voice_id: "enAdam", name: "Adam", category: "premade", labels: { gender: "male", accent: "american" } },
          { voice_id: "enBella", name: "Bella", category: "premade", labels: { gender: "female", accent: "british" } },
          // Nederlandse stemmen, op verschillende manieren herkenbaar
          { voice_id: "nlAnna", name: "Anna", category: "professional", labels: { gender: "female", accent: "dutch", age: "middle aged" }, preview_url: "http://127.0.0.1:54321/storage/v1/object/public/audio/preview.mp3" },
          { voice_id: "nlBram", name: "Bram", category: "cloned", labels: { gender: "male" }, verified_languages: [{ language: "nl", locale: "nl-NL" }] },
          { voice_id: "nlCarla", name: "Carla - Nederlands", category: "generated", labels: { gender: "female", age: "old" } },
          { voice_id: "nlDaan", name: "Daan", category: "professional", labels: { gender: "male", language: "nl" } },
          { voice_id: "nlEva", name: "Eva", category: "professional", labels: { gender: "female" }, fine_tuning: { language: "nl" } },
          // Vlaamse stemmen: niet automatisch gebruiken
          { voice_id: "beFrank", name: "Frank", category: "professional", labels: { gender: "male", accent: "Flemish" } },
          { voice_id: "beLies", name: "Lies", category: "professional", labels: { gender: "female" }, verified_languages: [{ language: "nl", locale: "nl-BE" }] },
        ],
      });
    }
    if (p.startsWith("/eleven/v1/text-to-speech/")) {
      const b = JSON.parse(body.toString() || "{}");
      log.push({ provider: "elevenlabs", path: p, text: b.text, model: b.model_id });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(Buffer.alloc(2048, 7));
    }
    return json(res, 404, { error: `onbekend pad ${p}` });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`nepwolk op ${PORT}`));
