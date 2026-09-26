import type { AdviesDoc, Run } from "./types";

function doc(d: AdviesDoc) {
  return `## ${d.besluit}

${d.samenvatting}

### Opties
${d.opties.map((o) => `- **${o.optie}** — voor: ${o.voor}; tegen: ${o.tegen}`).join("\n")}

### Onderbouwing
${d.analyse}

### Stappen
${d.stappen.map((s, i) => `${i + 1}. **${s.stap}** — ${s.waarom} Eerste actie: ${s.eersteActie} (${s.eigenaar}, ${s.termijn})`).join("\n")}

### Aannames om te checken
${d.aannames.map((a) => `- ${a.aanname} — risico: ${a.risico}; test: ${a.hoeTesten}`).join("\n")}
`;
}

const LABEL = { over: "overgenomen", deels: "deels", niet: "niet overgenomen" } as const;

/** Het eindadvies bovenaan, daarna hoe het tot stand kwam, en het debatlog achteraan. */
export function ketenMarkdown(run: Run): string {
  const k = run.keten;
  if (!k) return `# ${run.title ?? run.question}\n`;
  const eind = k.eind ?? k.rondes.at(-1)?.doc;
  const rondes = k.rondes.filter((r) => r.oordelen.length);
  const alle = rondes.flatMap((r) => r.oordelen);
  const n = (o: "over" | "deels" | "niet") => alle.filter((x) => x.oordeel === o).length;
  const log = rondes
    .map(
      (r) =>
        `### Ronde ${r.nr}\n${r.reviews
          .flatMap((rv) =>
            rv.punten.map((p) => {
              const o = r.oordelen.find((x) => x.id === p.id);
              const wie = rv.soort === "kruis" ? `Tegenlezer (${rv.ai})` : rv.soort === "bouwer" ? `${rv.naam} (bouwende rol)` : `${rv.naam}, ${rv.functie}`;
              return `- (${p.zwaarte}) ${wie}: ${p.punt}${o ? ` → **${LABEL[o.oordeel]}**: ${o.reden}` : ""}`;
            }),
          )
          .join("\n")}`,
    )
    .join("\n\n");
  return `# ${run.title ?? run.question}

_Vraagstuk:_ ${run.question}

${eind ? doc(eind) : ""}
${k.slot ? `### Slotcheck van de voorzitter (vertrouwen: ${k.slot.vertrouwen})\n${k.slot.oordeel}\n${k.slot.laatsteAanvullingen.map((x) => `- ${x}`).join("\n")}\n` : ""}
## Hoe dit advies tot stand kwam

- Eerste versies: ${k.concepten?.length ? k.concepten.map((c) => `${c.label} = ${c.ai}`).join(", ") : k.auteur.ai}, samengevoegd door ${k.auteur.ai}
- Rollen: ${run.cast.rollen
    .filter((r) => !r.isJury)
    .map((r) => `${r.naam} (${r.functie}${r.isBouwer ? ", bouwende rol" : ""})`)
    .join("; ")}${k.kruis ? `; tegenlezer: ${k.kruis.ai}` : ""}
- Rondes: ${rondes.length}; punten: ${n("over")} overgenomen, ${n("deels")} deels, ${n("niet")} niet
${k.redactie ? `- Eindcontrole: ${k.redactie.gecontroleerd} claims gecontroleerd tegen de tekst${k.redactie.gecorrigeerd.length ? `, ${k.redactie.gecorrigeerd.length} teruggezet` : ""}\n` : ""}
${(k.herkomst ?? []).length ? `### Herkomst van de inzichten\n${(k.herkomst ?? []).map((h) => `- [${h.bron.join("+")}] ${h.inzicht}${h.status === "weggelaten" ? ` _(weggelaten: ${h.reden})_` : ""}`).join("\n")}\n` : ""}
## Debatlog

${log}
`;
}
