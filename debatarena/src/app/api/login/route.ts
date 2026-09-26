import { cookies } from "next/headers";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { body, handle } from "@/lib/route";

export const POST = handle(async (req: Request) => {
  const { password } = await body<{ password?: string }>(req);
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    throw new AppError("Er is nog geen wachtwoord ingesteld voor deze app.", "Zet APP_PASSWORD in je omgevingsvariabelen en start de app opnieuw.");
  }
  if (!password || password !== pw) {
    await new Promise((r) => setTimeout(r, 600));
    throw new AppError("Dat wachtwoord klopt niet.", "Controleer hoofdletters en probeer het opnieuw.", 401);
  }
  (await cookies()).set(AUTH_COOKIE, await authToken(pw), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
});
