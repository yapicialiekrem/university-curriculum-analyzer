import type { Metadata } from "next";
import { Fraunces, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { TopBar } from "@/components/TopBar";
import { OverlayProvider } from "@/lib/use-overlay";
import "./globals.css";

// Editorial başlık + sayı fontu (variable font — weight'i atla, axes opsz kullan)
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});

// UI gövde fontu
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Monospace — kod / etiket
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "UniCurriculum — İki müfredatı yan yana oku",
  description:
    "Türk üniversitelerinin bilgisayar / yazılım mühendisliği / YBS müfredatlarını " +
    "10 eksende, 8 dönemde ve LLM destekli sohbetle karşılaştır.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="tr"
      className={`${fraunces.variable} ${interTight.variable} ${plexMono.variable}`}
    >
      <body className="min-h-screen flex flex-col">
        <OverlayProvider>
          <Suspense fallback={null}>
            <TopBar />
          </Suspense>
          {children}
          <Suspense fallback={null}>
            <ChatPanel />
          </Suspense>
        </OverlayProvider>
      </body>
    </html>
  );
}
