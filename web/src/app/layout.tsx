import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/// Display face: a grotesque with a width axis, so headlines can be stretched
/// wide and set in caps without a second family.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

/// Everything that is data, a label, or navigation. Tabular figures matter more
/// here than character; numbers must not shift their own column as they update.
const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quench",
  description:
    "Build the hook, then quench it. Fixed-supply tokens behind immutable Uniswap v4 hooks on Robinhood Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${mono.variable} antialiased`}>
        {/* Ground layer: the engineering grid and the grain sit behind every
            page, full bleed and fixed, so scrolling does not drag them and no
            container can clip an edge into view. */}
        <div aria-hidden className="q-grid q-grain pointer-events-none fixed inset-0 -z-10" />
        {children}
      </body>
    </html>
  );
}
