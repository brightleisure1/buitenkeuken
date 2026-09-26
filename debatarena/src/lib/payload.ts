import type { Message, Run, Step } from "./types";
import type { UsageSummary } from "./usage";

export interface RunPayload {
  run: Run;
  messages: Message[];
  step: Step | null;
  usage: UsageSummary;
  attachments: { id: string; name: string; kind: string }[];
  keys: { anthropic: boolean; openai: boolean; google: boolean; xai: boolean; elevenlabs: boolean };
  models: { key: string; label: string }[];
  readers: Record<string, string[]>;
  /** Stem per rol-id, plus 'baas' */
  stemmen?: Record<string, string>;
}
