import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolyHamster · prediction markets on Squeektoshi",
  description: "Bet play-seeds on how far, how long and how hard Squeekchain's hamster runs tonight. Resolved from the public Squeekchain API.",
};
export const viewport: Viewport = { themeColor: "#1A1A20", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;600&family=IBM+Plex+Mono:wght@400;600&display=swap"
        />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23F8A838'/%3E%3C/svg%3E" />
      </head>
      <body>{children}</body>
    </html>
  );
}
