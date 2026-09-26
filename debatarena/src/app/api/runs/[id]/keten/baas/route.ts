import { AppError } from "@/lib/errors";
import { patchKeten } from "@/lib/keten";
import { body, handle } from "@/lib/route";

/**
 * De baas grijpt in: een eigen opmerking (wordt altijd verwerkt in de volgende versie),
 * of een beslissing over een reviewpunt ("over" = toch overnemen, "niet" = toch niet, null = terug naar het oordeel van de auteur).
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { opmerking, punt, override } = await body<{ opmerking?: string; punt?: string; override?: "over" | "niet" | null }>(req);
  if (!opmerking?.trim() && !punt) throw new AppError("Je bericht is nog leeg.", "Typ wat je wilt meegeven, of kies bij een punt 'toch overnemen'.");
  const keten = await patchKeten(id, (k) => {
    if (opmerking?.trim()) k.baas.opmerkingen.push({ id: `b${Date.now()}`, tekst: opmerking.trim(), verwerkt: false });
    if (punt) {
      if (override) k.baas.overrides[punt] = override;
      else delete k.baas.overrides[punt];
    }
  });
  return Response.json({ keten });
});
