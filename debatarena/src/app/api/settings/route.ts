import { handle, body } from "@/lib/route";
import { maskedKeys, saveKeys, type KeyName } from "@/lib/settings";
import { MODELS } from "@/lib/config";

export const GET = handle(async () => {
  return Response.json({ keys: await maskedKeys(), models: MODELS.map((m) => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })) });
});

export const POST = handle(async (req: Request) => {
  const input = await body<Partial<Record<KeyName, string | null>>>(req);
  const clean: Partial<Record<KeyName, string | null>> = {};
  for (const k of ["anthropic", "openai", "google", "xai", "elevenlabs"] as KeyName[]) {
    if (k in input) clean[k] = input[k];
  }
  await saveKeys(clean);
  return Response.json({ keys: await maskedKeys() });
});
