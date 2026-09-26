import { AppError } from "@/lib/errors";
import { detectProvider, type KeyProvider } from "@/lib/keys";
import { MODELS } from "@/lib/config";
import { body, handle } from "@/lib/route";
import { getSetting, maskedKeys, saveKeys, setSetting, type KeyName } from "@/lib/settings";
import { usagePerProvider } from "@/lib/usage-db";
import { defaultLimit } from "@/lib/budget";
import { modelMapping } from "@/lib/model-discovery";
import type { KeyStatus } from "@/lib/keys";

const NAMES: KeyName[] = ["anthropic", "openai", "google", "xai", "elevenlabs"];

async function state() {
  const [keys, status, usage, mapping] = await Promise.all([
    maskedKeys(),
    getSetting<Partial<Record<KeyName, KeyStatus>>>("key_status"),
    usagePerProvider(30).catch(() => ({})),
    modelMapping().catch(() => ({}) as Record<string, string>),
  ]);
  return {
    keys,
    status: status ?? {},
    usage,
    kostenlimiet: await defaultLimit(),
    models: MODELS.map((m) => ({ key: m.key, label: m.label, provider: m.provider, model: mapping[m.key] ?? m.model, gevraagd: m.model })),
  };
}

export const GET = handle(async () => Response.json(await state()));

/**
 * Sleutels opslaan. Stuur {anthropic: "..."} (of null om te verwijderen),
 * of {auto: "..."}: dan herkennen we zelf van wie de sleutel is.
 */
export const POST = handle(async (req: Request) => {
  const input = await body<Partial<Record<KeyName, string | null>> & { auto?: string; kostenlimiet?: number | null }>(req);
  if (input.kostenlimiet !== undefined) {
    const eur = Number(input.kostenlimiet);
    if (!(eur > 0) || eur > 1000) throw new AppError("Dat is geen geldige limiet.", "Vul een bedrag in euro's in, bijvoorbeeld 2 of 2,50.");
    await setSetting("kostenlimiet", { eur: Math.round(eur * 100) / 100 });
    return Response.json(await state());
  }
  const clean: Partial<Record<KeyName, string | null>> = {};
  let detected: KeyProvider | null = null;
  if (input.auto !== undefined) {
    detected = detectProvider(input.auto);
    if (!detected) {
      throw new AppError(
        "We herkennen deze sleutel niet.",
        "Controleer of je de hele sleutel hebt gekopieerd, of plak hem in het vak van de juiste aanbieder hieronder.",
      );
    }
    clean[detected] = input.auto.trim();
  }
  for (const k of NAMES) if (k in input) clean[k] = input[k];
  await saveKeys(clean);
  // Oude testuitslag klopt niet meer voor een nieuwe of verwijderde sleutel.
  const status = (await getSetting<Partial<Record<KeyName, KeyStatus>>>("key_status")) ?? {};
  for (const k of Object.keys(clean) as KeyName[]) delete status[k];
  await setSetting("key_status", status);
  return Response.json({ ...(await state()), detected });
});
