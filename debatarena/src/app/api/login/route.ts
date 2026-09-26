import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { body, handle } from "@/lib/route";

/**
 * Een pincode is snel geraden, dus we remmen het raden af:
 * per apparaat (IP) 5 foute pogingen per kwartier, en voor iedereen samen 30 per uur.
 */
const PER_IP = { max: 5, ms: 15 * 60_000 };
const GLOBAAL = { max: 30, ms: 60 * 60_000 };
const fouten = new Map<string, number[]>();

function recent(key: string, ms: number) {
  const now = Date.now();
  const list = (fouten.get(key) ?? []).filter((t) => now - t < ms);
  fouten.set(key, list);
  return list;
}

function geblokkeerd(ip: string): number | null {
  const mine = recent(ip, PER_IP.ms);
  if (mine.length >= PER_IP.max) return mine[0] + PER_IP.ms - Date.now();
  const all = recent("*", GLOBAAL.ms);
  if (all.length >= GLOBAAL.max) return all[0] + GLOBAAL.ms - Date.now();
  return null;
}

function gelijk(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const POST = handle(async (req: Request) => {
  const { password } = await body<{ password?: string }>(req);
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    throw new AppError("Er is nog geen pincode ingesteld voor deze app.", "Zet APP_PASSWORD in je omgevingsvariabelen en start de app opnieuw.");
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "onbekend";
  const wacht = geblokkeerd(ip);
  if (wacht !== null) {
    const min = Math.max(1, Math.ceil(wacht / 60_000));
    throw new AppError("Te vaak een verkeerde pincode.", `Probeer het over ${min} ${min === 1 ? "minuut" : "minuten"} opnieuw.`, 429);
  }
  if (!password || !gelijk(password.trim(), pw)) {
    fouten.get(ip)!.push(Date.now());
    fouten.get("*")!.push(Date.now());
    await new Promise((r) => setTimeout(r, 800));
    throw new AppError("Die pincode klopt niet.", "Probeer het opnieuw.", 401);
  }
  // Gelukt: foute pogingen van dit apparaat vergeten (het totaal voor iedereen blijft staan).
  fouten.delete(ip);
  (await cookies()).set(AUTH_COOKIE, await authToken(pw), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
});
