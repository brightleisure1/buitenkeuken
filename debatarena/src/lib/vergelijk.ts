import "server-only";
import { attachmentImages, attachmentText, runAttachments } from "./attachments";
import { MODELS, PROVIDERS } from "./config";
import { AppError } from "./errors";
import { generateJson } from "./llm";
import { getMessages, getRun, updateRun } from "./runs";
import { EnkelAdviesSchema } from "./schemas";
import { availableKeys } from "./settings";
import { recordUsage } from "./usage-db";
import type { Vergelijking } from "./types";

/**
 * De hamvraag: levert het debat een beter advies op dan één keer het slimste model vragen?
 * Zelfde vraag, zelfde bijlages, zelfde vaststaande besluiten; het model denkt diep na.
 */
export async function makeComparison(id: string): Promise<Vergelijking> {
  const run = await getRun(id);
  if (!run.result) throw new AppError("Er is nog geen advies om mee te vergelijken.", "Laat de voorzitter eerst afronden.");
  if (run.result.vergelijking) return run.result.vergelijking;

  const keys = await availableKeys();
  const model =
    MODELS.find((m) => m.key === "claude-sterk" && keys.anthropic) ??
    MODELS.find((m) => m.tier === "sterk" && m.provider !== "xai" && keys[m.provider]) ??
    MODELS.find((m) => keys[m.provider]);
  if (!model) throw new AppError("Er is geen AI-sleutel om mee te vergelijken.", "Voeg bij Instellingen een sleutel toe.");

  const attachments = await runAttachments(id);
  const att = attachmentText(attachments);
  const decisions = (await getMessages(id)).filter((m) => m.kind === "boss" && m.meta.action === "hamer").map((m) => `- ${m.content}`);

  const { data, usage } = await generateJson(
    EnkelAdviesSchema,
    {
      model,
      system:
        "Je bent een ervaren, nuchtere adviseur voor Nederlandse bedrijven. Je adviseert de baas, die zelf besluit. Denk grondig na, wees concreet (bedragen, termijnen, wie wat doet) en zeg eerlijk wat je niet weet.",
      images: await attachmentImages(attachments),
      instruction: `HET VRAAGSTUK VAN DE BAAS:
${run.question}
${att ? `\nBIJLAGES:\n${att}\n` : ""}${decisions.length ? `\nDEZE BESLUITEN STAAN AL VAST:\n${decisions.join("\n")}\n` : ""}
Geef je advies:
- uitslag: je advies in één korte, krachtige zin.
- samenvatting: maximaal 3 zinnen.
- strategie: 3 tot 5 stappen, elk met waarom en een eerste actie die morgen kan beginnen.
- risicos: 2 tot 4 risico's of aannames die de baas moet checken.
Gewone taal, geen jargon.`,
      maxTokens: 6000,
      deep: true,
    },
    1,
  );
  const eur = await recordUsage(id, "vergelijking", usage);
  const vergelijking: Vergelijking = {
    label: `${PROVIDERS[model.provider].naam}, sterkste`,
    model: model.model,
    advies: data,
    kosten_eur: eur,
    aIs: Math.random() < 0.5 ? "debat" : "enkel",
  };
  await updateRun(id, { result: { ...run.result, vergelijking } });
  return vergelijking;
}

/** Jouw oordeel na de blinde vergelijking bewaren. */
export async function saveChoice(id: string, keuze: "debat" | "enkel" | "gelijk") {
  const run = await getRun(id);
  const v = run.result?.vergelijking;
  if (!run.result || !v) throw new AppError("Er is nog geen vergelijking.", "Klik eerst op 'Vergelijk'.");
  await updateRun(id, { result: { ...run.result, vergelijking: { ...v, keuze } } });
  return { ...v, keuze };
}
