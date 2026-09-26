import { z } from "zod";

// Let op: geen optionele velden en geen min/max; structured outputs van beide aanbieders
// kunnen daar niet altijd mee overweg. Grenzen handhaven we achteraf in code.

export const CastRoleSchema = z.object({
  id: z.string().describe("Bestaande id laten staan. Nieuwe rol: 'nieuw'."),
  naam: z.string().describe("Voornaam en achternaam, Nederlands klinkend of passend bij de afkomst"),
  functie: z.string().describe("Functietitel in gewone taal, bijv. 'Inkoper bij een groothandel'"),
  perspectief: z.string().describe("Vanuit welk belang kijkt deze rol, in één zin"),
  instructie: z.string().describe("Hoe deze rol zich gedraagt en wat hij bewaakt, 2-3 zinnen"),
  zin: z.string().describe("Eén pakkende zin voor op de kaart, max 15 woorden"),
  modelKey: z.string(),
  stemId: z.string().nullable(),
  webzoeken: z.boolean(),
  isJury: z.boolean(),
  isKritisch: z.boolean(),
  ongezouten: z
    .boolean()
    .describe("Alleen voor rollen met een Grok-model: true = ongecensureerd. Alleen aanzetten als de baas erom vraagt."),
  cliche: z.string().describe("Id van een vergadercliché uit de lijst, of '' voor geen"),
  uiterlijk: z
    .string()
    .describe("Engelse omschrijving voor een karikatuurportret: leeftijd, geslacht, afkomst, kleding, attribuut van het beroep, karakter"),
});

export const CastSchema = z.object({
  titel: z.string().describe("Korte titel van het debat, max 6 woorden"),
  rollen: z.array(CastRoleSchema),
  rondes: z.number().int(),
  stemmen: z.enum(["uit", "jury", "iedereen"]),
  vergadercliches: z.boolean().describe("Fun-modus. Standaard false. true als de baas het grappig wil of vergaderclichés wil"),
  bijlages: z.array(
    z.object({
      bijlageId: z.string(),
      voor: z.string().describe("'iedereen' of de id van één rol"),
    }),
  ),
});

export const CastChatSchema = z.object({
  antwoord: z.string().describe("Kort, vriendelijk antwoord aan de gebruiker over wat je hebt aangepast (1-2 zinnen)"),
  cast: CastSchema,
});

export const HomeworkSchema = z.object({
  feiten: z.array(z.object({ feit: z.string(), bron: z.string() })),
});

export const EnkelAdviesSchema = z.object({
  uitslag: z.string().describe("Het advies aan de baas in één korte, krachtige zin (max 12 woorden)"),
  samenvatting: z.string().describe("3 tot 5 zinnen"),
  strategie: z.array(z.object({ stap: z.string(), waarom: z.string(), eersteActie: z.string() })).describe("3 tot 5 stappen"),
  aannames: z.array(z.object({ aanname: z.string(), risico: z.string(), hoeTesten: z.string() })).describe("3 tot 5 aannames"),
});

export const JuryResultSchema = z.object({
  uitslag: z.string().describe("Het advies aan de baas in één korte, krachtige zin (max 12 woorden)"),
  samenvatting: z.string().describe("3 tot 5 zinnen"),
  besluitenVanDeBaas: z.array(z.string()),
  strategie: z.array(z.object({ stap: z.string(), waarom: z.string(), eersteActie: z.string() })),
  aannames: z.array(
    z.object({
      aanname: z.string(),
      risico: z.string(),
      hoeTesten: z.string(),
      onbewezen: z.boolean().describe("true als dit een bewering zonder bron was"),
    }),
  ),
  onenigheid: z.array(
    z.object({
      punt: z.string(),
      standpuntPerRol: z.array(z.object({ rol: z.string(), standpunt: z.string() })),
    }),
  ),
  bronnen: z.array(z.object({ naam: z.string(), gebruiktDoor: z.string() })),
  volgendeStappen: z.array(z.string()),
  besteQuote: z.object({ tekst: z.string(), rol: z.string() }),
});

export const HighlightsSchema = z.object({
  momenten: z.array(z.object({ nummer: z.number().int(), waarom: z.string() })),
});

// ---------- Review-keten ----------

export const AdviesDocSchema = z.object({
  besluit: z.string().describe("Het besluit dat je adviseert, in één korte, krachtige zin (max 15 woorden)"),
  samenvatting: z.string().describe("3 tot 5 zinnen: wat, waarom en onder welke voorwaarde"),
  opties: z.array(z.object({ optie: z.string(), voor: z.string(), tegen: z.string() })).describe("2 tot 4 serieuze opties, inclusief niets doen als dat reëel is"),
  analyse: z.string().describe("De onderbouwing in gewone alinea's, max 600 woorden"),
  aannames: z.array(z.object({ aanname: z.string(), risico: z.string(), hoeTesten: z.string() })).describe("3 tot 6 aannames"),
  stappen: z
    .array(z.object({ stap: z.string(), waarom: z.string(), eersteActie: z.string(), eigenaar: z.string(), termijn: z.string() }))
    .describe("3 tot 6 stappen"),
});

export const ReviewSchema = z.object({
  punten: z
    .array(
      z.object({
        zwaarte: z.enum(["hoog", "midden", "laag"]).describe("hoog = het besluit kan hierop misgaan; midden = wezenlijk beter; laag = detail"),
        punt: z.string().describe("Wat er mis is of ontbreekt, in 1 tot 3 zinnen"),
        voorstel: z.string().describe("Concreet wat er in het stuk moet veranderen"),
      }),
    )
    .describe("Hooguit het gevraagde aantal punten; leeg als het stuk vanuit jouw blik goed is"),
});

export const HerzieningSchema = z.object({
  oordelen: z.array(z.object({ id: z.string(), oordeel: z.enum(["over", "deels", "niet"]), reden: z.string().describe("Eén zin") })),
  document: AdviesDocSchema,
  wijzigingen: z.array(z.string()).describe("Wat er in deze versie veranderde, max 8 korte regels"),
});

export const SlotcheckSchema = z.object({
  oordeel: z.string().describe("2 tot 3 zinnen: is dit advies klaar om op te besluiten, en waar let de baas op"),
  vertrouwen: z.enum(["laag", "midden", "hoog"]),
  waaromVertrouwen: z.string().describe("Eén zin"),
  laatsteAanvullingen: z.array(z.string()).describe("Max 3 dingen die nog niemand noemde, vanuit perspectieven die nog niet aan bod kwamen"),
  nietOvergenomen: z.array(z.object({ punt: z.string(), van: z.string(), reden: z.string() })).describe("De belangrijkste punten die bewust niet zijn overgenomen, max 5"),
  besteInzicht: z.object({ tekst: z.string().describe("Het review-inzicht dat het advies het meest verbeterde, max 25 woorden"), van: z.string() }),
});

export const IntakeSchema = z.object({
  vragen: z.array(z.string()).describe("0 tot 3 korte vragen die het advies echt beter maken"),
});
