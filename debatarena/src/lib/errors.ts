/** Een fout in gewone taal, met een oplossing erbij. */
export class AppError extends Error {
  constructor(
    message: string,
    public oplossing: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type Who = "Anthropic" | "OpenAI" | "Google" | "xAI" | "ElevenLabs" | "de AI";

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return undefined;
}

/** Zet elke fout om naar een begrijpelijke melding met oplossing. */
export function friendly(e: unknown, who: Who = "de AI"): AppError {
  if (e instanceof AppError) return e;
  const status = statusOf(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401 || status === 403) {
    return new AppError(
      `De sleutel voor ${who} wordt niet geaccepteerd.`,
      "Ga naar Instellingen, plak de sleutel opnieuw en klik op 'Test verbinding'.",
      400,
    );
  }
  if (status === 404) {
    return new AppError(
      `${who} kent dit model niet.`,
      "Kies bij Geavanceerd een ander model of controleer de modelnaam in het vrije veld.",
      400,
    );
  }
  if (status === 429) {
    return new AppError(
      `${who} vindt het even te druk, of je tegoed is op.`,
      "Wacht een minuut en probeer het opnieuw. Blijft het gebeuren? Kijk of er nog tegoed op je account staat.",
      429,
    );
  }
  if (status === 529 || (status && status >= 500)) {
    return new AppError(
      `${who} heeft een storing.`,
      "Probeer het over een minuut opnieuw, of kies bij Geavanceerd een model van een andere aanbieder.",
      503,
    );
  }
  if (status === 400) {
    return new AppError(
      `${who} kon dit verzoek niet verwerken.`,
      "Probeer het opnieuw. Gebruik je een eigen modelnaam? Kies dan even een standaardmodel.",
      400,
    );
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network|timed? ?out/i.test(msg)) {
    return new AppError(
      `Geen verbinding met ${who}.`,
      "Controleer de internetverbinding van de server en probeer het opnieuw.",
      503,
    );
  }
  console.error(e);
  return new AppError(
    "Er ging iets mis dat we niet hadden verwacht.",
    "Probeer het opnieuw. Blijft het misgaan? Herlaad de pagina.",
    500,
  );
}

export function errorResponse(e: unknown, who?: Who) {
  const err = friendly(e, who);
  return Response.json({ error: err.message, oplossing: err.oplossing }, { status: err.status });
}
