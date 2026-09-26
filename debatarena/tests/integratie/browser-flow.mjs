// Klikt de app door in een echte browser, tegen de testomgeving (omgeving.sh).
// Gebruik: node tests/integratie/browser-flow.mjs [map-voor-schermafdrukken]
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright");
const APP = process.env.APP_URL ?? "http://127.0.0.1:3200";
const SHOTS = process.argv[2] ?? "/tmp/debat-shots";
const fs = await import("node:fs");
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let passed = 0;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    passed++;
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

async function noOverflow(page, label) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw + 1, `${label}: pagina is ${w}px breed bij scherm ${vw}px`);
  // Geen tekst die buiten zijn eigen vak loopt (behalve bewust scrollbare rijen).
  const spill = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("p, span, button, a, h1, h2, h3, label")) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).display === "inline") continue;
      if (el.closest("[class*='overflow-x-auto'], [class*='overflow-y-auto'], [class*='truncate'], [class*='line-clamp']")) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible") out.push(el.textContent.slice(0, 40));
      if (r.right > window.innerWidth + 1) out.push(`buiten beeld: ${el.textContent.slice(0, 40)}`);
    }
    return out.slice(0, 5);
  });
  assert.deepEqual(spill, [], `${label}: ${spill.join(" | ")}`);
}

/** Het nieuwste bericht moet in beeld staan (meescrollen). */
async function lastVisible(page, label) {
  const ok = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll(".animate-rise")].filter((e) => e.closest("[class*='overflow-y-auto']"));
    const last = bubbles.at(-1);
    if (!last) return true;
    const box = last.closest("[class*='overflow-y-auto']").getBoundingClientRect();
    const r = last.getBoundingClientRect();
    return r.bottom <= box.bottom + 4 && r.top < box.bottom;
  });
  assert.ok(ok, `${label}: nieuwste bericht staat niet in beeld`);
}

const VIEWPORTS = [
  ["groot", { width: 1440, height: 900 }],
  ["laptop", { width: 1280, height: 720 }],
  ["tablet", { width: 820, height: 1180 }],
  ["mobiel", { width: 390, height: 844 }],
  ["klein", { width: 360, height: 640 }],
];
const only = process.env.VIEWPORTS?.split(",");
for (const [label, viewport] of VIEWPORTS.filter(([l]) => !only || only.includes(l))) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|NotSupportedError|no supported source|media/i.test(m.text()) && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${label}-${n}.png`, fullPage: n.includes("vol") });

  await step(`[${label}] inloggen`, async () => {
    await page.goto(`${APP}/instellingen`);
    await page.fill("input[type=password]", "test123");
    await page.click("button:has-text('Binnenkomen')");
    await page.waitForURL("**/instellingen");
  });

  await step(`[${label}] sleutels: plakken, herkennen, testen, waarschuwen`, async () => {
    const keys = { Anthropic: "sk-ant-api03-" + "a".repeat(40), OpenAI: "sk-proj-" + "b".repeat(40), Google: "AIza" + "c".repeat(35), xAI: "xai-" + "d".repeat(40), ElevenLabs: "sk_" + "e".repeat(48) };
    for (const [naam, key] of Object.entries(keys)) {
      await page.fill("input[aria-label='API-sleutel']", key);
      await page.getByText(`Herkend: ${naam}`).waitFor();
      await page.click("button:has-text('Opslaan als')");
      await page.waitForFunction(() => document.querySelector("input[aria-label='API-sleutel']")?.value === "");
    }
    for (const p of ["anthropic", "openai", "google", "xai", "elevenlabs"]) {
      await page.locator(`[data-testid=status-${p}]`, { hasText: "Verbonden" }).waitFor({ timeout: 10000 });
    }
    // Verkeerde sleutel in het xAI-vak: waarschuwing vóór opslaan
    await page.locator("li[data-provider=xai] button:has-text('Vervangen')").click();
    await page.locator("li[data-provider=xai] input[type=password]").fill("sk-pil" + "x".repeat(40));
    await page.getByText(/lijkt een sleutel van OpenAI/).waitFor();
    await shot("1-sleutels");
    await page.locator("li[data-provider=xai] button:has-text('Vervangen')").click();
    await page.click("button:has-text('Test alle verbindingen')");
    await page.locator("[data-testid=status-xai]", { hasText: "Verbonden" }).waitFor();
    await noOverflow(page, "instellingen");
  });

  await step(`[${label}] vraag stellen en samenstellen`, async () => {
    await page.click("nav >> text=Start");
    await page.fill("#vraag", "Moeten we de prijzen met 10% verhogen? Graag met vergaderclichés.");
    const t = Date.now();
    await page.click("button:has-text('Stel samen')");
    await page.getByRole("button", { name: /Start debat/ }).waitFor();
    assert.ok(Date.now() - t < 5000, "voorstel binnen 5 seconden op het scherm");
    for (const ai of ["Claude", "ChatGPT", "Gemini", "Grok"]) {
      assert.ok(await page.locator("span", { hasText: new RegExp(`^${ai}$`) }).first().isVisible(), `label ${ai} zichtbaar`);
    }
    await page.getByText("🎭 De Parkeerder").first().waitFor();
    await noOverflow(page, "voorstel");
  });

  await step(`[${label}] deelnemer ongecensureerd zetten en fun-modus uit/aan`, async () => {
    await page.getByRole("radio", { name: /Ongecensureerd/ }).first().click();
    await page.getByText("🌶️ Ongecensureerd").first().waitFor();
    const sw = page.getByRole("switch", { name: /Fun-modus/ });
    await sw.click();
    await page.waitForFunction(() => !document.body.innerText.includes("🎭 De Parkeerder"));
    await sw.click();
    await page.getByText(/🎭 De /).first().waitFor();
    // Stemmen aanzetten voor iedereen
    await page.getByRole("radiogroup", { name: "Stemmen" }).getByRole("radio", { name: "Iedereen" }).click();
    await page.getByText("iedereen praat hardop").waitFor();
    // Persona aanpassen
    await page.getByRole("button", { name: "✏️ Aanpassen" }).first().click();
    await page.getByRole("dialog").getByLabel("Instructie en manier van praten").fill("Praat kortaf en droog. Wil eerst cijfers zien.");
    await shot("2b-persona");
    await noOverflow(page, "persona");
    await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForTimeout(3000); // portretten komen binnen
    await shot("2-voorstel-vol");
    await noOverflow(page, "voorstel");
  });

  await step(`[${label}] debat starten, beurten streamen, labels en kosten`, async () => {
    await page.getByRole("button", { name: /Start debat/ }).click();
    await page.waitForURL("**/arena/**");
    await page.getByText(/Ik ben /).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await lastVisible(page, "arena");
    await shot("3-arena");
    const said = (await (await fetch(`${process.env.FAKE_URL ?? "http://127.0.0.1:54321"}/__log`)).json()).filter((l) => l.provider === "elevenlabs");
    assert.ok(said.length > 0, "met stemmen aan wordt er hardop gesproken");
    assert.ok(!(await page.getByText("🎭").count()), "clichés niet zichtbaar in de arena");
    assert.ok(await page.getByText("Anneke", { exact: true }).count(), "'Dr.' niet als voornaam");
    assert.ok(await page.getByText(/opent de vergadering/).count(), "de voorzitter opent de vergadering");
    assert.ok(await page.getByRole("radiogroup", { name: "Tempo" }).count(), "leestempo instelbaar");
    await page.getByRole("button", { name: /tokens/ }).click();
    await page.getByText("Tokens en kosten van dit debat").waitFor();
    await page.getByText("Per rol").waitFor();
    await shot("4-kosten");
    await page.getByRole("button", { name: "Sluiten" }).click();
    await noOverflow(page, "arena");
  });

  await step(`[${label}] ingrijpen: hand opsteken, hamer 3x = ORDE!, konami`, async () => {
    await page.click("button:has-text('Hand opsteken')");
    await page.getByPlaceholder(/Je hebt het woord/).fill("Denk aan de contracten tot juni");
    await page.click("form button:has-text('Zeg')");
    await page.getByText("Denk aan de contracten tot juni").first().waitFor();
    const hamer = page.locator("button:has-text('Hamer')");
    await hamer.click();
    await hamer.click();
    await hamer.click();
    await page.getByText("ORDE!").waitFor();
    for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) await page.keyboard.press(k);
    await page.getByText("🕶️").first().waitFor();
    await page.getByPlaceholder(/Wat besluit je/).fill("We verhogen niet voor juni");
    await page.click("form button:has-text('Besluit')");
    await page.getByText("We verhogen niet voor juni").first().waitFor();
  });

  await step(`[${label}] censuur per deelnemer midden in het debat aanpassen`, async () => {
    await page.getByRole("button", { name: /🌶️ Censuur: 1 ongecensureerd/ }).click();
    await shot("4a-censuur");
    await noOverflow(page, "censuur");
    await page.getByRole("radio", { name: "Gecensureerd" }).first().click();
    await page.getByRole("button", { name: /🌶️ Censuur ▴/ }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("[role=radio][aria-checked=true]")].some((b) => b.textContent === "Gecensureerd"));
  });

  await step(`[${label}] stoppen, afronden, laatste woord, uitspraak, resultaat`, async () => {
    await page.click("button:has-text('Stop')");
    await page.getByText("De vergadering staat stil. Wat wil je?").waitFor();
    await shot("4b-stop");
    await noOverflow(page, "stop");
    await page.click("button:has-text('Afronden: Jury doet uitspraak')");
    await page.getByText("Wil je nog iets zeggen voordat ik uitspraak doe?").waitFor({ timeout: 30000 });
    await shot("5-laatste-woord");
    await page.click("button:has-text('Nee, doe maar uitspraak')");
    await page.waitForURL("**/resultaat/**", { timeout: 60000 });
    await page.getByText("Verhoog met 6%, gefaseerd").waitFor();
    await page.getByText("We verhogen niet voor juni").first().waitFor();
    await page.click("summary:has-text('Tokens en kosten')");
    await page.getByText("Per onderdeel").waitFor();
    await shot("6-resultaat-vol");
    await noOverflow(page, "resultaat");
  });

  await step(`[${label}] de hele vergadering beluisteren`, async () => {
    const url = page.url();
    await page.click("a:has-text('Beluister de vergadering')");
    await page.waitForURL("**/arena/**luister=1");
    await page.click("button:has-text('Beluister de hele vergadering')");
    await page.getByText(/Ik ben /).first().waitFor();
    await page.waitForTimeout(1500);
    await lastVisible(page, "beluisteren");
    await shot("6b-beluisteren");
    await page.goto(url);
  });

  await step(`[${label}] delen: preview, anoniem, link`, async () => {
    await page.click("button:has-text('Delen')");
    await page.getByText("Oordeelkaart").waitFor();
    await page.getByLabel("Rollen anoniem maken").check();
    await page.click("button:has-text('Voorbeeld bijwerken')");
    await page.click("button:has-text('Maak link')");
    const link = await page.locator("code").textContent();
    assert.match(link, /\/replay\//);
    await shot("7-delen");
    const pub = await browser.newPage({ viewport });
    await pub.goto(link);
    await pub.getByText("Start je eigen debat").waitFor();
    assert.ok(!(await pub.content()).includes("Pieter de Groot"), "anoniem in de replay");
    await pub.click("button:has-text('Afspelen')");
    await pub.waitForTimeout(1500);
    await pub.screenshot({ path: `${SHOTS}/${label}-8-replay.png` });
    await pub.close();
  });

  await step(`[${label}] geschiedenis toont tokens en kosten`, async () => {
    await page.goto(`${APP}/geschiedenis`);
    await page.getByText(/tokens/).first().waitFor();
    await noOverflow(page, "geschiedenis");
  });

  assert.deepEqual(errors, [], `[${label}] fouten in de browser: ${errors.join(" | ")}`);
  await ctx.close();
}

await browser.close();
console.log(`\nAlle ${passed} browserstappen geslaagd. Schermafdrukken: ${SHOTS}`);
