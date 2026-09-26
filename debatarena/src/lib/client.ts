"use client";

export class ClientError extends Error {
  constructor(
    message: string,
    public oplossing?: string,
    public status?: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ClientError("Geen verbinding met de server.", "Controleer je internetverbinding en probeer het opnieuw.");
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ClientError(data.error ?? "Er ging iets mis.", data.oplossing ?? "Probeer het opnieuw.", res.status);
  }
  return data as T;
}

/** Leest een NDJSON-stream regel voor regel. */
export async function readNdjson(res: Response, onEvent: (e: Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

export function euro(n: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n);
}

export function datum(s: string) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(s));
}
