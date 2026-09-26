import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./errors";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Voorkeur: de service role key. Alternatief: de gewone (anon) sleutel plus een eigen geheim,
  // zie supabase/optioneel/zonder-service-key.sql.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_APP_SECRET;
  if (!url || !key) {
    throw new AppError(
      "De database is nog niet gekoppeld.",
      "Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in je omgevingsvariabelen en start de app opnieuw.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false },
    ...(secret ? { global: { headers: { "x-debatarena-secret": secret } } } : {}),
  });
  return client;
}

export function publicUrl(bucket: string, path: string) {
  return db().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function upload(bucket: string, path: string, data: Buffer | Uint8Array, contentType: string) {
  const { error } = await db().storage.from(bucket).upload(path, data, { contentType, upsert: true });
  if (error) {
    throw new AppError(
      "Opslaan van een bestand lukte niet.",
      "Controleer of de opslagmappen (portraits, audio, attachments) bestaan. Draai zo nodig de SQL-migratie opnieuw.",
    );
  }
  return publicUrl(bucket, path);
}

export async function download(bucket: string, path: string): Promise<Buffer | null> {
  const { data, error } = await db().storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
