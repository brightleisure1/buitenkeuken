import { friendly } from "@/lib/errors";
import { KEY_INFO, keyWarning, type KeyStatus } from "@/lib/keys";
import { testAnthropic, testCompat, testOpenAI } from "@/lib/llm";
import { body, handle } from "@/lib/route";
import { getKey, getSetting, PROVIDER_LABEL, setSetting, type KeyName } from "@/lib/settings";
import { fetchVoices } from "@/lib/voices";
import { refreshModels } from "@/lib/model-discovery";

async function remember(provider: KeyName, s: KeyStatus) {
  const all = (await getSetting<Partial<Record<KeyName, KeyStatus>>>("key_status")) ?? {};
  all[provider] = s;
  await setSetting("key_status", all);
}

export const POST = handle(async (req: Request) => {
  const { provider, key: typed } = await body<{ provider: KeyName; key?: string }>(req);
  const stored = await getKey(provider);
  const key = typed?.trim() || stored;
  if (!key) {
    return Response.json({ ok: false, error: "Er is nog geen sleutel ingevuld.", oplossing: "Plak eerst je sleutel in het veld." });
  }
  const at = new Date().toISOString();
  try {
    let melding = "Verbonden. Alles werkt.";
    if (provider === "anthropic") await testAnthropic(key);
    else if (provider === "openai") await testOpenAI(key);
    else if (provider === "google" || provider === "xai") await testCompat(provider, key);
    else melding = `Verbonden. ${(await fetchVoices(key)).length} stemmen gevonden.`;
    if (provider !== "elevenlabs") {
      const ids = await refreshModels(provider, key).catch(() => null);
      if (ids) melding = `${melding} ${ids.length} modellen beschikbaar.`;
    }
    if (!typed || typed.trim() === stored) await remember(provider, { ok: true, at, melding });
    return Response.json({ ok: true, melding, at });
  } catch (e) {
    const status = (e as { status?: number }).status;
    let err = friendly(e, PROVIDER_LABEL[provider]);
    // Bij een verbindingstest betekent een 400/401/403 vrijwel altijd: de sleutel klopt niet.
    // (xAI en Google geven bij een foute sleutel een 400 in plaats van 401.)
    if (status === 400 || status === 401 || status === 403) {
      const info = KEY_INFO[provider];
      const hint = keyWarning(provider, key);
      err = Object.assign(err, {
        message: `${PROVIDER_LABEL[provider]} accepteert deze sleutel niet.`,
        oplossing: `${hint ?? `Controleer of je de hele sleutel hebt gekopieerd.`} Maak zo nodig een nieuwe aan op ${info.waar}.`,
      });
    }
    if (!typed || typed.trim() === stored) await remember(provider, { ok: false, at, melding: err.message });
    return Response.json({ ok: false, error: err.message, oplossing: err.oplossing, at });
  }
});
