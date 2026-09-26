import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function secret() {
  const s = process.env.ENCRYPTION_KEY || process.env.APP_PASSWORD;
  if (!s) throw new Error("ENCRYPTION_KEY of APP_PASSWORD ontbreekt");
  return createHash("sha256").update(`debatarena:${s}`).digest();
}

/** AES-256-GCM. Uitvoer: iv.tag.data (base64url) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string | null {
  try {
    const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", secret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function randomToken(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}
