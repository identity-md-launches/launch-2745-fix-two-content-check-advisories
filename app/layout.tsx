import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Fonts are downloaded at build time and shipped in the export (no request to Google at runtime).
const mono = IBM_Plex_Mono({ weight: ["400", "600"], subsets: ["latin", "latin-ext"], variable: "--font-mono", display: "swap" });
const sans = IBM_Plex_Sans({ weight: ["400", "600"], subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });
const cond = Barlow_Condensed({ weight: ["600"], subsets: ["latin", "latin-ext"], variable: "--font-cond", display: "swap" });

const title = "PolyHamster · prediction markets on Squeektoshi";
const description = "Bet play-seeds on how far, how long and how hard Squeekchain's hamster runs tonight. Resolved from the public Squeekchain API.";

export const metadata: Metadata = {
  // The hosted ENS name (see README). Only used to make og:image absolute so shared links unfurl.
  metadataBase: new URL("https://polyhamster-prediction-markets-o.identitymd.eth.limo/"),
  title,
  description,
  openGraph: { title, description, type: "website", images: [{ url: "og.png", width: 1200, height: 630, alt: "PolyHamster live board" }] },
  twitter: { card: "summary_large_image", title, description, images: ["og.png"] },
};
export const viewport: Viewport = { themeColor: "#1A1A20", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang is "fr" in the static HTML; App sets document.documentElement.lang from the FR/EN switch.
  return (
    <html lang="fr" className={`${mono.variable} ${sans.variable} ${cond.variable}`}>
      <head>
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23F8A838'/%3E%3C/svg%3E" />
      </head>
      <body>{children}</body>
    </html>
  );
}
