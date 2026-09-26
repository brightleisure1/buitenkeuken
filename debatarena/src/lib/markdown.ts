import type { JuryResult, Message, Run } from "./types";

export function sectionText(r: JuryResult) {
  return {
    samenvatting: `${r.uitslag}\n\n${r.samenvatting}`,
    besluiten: r.besluitenVanDeBaas.length ? r.besluitenVanDeBaas.map((b) => `- ${b}`).join("\n") : "Geen besluiten genomen.",
    strategie: r.strategie.map((s, i) => `${i + 1}. ${s.stap}\n   Waarom: ${s.waarom}\n   Eerste actie: ${s.eersteActie}`).join("\n"),
    volgendeStappen: r.volgendeStappen.map((s) => `- ${s}`).join("\n"),
    aannames: r.aannames.map((a) => `- ${a.aanname}${a.onbewezen ? " (onbewezen)" : ""}\n  Risico: ${a.risico}\n  Zo test je het: ${a.hoeTesten}`).join("\n"),
    onenigheid: r.onenigheid.map((o) => `- ${o.punt}\n${o.standpuntPerRol.map((s) => `  - ${s.rol}: ${s.standpunt}`).join("\n")}`).join("\n"),
    bronnen: r.bronnen.length ? r.bronnen.map((b) => `- ${b.naam} (${b.gebruiktDoor})`).join("\n") : "Geen bronnen genoemd.",
  };
}

export function transcriptLines(run: Run, messages: Message[]) {
  return messages
    .filter((m) => (m.kind === "turn" && m.content) || m.kind === "boss")
    .map((m) => {
      if (m.kind === "boss") return `**De baas:** ${m.content}`;
      const r = run.cast.rollen.find((x) => x.id === m.role_id);
      const src = m.sources.length ? ` _(bron: ${m.sources.join("; ")})_` : "";
      return `**${r?.naam ?? "?"}** (${r?.isJury ? "Jury" : r?.functie}): ${m.content}${src}`;
    });
}

export function toMarkdown(run: Run, messages: Message[], checks: Record<string, boolean>) {
  const r = run.result!;
  const t = sectionText(r);
  const aannames = r.aannames
    .map((a, i) => `| ${checks[i] ? "✅" : "⬜"} | ${a.aanname}${a.onbewezen ? " _(onbewezen)_" : ""} | ${a.risico} | ${a.hoeTesten} |`)
    .join("\n");
  return `# ${run.title ?? run.question}

> ${run.question}

## ${r.uitslag}

${r.samenvatting}

## Besluiten van de baas

${t.besluiten}

## Strategie

${t.strategie}

### Volgende stappen

${t.volgendeStappen}

## Aannames

| Getest | Aanname | Risico | Hoe testen |
|---|---|---|---|
${aannames}

## Onenigheid

${t.onenigheid}

## Bronnen

${t.bronnen}

## Transcript

${transcriptLines(run, messages).join("\n\n")}
`;
}
