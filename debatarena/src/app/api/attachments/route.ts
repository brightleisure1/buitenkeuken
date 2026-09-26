import { randomUUID } from "node:crypto";
import { detectKind, extractText, imageMime, MAX_FILE_BYTES } from "@/lib/attachments";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/route";
import { db, upload } from "@/lib/supabase";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("Er kwam geen bestand mee.", "Sleep het bestand opnieuw in het vak.");
  if (file.size > MAX_FILE_BYTES) {
    throw new AppError("Dit bestand is te groot (max. 15 MB).", "Verklein het bestand of sleep alleen het belangrijkste deel erin.");
  }
  const kind = detectKind(file.name, file.type);
  if (!kind) {
    throw new AppError(
      "Dit soort bestand kunnen we niet lezen.",
      "Gebruik pdf, docx, xlsx, csv, txt, md of een afbeelding (png, jpg, webp, gif).",
    );
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const id = randomUUID();
  let row: Record<string, unknown>;
  if (kind === "image") {
    const mime = imageMime(file.name, file.type);
    const path = `los/${id}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    await upload("attachments", path, buf, mime);
    row = { id, name: file.name, mime, kind: "image", storage_path: path, size: file.size };
  } else {
    const text = await extractText(kind, buf);
    if (!text) throw new AppError(`In ${file.name} staat geen leesbare tekst.`, "Is het een scan? Maak er een foto van en sleep die erin, dan leest de AI mee.");
    row = { id, name: file.name, mime: file.type || "text/plain", kind: "text", text, size: file.size };
  }
  const { error } = await db().from("attachments").insert(row);
  if (error) throw new AppError("Opslaan van de bijlage lukte niet.", "Controleer of de SQL-migratie is uitgevoerd en probeer het opnieuw.");
  return Response.json({
    attachment: { id, name: file.name, kind: row.kind, size: file.size, chars: typeof row.text === "string" ? row.text.length : 0 },
  });
});
