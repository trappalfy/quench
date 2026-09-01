import { ImageResponse } from "next/og";

/**
 * The card a Quench link turns into when somebody pastes it.
 *
 * The site declares a large-image card, so it owes one: without this the
 * declaration is a promise to every chat client that we then fail to keep, and
 * the link renders as a bare grey box on the day the domain went live.
 *
 * Built rather than drawn. A static picture would have to be re-exported by
 * hand every time the wording changes, and the one thing on it that matters —
 * the amber-to-cyan bar the product is named after — is four lines of CSS.
 */
export const alt =
  "Quench — fixed-supply tokens behind immutable Uniswap v4 hooks on Robinhood Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#050506";
const LINE = "#1c1e22";
const TEXT = "#f2f4f5";
const DIM = "#a7afb4";
const AMBER = "#ff7a1a";
const CYAN = "#22d3ee";

/**
 * Archivo, fetched at build. The face is half the identity, and Satori ships
 * with a generic sans that would make the card look like somebody else's.
 *
 * Wrapped, because a card in the wrong font is a smaller failure than a build
 * that dies over a font server.
 */
async function archivo(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Archivo:wght@700&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0" } },
    ).then((r) => r.text());

    const url = css.match(/src: url\((https:[^)]+)\) format\('(?:truetype|woff2?)'\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function Image() {
  const font = await archivo();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: GROUND,
          padding: 72,
          fontFamily: font ? "Archivo" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", color: DIM, fontSize: 24 }}>
          <span style={{ letterSpacing: 4 }}>QUENCH</span>
          <span style={{ letterSpacing: 4 }}>ROBINHOOD CHAIN · 4663</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: TEXT, fontSize: 104, lineHeight: 1.05, letterSpacing: -2 }}>
            Build the hook.
          </span>
          <span style={{ color: CYAN, fontSize: 104, lineHeight: 1.05, letterSpacing: -2 }}>
            Then quench it.
          </span>
          {/* Two elements, not one with a <br />. Satori lays out flex boxes
              and treats the break as nothing, so the line ran off the right
              edge of the card. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 28,
              color: DIM,
              fontSize: 30,
            }}
          >
            <span>Fixed-supply tokens behind immutable Uniswap v4 hooks.</span>
            <span style={{ marginTop: 8 }}>No owner, no upgrade path, no pause.</span>
          </div>
        </div>

        {/* The one motif that carries the name: hot on the left, cold on the
            right, the same bar a curve fills as it sells out. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              height: 10,
              background: `linear-gradient(to right, ${AMBER}, ${CYAN})`,
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 20,
              paddingTop: 20,
              borderTop: `1px solid ${LINE}`,
              color: DIM,
              fontSize: 22,
              letterSpacing: 3,
            }}
          >
            <span>FIVE RULES · SET WHEN THE POOL OPENS</span>
            <span>QUENCH.CLICK</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: "Archivo", data: font, weight: 700 as const, style: "normal" as const }]
        : undefined,
    },
  );
}
