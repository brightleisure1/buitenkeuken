/** Gedeeld tussen proxy en login-route; gebruikt Web Crypto zodat het overal draait. */
export const AUTH_COOKIE = "da_auth";

export async function authToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("debatarena-sessie-v1"));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidAuth(cookie: string | undefined): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw || !cookie) return false;
  const expected = await authToken(pw);
  if (expected.length !== cookie.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ cookie.charCodeAt(i);
  return diff === 0;
}
