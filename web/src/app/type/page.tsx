import {
  JetBrains_Mono,
  IBM_Plex_Mono,
  Azeret_Mono,
  Martian_Mono,
} from "next/font/google";
import { Nav } from "@/components/Nav";

/**
 * A specimen page for choosing the data face. Not part of the product — delete
 * it once the choice is made, along with the fonts that lost.
 *
 * The candidates are shown in the contexts that actually matter: a long price
 * with leading zeros, a column of aligned figures, a truncated address, small
 * caps labels, and a paragraph of prose. A font that looks good in a headline
 * can still fall apart at 13px in a table, which is where this product lives.
 */
const jetbrains = JetBrains_Mono({ subsets: ["latin"], display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const azeret = Azeret_Mono({ subsets: ["latin"], display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], display: "swap" });

const CANDIDATES = [
  {
    name: "JetBrains Mono",
    className: jetbrains.className,
    note: "What is loaded now. Wide, open, built for reading code at small sizes. Neutral to the point of having little character.",
  },
  {
    name: "IBM Plex Mono",
    className: plex.className,
    note: "Narrower, with slab-ish terminals and a typewriter warmth. Fits more into a column and reads softer in prose.",
  },
  {
    name: "Azeret Mono",
    className: azeret.className,
    note: "Geometric and blunt, closest to the brutalist references. Strong personality; the one most likely to tire the eye over a long page.",
  },
  {
    name: "Martian Mono",
    className: martian.className,
    note: "Very wide and technical, the most overtly cyber of the four. Costs the most horizontal space, which dense tables may not have.",
  },
];

export default function TypeSpecimen() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="q-label">/ specimen</p>
        <h1 className="q-display mt-2 text-5xl">Choosing the data face</h1>
        <p className="mt-4 max-w-2xl text-dim">
          The display face stays Archivo. This is only the second half of the pair — the
          one that carries every number, label and sentence on the site. Same content
          four times; pick by looking, not by the description.
        </p>

        <div className="mt-10 space-y-px bg-line">
          {CANDIDATES.map((c) => (
            <section key={c.name} className="bg-panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="q-display-sm text-xl">{c.name}</span>
                <span className="q-label">{c.name.toLowerCase().replace(/ /g, "-")}</span>
              </div>

              <div className={c.className}>
                <p className="mt-3 max-w-2xl text-dim" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {c.note}
                </p>

                {/* The four contexts this face has to survive. */}
                <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr_260px]">
                  <div>
                    <p className="q-label">figures</p>
                    <table
                      className="mt-2 w-full"
                      style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}
                    >
                      <tbody>
                        {[
                          ["price", "0.000000005096", "ETH"],
                          ["fdv", "5.0961", "ETH"],
                          ["reserve", "5.0478", "ETH"],
                          ["pot", "0.0005", "ETH"],
                          ["burned", "473.93K", "SEED"],
                          ["head", "50793383", ""],
                        ].map(([k, v, u]) => (
                          <tr key={k}>
                            <td className="q-label pr-4 align-baseline">{k}</td>
                            <td className="text-right align-baseline">{v}</td>
                            <td className="pl-2 align-baseline text-faint">{u}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="q-label">prose</p>
                    <p className="mt-2 text-dim" style={{ fontSize: 13, lineHeight: 1.55 }}>
                      For 50 blocks after the pool opens, a buy may not exceed 5% of the
                      in-range ETH reserve, and pays 1% on top. The counter is public and
                      advances at most once per block.
                    </p>
                  </div>

                  <div>
                    <p className="q-label">addresses</p>
                    <ul className="mt-2 space-y-1" style={{ fontSize: 13 }}>
                      <li className="text-faint">0x5eE0…3a6c</li>
                      <li className="text-faint">0x011a…E8Cc</li>
                      <li className="text-faint">0xD689…7C17</li>
                    </ul>
                    <p className="q-label mt-3">tags</p>
                    <div className="mt-2 flex gap-1">
                      {["SNP", "SRG", "BRN", "LP", "POT"].map((t) => (
                        <span
                          key={t}
                          className="border border-line-bright px-1.5 py-0.5"
                          style={{ fontSize: 10, letterSpacing: "0.1em" }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
