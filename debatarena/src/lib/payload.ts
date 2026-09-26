import type { Message, Run, Step } from "./types";

export interface RunPayload {
  run: Run;
  messages: Message[];
  step: Step | null;
  attachments: { id: string; name: string; kind: string }[];
  keys: { anthropic: boolean; openai: boolean; google: boolean; xai: boolean; elevenlabs: boolean };
  models: { key: string; label: string }[];
  readers: Record<string, string[]>;
}
