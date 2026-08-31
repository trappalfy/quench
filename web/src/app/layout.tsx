import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Footer } from "@/components/Footer";
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
    // The font variables go on <html>, not <body>. The design tokens that
    // compose them live in :root, and a token whose value references a variable
    // declared *below* it resolves to nothing — silently, with the whole
    // declaration thrown away and the system stack taking over.
    <html lang="en" className={`${archivo.variable} ${mono.variable}`}>
      <body className="antialiased">
        {children}
        <Footer />
      </body>
    </html>
  );
}
