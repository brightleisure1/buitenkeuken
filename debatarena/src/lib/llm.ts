import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  CACHE_READ_FACTOR,
  CACHE_WRITE_FACTOR,
  OPENAI_CACHED_FACTOR,
  WEB_SEARCH_PRICE_USD,
  type ModelConfig,
} from "./config";
import { AppError, friendly } from "./errors";
import { requireKey } from "./settings";

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

const who = (m: ModelConfig) => (m.provider === "anthropic" ? "Anthropic" : "OpenAI");

async function anthropic() {
  return new Anthropic({ apiKey: await requireKey("anthropic"), maxRetries: 2 });
}
async function openai() {
  return new OpenAI({ apiKey: await requireKey("openai"), maxRetries: 2 });
}

// ---------- kosten ----------

export function anthropicCost(m: ModelConfig, u: Anthropic.Usage | null | undefined): number {
  if (!u) return 0;
  const perIn = m.inputPrice / 1e6;
  const perOut = m.outputPrice / 1e6;
  return (
    u.input_tokens * perIn +
    (u.cache_creation_input_tokens ?? 0) * perIn * CACHE_WRITE_FACTOR +
    (u.cache_read_input_tokens ?? 0) * perIn * CACHE_READ_FACTOR +
    u.output_tokens * perOut +
    (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PRICE_USD
  );
}

export function openaiCost(m: ModelConfig, u: OpenAI.Responses.ResponseUsage | null | undefined): number {
  if (!u) return 0;
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return (
    ((u.input_tokens - cached) * m.inputPrice + cached * m.inputPrice * OPENAI_CACHED_FACTOR + u.output_tokens * m.outputPrice) /
    1e6
  );
}

function estimateCost(m: ModelConfig, inChars: number, outChars: number) {
  return ((inChars / 4) * m.inputPrice + (outChars / 4) * m.outputPrice) / 1e6;
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

function openaiReasoning(p: Prompt) {
  const effort = p.deep ? "medium" : p.model.reasoning;
  return effort ? { reasoning: { effort } } : {};
}

// ---------- streamen van een beurt ----------

export interface StreamResult {
  text: string;
  costUsd: number;
  aborted: boolean;
}

export async function streamText(p: Prompt, onDelta: (t: string) => void): Promise<StreamResult> {
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
      return { text, costUsd: anthropicCost(p.model, final.usage), aborted: false };
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
    return { text, costUsd: openaiCost(p.model, usage), aborted: false };
  } catch (e) {
    if (p.signal?.aborted || e instanceof Anthropic.APIUserAbortError || e instanceof OpenAI.APIUserAbortError) {
      return {
        text,
        costUsd: estimateCost(p.model, p.system.length + (p.history ?? []).join("").length, text.length),
        aborted: true,
      };
    }
    throw friendly(e, who(p.model));
  }
}

// ---------- gewone tekst (kort) ----------

export async function generateText(p: Prompt): Promise<{ text: string; costUsd: number }> {
  const r = await streamText(p, () => {});
  return { text: r.text.trim(), costUsd: r.costUsd };
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

async function jsonViaText<S extends z.ZodType>(schema: S, p: Prompt): Promise<{ data: z.infer<S>; costUsd: number }> {
  const r = await generateText({
    ...p,
    instruction: `${p.instruction}\n\nAntwoord ALLEEN met geldige JSON volgens het gevraagde formaat. Geen uitleg eromheen.`,
  });
  const parsed = schema.safeParse(extractJson(r.text));
  if (!parsed.success) throw new Error(`JSON klopt niet: ${parsed.error.message.slice(0, 300)}`);
  return { data: parsed.data, costUsd: r.costUsd };
}

/**
 * Vraagt het model om JSON die aan het zod-schema voldoet.
 * Eerst via structured outputs; lukt dat niet (bijv. eigen modelnaam), dan via tekst.
 * `retries` bepaalt hoe vaak we het na een ongeldig antwoord opnieuw proberen.
 */
export async function generateJson<S extends z.ZodType>(
  schema: S,
  p: Prompt,
  retries = 1,
): Promise<{ data: z.infer<S>; costUsd: number }> {
  let cost = 0;
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
        cost += anthropicCost(p.model, res.usage);
        if (res.parsed_output) return { data: res.parsed_output as z.infer<S>, costUsd: cost };
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
        cost += openaiCost(p.model, res.usage);
        if (res.output_parsed) return { data: res.output_parsed as z.infer<S>, costUsd: cost };
        lastError = new Error("leeg antwoord");
      }
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 422) {
        // Model ondersteunt structured outputs niet: val terug op tekst.
        try {
          const r = await jsonViaText(schema, prompt);
          return { data: r.data, costUsd: cost + r.costUsd };
        } catch (e2) {
          lastError = e2;
        }
      } else if (status) {
        throw friendly(e, who(p.model));
      }
    }
  }
  if (lastError instanceof AppError) throw lastError;
  console.error("generateJson mislukt", lastError);
  throw new AppError(
    "De AI gaf een antwoord dat we niet konden lezen.",
    "Probeer het nog een keer. Lukt het opnieuw niet, kies dan bij Geavanceerd een ander model.",
  );
}

// ---------- onderzoek met webzoeken (huiswerk) ----------

export async function research(
  p: Prompt & { webSearch: boolean },
  onLooking: (label: string) => void,
): Promise<{ text: string; costUsd: number }> {
  try {
    if (p.model.provider === "anthropic") {
      const client = await anthropic();
      const tools: Anthropic.ToolUnion[] =
        p.webSearch && p.model.webSearchTool
          ? [{ type: p.model.webSearchTool, name: "web_search", max_uses: 4 } as Anthropic.ToolUnion]
          : [];
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: anthropicContent(p) }];
      let cost = 0;
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
        cost += anthropicCost(p.model, msg.usage);
        text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        if (msg.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: msg.content });
      }
      return { text, costUsd: cost };
    }
    const client = await openai();
    const stream = await client.responses.create({
      model: p.model.model,
      instructions: p.system,
      input: openaiInput(p),
      stream: true,
      max_output_tokens: (p.maxTokens ?? 6000) + 4000,
      ...(p.webSearch ? { tools: [{ type: "web_search" as const }] } : {}),
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
    return { text, costUsd: openaiCost(p.model, usage) };
  } catch (e) {
    throw friendly(e, who(p.model));
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

export { openai as openaiClient };
