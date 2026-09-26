import { friendly } from "@/lib/errors";
import { testAnthropic, testOpenAI } from "@/lib/llm";
import { body, handle } from "@/lib/route";
import { getKey, PROVIDER_LABEL, type KeyName } from "@/lib/settings";
import { fetchVoices } from "@/lib/voices";

export const POST = handle(async (req: Request) => {
  const { provider, key: typed } = await body<{ provider: KeyName; key?: string }>(req);
  const key = typed?.trim() || (await getKey(provider));
  if (!key) {
    return Response.json({ ok: false, error: "Er is nog geen sleutel ingevuld.", oplossing: "Plak eerst je sleutel in het veld." });
  }
  try {
    if (provider === "anthropic") await testAnthropic(key);
    else if (provider === "openai") await testOpenAI(key);
    else {
      const voices = await fetchVoices(key);
      return Response.json({ ok: true, melding: `Verbonden. ${voices.length} stemmen gevonden.` });
    }
    return Response.json({ ok: true, melding: "Verbonden. Alles werkt." });
  } catch (e) {
    const err = friendly(e, PROVIDER_LABEL[provider]);
    return Response.json({ ok: false, error: err.message, oplossing: err.oplossing });
  }
});
