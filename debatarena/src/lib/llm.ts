import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat, zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  MODELS,
  PROVIDERS,
  COMPAT_BASE_URL,
  CACHE_READ_FACTOR,
  CACHE_WRITE_FACTOR,
  OPENAI_CACHED_FACTOR,
  WEB_SEARCH_PRICE_USD,
  type ModelConfig,
  type Provider,
} from "./config";
import { AppError, friendly, type Who } from "./errors";
import { availableKeys, requireKey } from "./settings";
import { forgetModels, liveModel } from "./model-discovery";
import { addUsage, emptyUsage, type Usage } from "./usage";

export interface ImageInput {
  mime: string;
  base64: string;
}

export interface Prompt {
  model: ModelConfig;
  /** Stabiele context: wordt gecachet */
  system: string;
  images?: ImageInput[];
  /** Transcript: één blok per bericht, groeit alleen aan (cachebaar) */
  history?: string[];
  /** Vluchtige opdracht voor deze beurt */
  instruction: string;
  maxTokens?: number;
  signal?: AbortSignal;
  cacheKey?: string;
  /** Zwaarder nadenken (Jury-uitslag) */
  deep?: boolean;
}

const WHO: Record<Provider, Who> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI" };

/** Gemini en Grok: OpenAI-compatibele Chat Completions. */
const isCompat = (m: ModelConfig) => m.provider === "google" || m.provider === "xai";

async function anthropic() {
  return new Anthropic({ apiKey: await requireKey("anthropic"), maxRetries: 2 });
}
async function openai() {
  return new OpenAI({ apiKey: await requireKey("openai"), maxRetries: 2 });
}
/** Adres van de Gemini/Grok-API; te overschrijven voor tests (GEMINI_BASE_URL, XAI_BASE_URL). */
function compatBaseURL(provider: "google" | "xai") {
  return (provider === "google" ? process.env.GEMINI_BASE_URL : process.env.XAI_BASE_URL) || COMPAT_BASE_URL[provider];
}
async function compat(m: ModelConfig) {
  const provider = m.provider as "google" | "xai";
  return new OpenAI({ apiKey: await requireKey(provider), baseURL: compatBaseURL(provider), maxRetries: 2 });
}

// ---------- verbruik en kosten ----------

export function anthropicUsage(m: ModelConfig, u: Anthropic.Usage | null | undefined): Usage {
  const out = emptyUsage(m.provider, m.model);
  if (!u) return out;
  const perIn = m.inputPrice / 1e6;
  const perOut = m.outputPrice / 1e6;
  out.inputTokens = u.input_tokens;
  out.cachedTokens = u.cache_read_input_tokens ?? 0;
  out.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
  out.outputTokens = u.output_tokens;
  out.webSearches = u.server_tool_use?.web_search_requests ?? 0;
  out.costUsd =
    out.inputTokens * perIn +
    out.cacheWriteTokens * perIn * CACHE_WRITE_FACTOR +
    out.cachedTokens * perIn * CACHE_READ_FACTOR +
    out.outputTokens * perOut +
    out.webSearches * WEB_SEARCH_PRICE_USD;
  return out;
}

export function openaiUsage(m: ModelConfig, u: OpenAI.Responses.ResponseUsage | null | undefined): Usage {
  const out = emptyUsage(m.provider, m.model);
  if (!u) return out;
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const factor = m.cachedFactor ?? OPENAI_CACHED_FACTOR;
  out.inputTokens = u.input_tokens - cached;
  out.cachedTokens = cached;
  out.outputTokens = u.output_tokens;
  out.costUsd = (out.inputTokens * m.inputPrice + cached * m.inputPrice * factor + out.outputTokens * m.outputPrice) / 1e6;
  return out;
}

export function compatUsage(m: ModelConfig, u: OpenAI.CompletionUsage | null | undefined): Usage {
  const out = emptyUsage(m.provider, m.model);
  if (!u) return out;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const factor = m.cachedFactor ?? OPENAI_CACHED_FACTOR;
  out.inputTokens = u.prompt_tokens - cached;
  out.cachedTokens = cached;
  out.outputTokens = u.completion_tokens;
  out.costUsd = (out.inputTokens * m.inputPrice + cached * m.inputPrice * factor + out.outputTokens * m.outputPrice) / 1e6;
  return out;
}

/** Afgebroken beurt: de aanbieder geeft geen verbruik terug, dus we schatten (≈4 tekens per token). */
function estimateUsage(m: ModelConfig, inChars: number, outChars: number): Usage {
  const out = emptyUsage(m.provider, m.model);
  out.inputTokens = Math.round(inChars / 4);
  out.outputTokens = Math.round(outChars / 4);
  out.costUsd = (out.inputTokens * m.inputPrice + out.outputTokens * m.outputPrice) / 1e6;
  out.estimated = true;
  return out;
}

// ---------- opbouw van de input ----------

function anthropicContent(p: Prompt): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const img of p.images ?? []) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: img.mime as "image/png", data: img.base64 },
    });
  }
  const hist = p.history ?? [];
  if (hist.length) {
    blocks.push({ type: "text", text: "HET DEBAT TOT NU TOE:" });
    hist.forEach((h, i) => {
      blocks.push({
        type: "text",
        text: h,
        // Breekpunt op het laatste transcriptblok: de volgende beurt leest alles daarvoor uit de cache.
        ...(i === hist.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
      });
    });
  }
  blocks.push({ type: "text", text: p.instruction });
  return blocks;
}

function anthropicSystem(p: Prompt): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }];
}

function anthropicExtras(p: Prompt) {
  const effort = p.deep ? "high" : p.model.effort;
  return effort ? { output_config: { effort } } : {};
}

function openaiInput(p: Prompt): OpenAI.Responses.ResponseInput {
  const content: OpenAI.Responses.ResponseInputContent[] = [];
  for (const img of p.images ?? []) {
    content.push({ type: "input_image", image_url: `data:${img.mime};base64,${img.base64}`, detail: "auto" });
  }
  const hist = p.history ?? [];
  if (hist.length) content.push({ type: "input_text", text: `HET DEBAT TOT NU TOE:\n\n${hist.join("\n\n")}` });
  content.push({ type: "input_text", text: p.instruction });
  return [{ role: "user", content }];
}

function compatMessages(p: Prompt): OpenAI.Chat.ChatCompletionMessageParam[] {
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const img of p.images ?? []) {
    content.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}` } });
  }
  const hist = p.history ?? [];
  if (hist.length) content.push({ type: "text", text: `HET DEBAT TOT NU TOE:\n\n${hist.join("\n\n")}` });
  content.push({ type: "text", text: p.instruction });
  return [
    { role: "system", content: p.system },
    { role: "user", content },
  ];
}

function compatExtras(p: Prompt) {
  const effort = p.deep && p.model.reasoning ? "medium" : p.model.reasoning;
  return effort ? { reasoning_effort: effort } : {};
}

function openaiReasoning(p: Prompt) {
  const effort = p.deep ? "medium" : p.model.reasoning;
  return effort ? { reasoning: { effort } } : {};
}

// ---------- streamen van een beurt ----------

export interface StreamResult {
  text: string;
  usage: Usage;
  aborted: boolean;
  /** Het model dat het echt gedaan heeft (kan een vervanger zijn) */
  usedModel?: ModelConfig;
  /** Gevraagd model werkte niet; een ander nam het over */
  fellBack?: boolean;
}

// ---------- terugvallen op een ander model ----------

const who = (m: ModelConfig) => WHO[m.provider];

/**
 * Volgorde waarin we modellen proberen: eerst het gevraagde (met de juiste naam voor deze sleutel),
 * dan hetzelfde niveau bij een andere aanbieder, dan andere varianten.
 */
async function fallbackChain(m: ModelConfig): Promise<ModelConfig[]> {
  const keys = await availableKeys();
  const out: ModelConfig[] = [];
  if (keys[m.provider]) out.push(await liveModel(m).catch(() => m));
  const tierRank = (x: ModelConfig) => (x.tier === m.tier ? 0 : 1);
  const others = MODELS.filter((x) => keys[x.provider] && x.key !== m.key).sort(
    (a, b) => tierRank(a) - tierRank(b) || Number(a.provider === m.provider) - Number(b.provider === m.provider),
  );
  for (const x of others) {
    const live = await liveModel(x).catch(() => x);
    if (!out.some((o) => o.provider === live.provider && o.model === live.model)) out.push(live);
    if (out.length >= 4) break;
  }
  return out;
}

async function withFallback<T>(p: Prompt, run: (m: ModelConfig) => Promise<T>, canRetry: () => boolean = () => true): Promise<T & { usedModel: ModelConfig; fellBack: boolean }> {
  const chain = await fallbackChain(p.model);
  if (!chain.length) await requireKey(p.model.provider as "anthropic");
  let lastError: unknown;
  for (const m of chain) {
    try {
      const r = await run(m);
      return { ...r, usedModel: m, fellBack: m.provider !== p.model.provider || (m.key !== p.model.key && !p.model.key.startsWith("custom:")) };
    } catch (e) {
      lastError = e;
      if (p.signal?.aborted || !canRetry()) break;
      const status = (e as { status?: number }).status;
      if (status === 404) forgetModels(m.provider);
      console.error(`model ${m.provider}/${m.model} faalde (${status ?? "?"}), volgende proberen`);
    }
  }
  const err = friendly(lastError, who(chain[0] ?? p.model));
  if (chain.length > 1) err.oplossing = `${err.oplossing} (We probeerden ook ${chain.slice(1).map((m) => PROVIDERS[m.provider].naam).join(" en ")}, maar die lukten ook niet.)`;
  throw err;
}

export async function streamText(p: Prompt, onDelta: (t: string) => void): Promise<StreamResult> {
  let emitted = false;
  return withFallback(
    p,
    (m) =>
      streamOnce({ ...p, model: m }, (d) => {
        emitted = true;
        onDelta(d);
      }),
    // Zodra er tekst is uitgesproken, kunnen we niet halverwege van model wisselen.
    () => !emitted,
  );
}

async function streamOnce(p: Prompt, onDelta: (t: string) => void): Promise<StreamResult> {
  let text = "";
  const maxTokens = p.maxTokens ?? 1200;
  try {
    if (p.model.provider === "anthropic") {
      const client = await anthropic();
      const stream = client.messages.stream(
        {
          model: p.model.model,
          max_tokens: maxTokens,
          system: anthropicSystem(p),
          messages: [{ role: "user", content: anthropicContent(p) }],
          ...anthropicExtras(p),
        },
        { signal: p.signal },
      );
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          text += ev.delta.text;
          onDelta(ev.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        throw new AppError("Deze rol wilde hier niet op ingaan.", "Geef de rol een andere richting of kies een ander model.");
      }
      return { text, usage: anthropicUsage(p.model, final.usage), aborted: false };
    }
    if (isCompat(p.model)) {
      const client = await compat(p.model);
      const stream = await client.chat.completions.create(
        {
          model: p.model.model,
          messages: compatMessages(p),
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens + 3000,
          ...compatExtras(p),
        },
        { signal: p.signal },
      );
      let usage: OpenAI.CompletionUsage | undefined;
      for await (const ch of stream) {
        const d = ch.choices[0]?.delta?.content;
        if (d) {
          text += d;
          onDelta(d);
        }
        if (ch.usage) usage = ch.usage;
      }
      return { text, usage: compatUsage(p.model, usage), aborted: false };
    }
    const client = await openai();
    const stream = await client.responses.create(
      {
        model: p.model.model,
        instructions: p.system,
        input: openaiInput(p),
        stream: true,
        max_output_tokens: maxTokens + 2000,
        prompt_cache_key: p.cacheKey,
        ...openaiReasoning(p),
      },
      { signal: p.signal },
    );
    let usage: OpenAI.Responses.ResponseUsage | undefined;
    for await (const ev of stream) {
      if (ev.type === "response.output_text.delta") {
        text += ev.delta;
        onDelta(ev.delta);
      } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
        usage = ev.response.usage ?? undefined;
      } else if (ev.type === "response.failed" || ev.type === "error") {
        throw new AppError("GPT gaf halverwege een fout.", "Probeer het opnieuw of kies een ander model voor deze rol.");
      }
    }
    return { text, usage: openaiUsage(p.model, usage), aborted: false };
  } catch (e) {
    if (p.signal?.aborted || e instanceof Anthropic.APIUserAbortError || e instanceof OpenAI.APIUserAbortError) {
      return {
        text,
        usage: estimateUsage(p.model, p.system.length + (p.history ?? []).join("").length + p.instruction.length, text.length),
        aborted: true,
      };
    }
    throw e;
  }
}

// ---------- gewone tekst (kort) ----------

export async function generateText(p: Prompt): Promise<{ text: string; usage: Usage; usedModel?: ModelConfig }> {
  const r = await streamText(p, () => {});
  return { text: r.text.trim(), usage: r.usage, usedModel: r.usedModel };
}

// ---------- JSON met zod ----------

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("geen JSON gevonden");
  return JSON.parse(raw.slice(start, end + 1));
}

async function jsonViaText<S extends z.ZodType>(schema: S, p: Prompt): Promise<{ data: z.infer<S>; usage: Usage }> {
  const r = await streamOnce(
    { ...p, instruction: `${p.instruction}\n\nAntwoord ALLEEN met geldige JSON volgens het gevraagde formaat. Geen uitleg eromheen.` },
    () => {},
  );
  const parsed = schema.safeParse(extractJson(r.text));
  if (!parsed.success) throw Object.assign(new Error(`JSON klopt niet: ${parsed.error.message.slice(0, 300)}`), { usage: r.usage });
  return { data: parsed.data, usage: r.usage };
}

/**
 * Vraagt het model om JSON die aan het zod-schema voldoet.
 * Eerst via structured outputs; lukt dat niet (bijv. eigen modelnaam), dan via tekst.
 * `retries` bepaalt hoe vaak we het na een ongeldig antwoord opnieuw proberen.
 */
export async function generateJson<S extends z.ZodType>(schema: S, p: Prompt, retries = 1) {
  return withFallback(p, (m) => jsonOnce(schema, { ...p, model: m }, retries));
}

async function jsonOnce<S extends z.ZodType>(
  schema: S,
  p: Prompt,
  retries = 1,
): Promise<{ data: z.infer<S>; usage: Usage }> {
  let usage = emptyUsage(p.model.provider, p.model.model);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt =
      attempt === 0
        ? p
        : { ...p, instruction: `${p.instruction}\n\nLet op: je vorige antwoord was geen geldige JSON volgens het schema. Probeer het opnieuw.` };
    try {
      if (p.model.provider === "anthropic") {
        const client = await anthropic();
        const res = await client.messages.parse({
          model: p.model.model,
          max_tokens: p.maxTokens ?? 8000,
          system: anthropicSystem(prompt),
          messages: [{ role: "user", content: anthropicContent(prompt) }],
          ...anthropicExtras(prompt),
          output_config: {
            ...(anthropicExtras(prompt).output_config ?? {}),
            format: zodOutputFormat(schema),
          },
        });
        usage = addUsage(usage, anthropicUsage(p.model, res.usage));
        if (res.parsed_output) return { data: res.parsed_output as z.infer<S>, usage };
        lastError = new Error("leeg antwoord");
      } else if (isCompat(p.model)) {
        const client = await compat(p.model);
        const res = await client.chat.completions.parse({
          model: p.model.model,
          messages: compatMessages(prompt),
          max_tokens: (p.maxTokens ?? 8000) + 4000,
          response_format: zodResponseFormat(schema, "uitvoer"),
          ...compatExtras(prompt),
        });
        usage = addUsage(usage, compatUsage(p.model, res.usage));
        const parsed = res.choices[0]?.message.parsed;
        if (parsed) return { data: parsed as z.infer<S>, usage };
        lastError = new Error("leeg antwoord");
      } else {
        const client = await openai();
        const res = await client.responses.parse({
          model: p.model.model,
          instructions: prompt.system,
          input: openaiInput(prompt),
          max_output_tokens: (p.maxTokens ?? 8000) + 4000,
          prompt_cache_key: p.cacheKey,
          text: { format: zodTextFormat(schema, "uitvoer") },
          ...openaiReasoning(prompt),
        });
        usage = addUsage(usage, openaiUsage(p.model, res.usage));
        if (res.output_parsed) return { data: res.output_parsed as z.infer<S>, usage };
        lastError = new Error("leeg antwoord");
      }
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 422) {
        // Model ondersteunt structured outputs niet: val terug op tekst.
        try {
          const r = await jsonViaText(schema, prompt);
          return { data: r.data, usage: addUsage(usage, r.usage) };
        } catch (e2) {
          const u = (e2 as { usage?: Usage }).usage;
          if (u) usage = addUsage(usage, u);
          lastError = e2;
        }
      } else if (status) {
        throw e;
      }
    }
  }
  if (lastError instanceof AppError) throw Object.assign(lastError, { usage });
  console.error("generateJson mislukt", lastError);
  throw Object.assign(
    new AppError(
      "De AI gaf een antwoord dat we niet konden lezen.",
      "Probeer het nog een keer. Lukt het opnieuw niet, kies dan bij Geavanceerd een ander model.",
    ),
    { usage },
  );
}

// ---------- onderzoek met webzoeken (huiswerk) ----------

export async function research(p: Prompt & { webSearch: boolean }, onLooking: (label: string) => void) {
  return withFallback(p, (m) => researchOnce({ ...p, model: m }, onLooking));
}

async function researchOnce(
  p: Prompt & { webSearch: boolean },
  onLooking: (label: string) => void,
): Promise<{ text: string; usage: Usage }> {
  // Gemini en Grok zoeken hier niet zelf op het web; ze werken met de bijlages.
  if (isCompat(p.model)) return streamOnce(p, () => {});
  try {
    if (p.model.provider === "anthropic") {
      const client = await anthropic();
      const tools: Anthropic.ToolUnion[] =
        p.webSearch && p.model.webSearchTool
          ? [
              {
                type: p.model.webSearchTool,
                name: "web_search",
                max_uses: 4,
                user_location: { type: "approximate", country: "NL", city: "Amsterdam", timezone: "Europe/Amsterdam" },
              } as Anthropic.ToolUnion,
            ]
          : [];
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: anthropicContent(p) }];
      let usage = emptyUsage(p.model.provider, p.model.model);
      let text = "";
      for (let i = 0; i < 4; i++) {
        const stream = client.messages.stream({
          model: p.model.model,
          max_tokens: p.maxTokens ?? 6000,
          system: anthropicSystem(p),
          messages,
          ...(tools.length ? { tools } : {}),
          ...anthropicExtras(p),
        });
        stream.on("contentBlock", (b) => {
          if (b.type === "server_tool_use") {
            const q = (b.input as { query?: string })?.query;
            if (q) onLooking(`Zoekt: ${q}`);
          } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
            for (const r of b.content.slice(0, 3)) onLooking(`Leest: ${r.title}`);
          }
        });
        const msg = await stream.finalMessage();
        usage = addUsage(usage, anthropicUsage(p.model, msg.usage));
        text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        if (msg.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: msg.content });
      }
      return { text, usage };
    }
    const client = await openai();
    const stream = await client.responses.create({
      model: p.model.model,
      instructions: p.system,
      input: openaiInput(p),
      stream: true,
      max_output_tokens: (p.maxTokens ?? 6000) + 4000,
      ...(p.webSearch ? { tools: [{ type: "web_search" as const, user_location: { type: "approximate" as const, country: "NL", city: "Amsterdam" } }] } : {}),
      ...openaiReasoning(p),
    });
    let text = "";
    let usage: OpenAI.Responses.ResponseUsage | undefined;
    for await (const ev of stream) {
      if (ev.type === "response.output_text.delta") text += ev.delta;
      else if (ev.type === "response.output_item.done" && ev.item.type === "web_search_call") {
        const action = (ev.item as { action?: { query?: string } }).action;
        if (action?.query) onLooking(`Zoekt: ${action.query}`);
      } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
        usage = ev.response.usage ?? undefined;
      }
    }
    return { text, usage: openaiUsage(p.model, usage) };
  } catch (e) {
    throw e;
  }
}

// ---------- verbindingstest ----------

export async function testAnthropic(key: string) {
  const client = new Anthropic({ apiKey: key, maxRetries: 0 });
  await client.models.list({ limit: 1 });
}

export async function testOpenAI(key: string) {
  const client = new OpenAI({ apiKey: key, maxRetries: 0 });
  await client.models.list();
}

export async function testCompat(provider: "google" | "xai", key: string) {
  const client = new OpenAI({ apiKey: key, baseURL: compatBaseURL(provider), maxRetries: 0 });
  await client.models.list();
}

export { openai as openaiClient };
