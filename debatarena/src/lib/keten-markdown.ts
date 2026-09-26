import type { AdviesDoc, Run } from "./types";

function doc(d: AdviesDoc) {
  return `## ${d.besluit}

${d.samenvatting}

### Opties
${d.opties.map((o) => `- **${o.optie}** — voor: ${o.voor}; tegen: ${o.tegen}`).join("\n")}

### Onderbouwing
${d.analyse}

### Aannames om te checken
${d.aannames.map((a) => `- ${a.aanname} — risico: ${a.risico}; test: ${a.hoeTesten}`).join("\n")}

### Stappen
${d.stappen.map((s, i) => `${i + 1}. **${s.stap}** — ${s.waarom} Eerste actie: ${s.eersteActie} (${s.eigenaar}, ${s.termijn})`).join("\n")}
`;
}

/** Het eindadvies plus hoe het tot stand kwam, als Markdown. */
export function ketenMarkdown(run: Run): string {
  const k = run.keten;
  if (!k) return `# ${run.title ?? run.question}\n`;
  const eind = k.eind ?? k.rondes.at(-1)?.doc;
  const spoor = k.rondes
    .filter((r) => r.reviews.length)
    .map(
      (r) =>
        `### Ronde ${r.nr}\n${r.reviews
          .flatMap((rv) =>
            rv.punten.map((p) => {
              const o = r.oordelen.find((x) => x.id === p.id);
              return `- (${p.zwaarte}) ${rv.soort === "kruis" ? `Tegenlezer (${rv.ai})` : `${rv.naam}, ${rv.functie}`}: ${p.punt}${o ? ` → **${o.oordeel === "over" ? "overgenomen" : o.oordeel === "deels" ? "deels" : "niet overgenomen"}**: ${o.reden}` : ""}`;
            }),
          )
          .join("\n")}`,
    )
    .join("\n\n");
  return `# ${run.title ?? run.question}

_Vraagstuk:_ ${run.question}

${eind ? doc(eind) : ""}
${k.slot ? `### Slotcheck van de voorzitter\n${k.slot.oordeel} (vertrouwen: ${k.slot.vertrouwen})\n${k.slot.laatsteAanvullingen.map((x) => `- ${x}`).join("\n")}\n` : ""}
## Hoe dit advies tot stand kwam
Versie 1 door ${k.auteur.ai}${k.kruis ? `, tegengelezen door ${k.kruis.ai}` : ""}, ${k.rondes.length} versie(s).

${spoor}
`;
}
