import "server-only";
import { ImageResponse } from "next/og";
import { applyShare, initials } from "./text";
import type { Run } from "./types";

const COLORS = ["#FFD6C9", "#CDE8FF", "#D9F2D0", "#E8DAFF", "#FFF1B8", "#FFD9EC"];

/** Oordeelkaart als PNG: 1:1 (1080×1080) of 9:16 (1080×1920). */
export function renderCard(run: Run, format: "square" | "story") {
  const { cast, fix } = applyShare(run.cast, [], run.share);
  const story = format === "story";
  const W = 1080;
  const H = story ? 1920 : 1080;
  const result = run.result;
  const uitslag = fix(result?.uitslag ?? "Het debat loopt nog");
  const quote = result?.besteQuote ? fix(result.besteQuote.tekst) : null;
  const quoteBy = result?.besteQuote ? fix(result.besteQuote.rol) : null;
  const question = fix(run.question);
  const q = question.length > 160 ? `${question.slice(0, 157)}…` : question;
  const roles = cast.rollen;
  const size = story ? 170 : roles.length > 4 ? 120 : 140;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#FBF6EE",
          padding: story ? "110px 80px" : "64px 72px",
          fontFamily: "sans-serif",
          color: "#1E1B18",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 700, letterSpacing: 4, color: "#E4572E" }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: "#E4572E" }} />
          DEBATARENA · UITSPRAAK
        </div>
        <div style={{ display: "flex", fontSize: story ? 52 : 40, fontWeight: 600, marginTop: story ? 60 : 36, lineHeight: 1.25, color: "#4A4540" }}>
          {q}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: story ? 60 : 32,
            background: "#1E1B18",
            color: "#FBF6EE",
            borderRadius: 28,
            padding: story ? "44px 48px" : "30px 40px",
            fontSize: story ? 62 : 50,
            fontWeight: 800,
            lineHeight: 1.15,
          }}
        >
          {uitslag}
        </div>
        {quote && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: story ? 70 : 36 }}>
            <div style={{ display: "flex", fontSize: story ? 46 : 36, fontStyle: "italic", lineHeight: 1.3 }}>“{quote}”</div>
            <div style={{ display: "flex", fontSize: story ? 32 : 26, marginTop: 14, color: "#7A726A" }}>— {quoteBy}</div>
          </div>
        )}
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: story ? 28 : 22, justifyContent: "center" }}>
          {roles.map((r, i) => {
            const src = run.prep[r.id]?.portraits?.neutraal;
            return (
              <div key={r.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: size + 20 }}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} width={size} height={size} style={{ borderRadius: size / 2, border: "5px solid #1E1B18" }} alt="" />
                ) : (
                  <div
                    style={{
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      border: "5px solid #1E1B18",
                      background: COLORS[i % COLORS.length],
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: size / 3,
                      fontWeight: 800,
                    }}
                  >
                    {initials(r.naam)}
                  </div>
                )}
                <div style={{ display: "flex", fontSize: 22, marginTop: 10, textAlign: "center", fontWeight: 600 }}>{r.naam}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: story ? 60 : 30, fontSize: 24, color: "#7A726A" }}>
          Ook een debat laten voeren? Start je eigen debat in de Debatarena.
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "Cache-Control": "no-store" } },
  );
}
