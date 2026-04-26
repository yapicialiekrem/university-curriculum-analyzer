import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Fraunces, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";

import { Footer } from "@/components/Footer";
import { TopBar } from "@/components/TopBar";
import { OverlayProvider } from "@/lib/use-overlay";
import { ThemeProvider } from "@/lib/use-theme";
import "./globals.css";

// Chat paneli ayrı chunk — Framer Motion + chat kodu ~30 KB initial
// bundle'a girmesin
const ChatPanel = dynamic(
  () => import("@/components/chat/ChatPanel").then((m) => ({ default: m.ChatPanel }))
);

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
        <ThemeProvider>
          <OverlayProvider>
            <Suspense fallback={null}>
              <TopBar />
            </Suspense>
            {children}
            <Footer />
            <Suspense fallback={null}>
              <ChatPanel />
            </Suspense>
          </OverlayProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
