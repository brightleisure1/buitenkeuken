import { body, handle } from "@/lib/route";
import { getSetting, setSetting } from "@/lib/settings";
import { debateVoices, listVoices, refreshVoices } from "@/lib/voices";

/** Alle stemmen uit je bibliotheek, plus welke de Debatarena gebruikt. */
export const GET = handle(async (req: Request) => {
  const fresh = new URL(req.url).searchParams.get("vernieuw") === "1";
  const voices = fresh ? await refreshVoices() : await listVoices();
  const inUse = (await debateVoices()).map((v) => v.id);
  const chosen = (await getSetting<string[]>("voice_selection")) ?? [];
  return Response.json({ voices, inUse, eigenKeuze: chosen.length > 0 });
});

/** Eigen stemkeuze opslaan (lege lijst = automatisch: Nederlandse stemmen eerst). */
export const POST = handle(async (req: Request) => {
  const { ids } = await body<{ ids?: string[] }>(req);
  await setSetting("voice_selection", Array.isArray(ids) ? ids.slice(0, 50) : []);
  return Response.json({ ok: true, inUse: (await debateVoices()).map((v) => v.id) });
});
