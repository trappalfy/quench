import type { Metadata } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import { Footer } from "@/components/Footer";
import { WalletProvider } from "@/lib/wallet/WalletContext";
import "./globals.css";

/// Display face: a grotesque with a width axis, so headlines can be stretched
/// wide and set in caps without a second family.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

/// Everything that is data, a label, or navigation.
///
/// Martian Mono is the widest of the faces considered, and this product lives
/// in dense columns of figures. It carries a width axis, so the body default is
/// set narrow in CSS: the character survives and the horizontal cost does not.
const mono = Martian_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

/// Absolute base for every og:image and canonical URL on the site.
///
/// Set NEXT_PUBLIC_SITE_URL once the real domain is attached. Until then Vercel
/// supplies the production hostname it assigned, which keeps preview builds
/// pointing at themselves rather than at a domain that does not resolve yet.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const TAGLINE =
  "Build the hook, then quench it. Fixed-supply tokens behind immutable Uniswap v4 hooks on Robinhood Chain.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Quench", template: "%s" },
  description: TAGLINE,
  applicationName: "Quench",
  openGraph: {
    type: "website",
    siteName: "Quench",
    title: "Quench",
    description: TAGLINE,
  },
  twitter: { card: "summary_large_image", title: "Quench", description: TAGLINE },
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
        <WalletProvider>
          {children}
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
