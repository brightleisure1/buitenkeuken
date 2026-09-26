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

## Persona's aanpassen

Klik op een rolkaart op **✏️ Aanpassen**. Daar pas je alles van een persona aan: naam, functie, waar hij op let, zijn instructie en manier van praten, welke AI hem speelt, zijn stem (met luisterknop), webzoeken, zijn vergadercliché en bij Grok de censuur. Met *Nieuw portret* tekent de tekenaar hem opnieuw. Tijdens de vergadering kan het ook: tik op een portret en kies *Persona aanpassen*.

De rollen zijn collega's uit je eigen bedrijf, en er zit altijd één klant of gast bij. Iedereen denkt vanuit Nederlandse bedrijven en praat zoals mensen aan tafel echt praten.

## Vergadering stoppen

Met **⏹ Stop** staat alles direct stil, ook het geluid. Je kiest dan: verder vergaderen, afronden (de Jury doet meteen uitspraak) of de vergadering beëindigen zonder uitspraak. Een beëindigde vergadering kun je later alsnog laten beoordelen. Vanuit *Geschiedenis* kun je een lopende vergadering ook stoppen.

## De hele vergadering beluisteren

Op de resultaatpagina staat **🎧 Beluister de vergadering**: de vergadering wordt afgespeeld met een stem voor elke rol en ook voor jou als baas. Wat nog niet was ingesproken, wordt dan ingesproken en bewaard. Met **⬇ Download als mp3** krijg je de hele vergadering als één audiobestand.

Bij *Instellingen → Stemmen* zie je al je ElevenLabs-stemmen. De app herkent je Nederlandse stemmen en gebruikt die automatisch. Je kunt ook zelf aanvinken welke stemmen meedoen.

## Als een AI het niet doet

De app vraagt zelf op welke modellen jouw sleutels mogen gebruiken. Bestaat een modelnaam uit de configuratie niet (meer), dan wordt automatisch het beste passende model gekozen. Werkt een model toch niet, dan neemt een ander het over: eerst een andere AI van hetzelfde niveau. In het gesprek zie je dan bijvoorbeeld "Gemini deed het niet, Claude sprak namens deze rol".

## Delen

- **Oordeelkaart**: een plaatje met je vraag, de uitslag, de beste quote en de gezichten van het team. Vierkant voor LinkedIn, staand voor stories.
- **Replay-link**: iedereen met de link kan het debat terugkijken (alleen lezen, met stemmen als die aan stonden). Kosten en instructies blijven verborgen.
- **Hoogtepunten**: een korte versie van ongeveer een minuut met de scherpste momenten.
- Voordat je deelt, kun je woorden wegpoetsen (zoals klantnamen of bedragen) en de rollen anoniem maken.
- Exporteren kan naar PDF (A4) en Markdown.

## Stemmen

Met een ElevenLabs-sleutel praten de rollen hardop. Kies uit: uit, alleen de Jury, of iedereen (dan zijn beurten maximaal 80 woorden). Het tempo zet je op 1x, 1,25x of 1,5x. Stop en Hand opsteken kappen het geluid direct af.

## Installeren

Je hebt nodig: een [Supabase](https://supabase.com)-project (gratis kan), Node.js 20 of nieuwer, en minstens één AI-sleutel: Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini) of xAI (Grok).

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
4. **Sleutels invullen.** Ga naar *Instellingen* en plak een sleutel in het gele vak. De app herkent zelf van welke aanbieder hij is, slaat hem versleuteld op en test hem meteen. Per aanbieder zie je een lampje (groen = verbonden), wanneer hij voor het laatst getest is, en hoeveel tokens en euro's je er de afgelopen 30 dagen mee hebt verbruikt. Plak je een sleutel in het verkeerde vak, dan waarschuwt de app je.

   | Sleutel | Waarvoor | Nodig? |
   |---|---|---|
   | Anthropic | Claude-rollen, het samenstellen van het team, de Jury | Minstens één van deze vier |
   | OpenAI | ChatGPT-rollen, de portretten, inspreken in browsers zonder spraakherkenning | |
   | Google | Gemini-rollen | |
   | xAI | Grok-rollen | |
   | ElevenLabs | Stemmen | Nee |

   Hoe meer AI-sleutels, hoe gemengder het team. Zonder OpenAI-sleutel krijgen de rollen hun initialen in plaats van een portret.

**Online zetten** kan bijvoorbeeld op Vercel: importeer de repository, kies `debatarena` als *Root Directory* en zet dezelfde omgevingsvariabelen. Sommige stappen (portretten, huiswerk, de uitspraak) duren langer dan een halve minuut. Kies daarom een abonnement waarop functies tot 5 minuten mogen draaien.

## Welke AI speelt wie?

Bij elke rol staat een gekleurd label: **Claude**, **ChatGPT**, **Gemini** of **Grok**. Je ziet het op de teamkaarten, onder de portretten in de arena, in de tekstballon en op de oordeelkaart. Zo zie je meteen hoe de AI's van elkaar verschillen.

Het team krijgt zoveel mogelijk verschillende AI's. Wil je het anders, zeg dan bijvoorbeeld "Laat de CFO door Gemini spelen", of kies het model onder *Geavanceerd*.

Gemini en Grok zoeken zelf niet op het web. Ze doen hun huiswerk met jouw bijlages.

### Grok: gecensureerd of ongecensureerd

Elke Grok-rol heeft een schakelaar: **Gecensureerd** (standaard) of **Ongecensureerd**. Ongecensureerd zegt Grok alles zonder filter: brutaal, sarcastisch en vloeken mag. Hij prikt door mooie praatjes heen, ook die van jou. Hij sloopt wel argumenten, niet mensen om wie ze zijn.

De schakelaar staat op de kaart van de Grok-rol, onder *Geavanceerd* en onderaan in de arena, zodat je hem ook midden in het debat kunt omzetten. Je kunt het ook gewoon zeggen: "Laat Grok zonder censuur los" of "Maak Grok weer gecensureerd". Een ongecensureerde rol herken je aan het pepertje 🌶️.

## Vergaderclichés

Zet op het voorstelscherm **🎭 Vergaderclichés** aan, of zeg het in je vraag ("met vergaderclichés"). Dan spelen een paar rollen, naast hun functie, een herkenbaar vergadertype: de Dominator, de Parkeerder, de Managementtaalspreker, de Rondvraagterrorist en nog 23 anderen. Sommige zijn tijdgebonden: de Late Binnenkomer komt in ronde 1 als laatste binnen ("Sorry, liep een beetje uit. Waar zijn we?"), de Stille Aanwezigheid zegt tot de laatste ronde vrijwel niets.

Welke rol welk type speelt, kies je zelf onder *Geavanceerd*. De Jury laat het gedrag niet meewegen en oordeelt op de inhoud.

## Tokens en kosten per debat

Onderaan in de arena zie je de kosten en het aantal tokens tot nu toe. Klik erop voor de uitsplitsing: per rol (met welke AI), per onderdeel (samenstellen, portretten, huiswerk, beurten, uitspraak, stemmen) en per model. Je ziet ook hoeveel tokens uit de cache kwamen; die kosten maar een fractie. Hetzelfde overzicht staat op de resultaatpagina, en in *Geschiedenis* zie je per debat de kosten en tokens.

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

**Integratietests.** In `tests/integratie/` staat een complete testomgeving: een echte Postgres met PostgREST, en een nepwolk die Claude, ChatGPT, Gemini, Grok, ElevenLabs en Supabase-opslag nabootst. Daarmee loopt een test de hele app door via de API (27 stappen) en een tweede in een echte browser op desktop en telefoon (20 stappen). Nodig: PostgreSQL 16, een [PostgREST-binary](https://github.com/PostgREST/postgrest/releases) en Playwright.

```bash
npm run build
POSTGREST_BIN=/pad/naar/postgrest tests/integratie/omgeving.sh start   # MODE=anon test de variant zonder service key
node tests/integratie/api-flow.mjs
node tests/integratie/browser-flow.mjs
tests/integratie/omgeving.sh stop
```

**Zonder service role key.** Heb je die niet bij de hand, zet dan `SUPABASE_ANON_KEY` en een zelfgekozen `SUPABASE_APP_SECRET`, en draai `supabase/optioneel/zonder-service-key.sql` met hetzelfde geheim. De database laat dan alleen verzoeken met dat geheim toe.

Next.js (App Router), TypeScript, Tailwind CSS en Supabase. De belangrijkste bestanden:

- `src/lib/config.ts`: modellen en prijzen
- `src/lib/casting.ts`: het team samenstellen en aanpassen, inclusief de castingregels
- `src/lib/planner.ts`: wie er aan de beurt is
- `src/lib/prompts.ts`: wat elke rol te horen krijgt
- `src/app/api/runs/[id]/turn/route.ts`: één beurt, live gestreamd
- `src/lib/prep.ts`: portretten en huiswerk op de achtergrond
- `src/lib/cliches.ts`: de vergaderclichés en wanneer ze wat doen
- `src/lib/usage.ts`: tokens en kosten optellen
- `supabase/migrations/`: tabellen, opslag en verbruik
