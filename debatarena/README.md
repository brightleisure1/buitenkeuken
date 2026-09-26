# Debatarena

Laat een team van AI-rollen hardop debatteren over jouw vraagstuk. Jij bent de baas: je kunt op elk moment ingrijpen, een besluit nemen met de hamer, of iemand direct een vraag stellen. Aan het eind doet de Jury uitspraak en krijg je een overzicht dat je kunt delen.

## Hoe het werkt

1. **Stel je vraag.** Typ of spreek in waar je over wilt debatteren. Sleep er desgewenst bestanden bij (pdf, Word, Excel, csv, tekst of afbeeldingen).
2. **Klik op "Stel samen".** Binnen een paar seconden staat er een team klaar: drie of vier rollen met elk een eigen belang, plus een Jury. Er zit altijd een kritische klant of koper bij.
3. **Pas aan als je wilt.** Zeg het gewoon: "Maak de inkoper strenger", "Voeg een jurist toe" of "Maar 2 rondes". Wie alles zelf wil regelen, vindt de knoppen onder *Geavanceerd*.
4. **Start het debat.** Terwijl jij kijkt, hebben de rollen hun huiswerk gedaan: ze lezen jouw bijlages, zoeken op het web en nemen maximaal vijf feiten met bron mee. Is dat nog bezig, dan zie je live wat ze bekijken.
5. **Grijp in wanneer je wilt.**
   - **Hand opsteken**: de spreker stopt direct, jij hebt het woord.
   - **Stop**: het debat staat stil. Daarna ga je verder of rond je af.
   - **Hamer**: je neemt een besluit. Vanaf dan gaat iedereen daarvan uit.
   - **Richting geven**: stuur het gesprek een kant op.
   - **Vraag aan één rol**: die rol antwoordt als eerste.
6. **De uitspraak.** De Jury vraagt of je nog iets wilt zeggen en doet dan uitspraak. Je krijgt een samenvatting, je besluiten, een strategie, de aannames (afvinkbaar), de punten van onenigheid, de bronnen en het hele gesprek.

Een uitspraak zonder bron noemen we *onbewezen*. Die komt vanzelf bij de aannames terecht, zodat je weet wat je nog moet checken.

## Delen

- **Oordeelkaart**: een plaatje met je vraag, de uitslag, de beste quote en de gezichten van het team. Vierkant voor LinkedIn, staand voor stories.
- **Replay-link**: iedereen met de link kan het debat terugkijken (alleen lezen, met stemmen als die aan stonden). Kosten en instructies blijven verborgen.
- **Hoogtepunten**: een korte versie van ongeveer een minuut met de scherpste momenten.
- Voordat je deelt, kun je woorden wegpoetsen (zoals klantnamen of bedragen) en de rollen anoniem maken.
- Exporteren kan naar PDF (A4) en Markdown.

## Stemmen

Met een ElevenLabs-sleutel praten de rollen hardop. Kies uit: uit, alleen de Jury, of iedereen (dan zijn beurten maximaal 80 woorden). Het tempo zet je op 1x, 1,25x of 1,5x. Stop en Hand opsteken kappen het geluid direct af.

## Installeren

Je hebt nodig: een [Supabase](https://supabase.com)-project (gratis kan), Node.js 20 of nieuwer, en minstens één sleutel van Anthropic of OpenAI.

1. **Database klaarzetten.** Open in Supabase de *SQL Editor*, plak de inhoud van `supabase/migrations/0001_debatarena.sql` en klik op *Run*. Dit maakt de tabellen en de opslagmappen voor portretten, audio en bijlages.
2. **Instellingen.** Kopieer `.env.example` naar `.env.local` en vul in:
   - `APP_PASSWORD`: het wachtwoord om binnen te komen.
   - `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`: te vinden in Supabase onder *Project Settings → API*. De service role key blijft op de server en komt nooit in de browser.
3. **Starten.**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000 en log in.
4. **Sleutels invullen.** Ga naar *Instellingen*, plak je sleutels en klik op *Test verbinding*. De sleutels worden versleuteld opgeslagen.

   | Sleutel | Waarvoor | Nodig? |
   |---|---|---|
   | Anthropic | Claude-rollen, het samenstellen van het team, de Jury | Deze of OpenAI |
   | OpenAI | GPT-rollen, de portretten, inspreken in browsers zonder spraakherkenning | Deze of Anthropic |
   | ElevenLabs | Stemmen | Nee |

   Met beide AI-sleutels krijg je een gemengd team van Claude en GPT. Zonder OpenAI-sleutel krijgen de rollen hun initialen in plaats van een portret.

**Online zetten** kan bijvoorbeeld op Vercel: importeer de repository, kies `debatarena` als *Root Directory* en zet dezelfde omgevingsvariabelen. Sommige stappen (portretten, huiswerk, de uitspraak) duren langer dan een halve minuut. Kies daarom een abonnement waarop functies tot 5 minuten mogen draaien.

## Modellen en kosten

Alle modellen en prijzen staan in één bestand: `src/lib/config.ts`. In de app zie je vriendelijke namen zoals "Claude, sterkste". Wil je per rol een ander model, vul dan onder *Geavanceerd* een eigen modelnaam in.

Tijdens het debat zie je onderaan de kosten tot nu toe, in euro's. Dit is een schatting op basis van de prijzen in het configuratiebestand. Controleer die prijzen af en toe; aanbieders passen ze aan.

Om kosten te besparen onthoudt de app de vaste context (vraagstuk, bijlages, huiswerk en het gesprek tot nu toe) tussen beurten via *prompt caching*. Alle AI-aanroepen lopen via de server; je sleutels komen nooit in de browser.

## Inspreken

Overal waar je kunt typen, kun je ook inspreken. De app gebruikt de spraakherkenning van je browser (Nederlands). Kan je browser dat niet, dan neemt de app je stem op en laat OpenAI hem uitschrijven.

## Pagina's

| Pagina | Wat je er doet |
|---|---|
| Start | Vraag stellen, team samenstellen, recente debatten |
| Arena | Het debat live volgen en ingrijpen, of terugkijken op 1x, 2x of 4x |
| Resultaat | De uitspraak, exporteren en delen |
| Geschiedenis | Alle debatten en bewaarde teams |
| Instellingen | Sleutels en verbindingstest |
| Replay (publiek) | Een gedeeld debat terugkijken |

## Teams bewaren

Tevreden over een team? Klik op *Bewaar dit team*. De volgende keer kies je het op het startscherm en ben je nog sneller klaar. Na een debat kun je ook direct verder met *Nog een keer met hetzelfde team?*.

## Voor ontwikkelaars

```bash
npm run dev        # ontwikkelserver
npm run build      # productiebuild
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # tests van de debatlogica
```

Next.js (App Router), TypeScript, Tailwind CSS en Supabase. De belangrijkste bestanden:

- `src/lib/config.ts`: modellen en prijzen
- `src/lib/casting.ts`: het team samenstellen en aanpassen, inclusief de castingregels
- `src/lib/planner.ts`: wie er aan de beurt is
- `src/lib/prompts.ts`: wat elke rol te horen krijgt
- `src/app/api/runs/[id]/turn/route.ts`: één beurt, live gestreamd
- `src/lib/prep.ts`: portretten en huiswerk op de achtergrond
- `supabase/migrations/0001_debatarena.sql`: tabellen en opslag
