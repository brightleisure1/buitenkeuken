import "server-only";
import { AppError } from "./errors";
import type { Attachment } from "./types";
import { db, download } from "./supabase";
import type { ImageInput } from "./llm";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function detectKind(name: string, mime: string): "pdf" | "docx" | "xlsx" | "csv" | "text" | "image" | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (IMAGE_MIMES.includes(mime) || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";
  if (["txt", "md", "markdown"].includes(ext) || mime.startsWith("text/")) return "text";
  return null;
}

export function imageMime(name: string, mime: string) {
  if (IMAGE_MIMES.includes(mime)) return mime;
  const ext = name.toLowerCase().split(".").pop();
  return ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
}

/** Zet een bestand om naar platte tekst. */
export async function extractText(kind: ReturnType<typeof detectKind>, buf: Buffer): Promise<string> {
  let text = "";
  try {
    if (kind === "pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await pdfText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
    } else if (kind === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (kind === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((sheet) => {
        parts.push(`## Blad: ${sheet.name}`);
        sheet.eachRow((row) => {
          const vals = (row.values as unknown[]).slice(1).map((v) => {
            if (v && typeof v === "object") {
              const o = v as { result?: unknown; text?: string; richText?: { text: string }[] };
              if (o.result !== undefined) return String(o.result);
              if (o.text) return o.text;
              if (o.richText) return o.richText.map((r) => r.text).join("");
              if (v instanceof Date) return v.toISOString().slice(0, 10);
            }
            return v == null ? "" : String(v);
          });
          parts.push(vals.join(" | "));
        });
      });
      text = parts.join("\n");
    } else {
      text = buf.toString("utf8");
    }
  } catch (e) {
    console.error("uitlezen mislukt", e);
    throw new AppError(
      "Dit bestand konden we niet uitlezen.",
      "Is het beveiligd of beschadigd? Sla het opnieuw op (bijv. als PDF of TXT) en sleep het er nog eens in.",
    );
  }
  text = text.replace(/\u0000/g, "").trim();
  if (text.length > MAX_TEXT_CHARS) text = `${text.slice(0, MAX_TEXT_CHARS)}\n[… ingekort, bestand was te lang]`;
  return text;
}

export async function runAttachments(runId: string): Promise<Attachment[]> {
  const { data } = await db().from("attachments").select("*").eq("run_id", runId).order("created_at");
  return (data ?? []) as Attachment[];
}

/** Bijlages die een bepaalde rol mag zien. */
export function attachmentsFor(all: Attachment[], assignment: Record<string, string>, roleId: string) {
  return all.filter((a) => {
    const to = assignment[a.id] ?? "iedereen";
    return to === "iedereen" || to === roleId;
  });
}

export function attachmentText(list: Attachment[]): string {
  return list
    .filter((a) => a.kind === "text" && a.text)
    .map((a) => `=== Bijlage: ${a.name} ===\n${a.text}`)
    .join("\n\n");
}

const imageCache = new Map<string, ImageInput>();

export async function attachmentImages(list: Attachment[]): Promise<ImageInput[]> {
  const out: ImageInput[] = [];
  for (const a of list) {
    if (a.kind !== "image" || !a.storage_path) continue;
    let img = imageCache.get(a.id);
    if (!img) {
      const buf = await download("attachments", a.storage_path);
      if (!buf) continue;
      img = { mime: a.mime, base64: buf.toString("base64") };
      imageCache.set(a.id, img);
    }
    out.push(img);
  }
  return out;
}
