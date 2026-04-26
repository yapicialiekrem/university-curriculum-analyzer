"use client";

/**
 * Deep Analysis route error boundary.
 *
 * LayerThree birden fazla SWR + ReactFlow + dynamic import içerir; bir alt
 * bileşen runtime hata fırlatırsa tüm site beyaz ekran olmasın diye Next.js
 * route-level boundary kullanıyoruz. "Tekrar dene" reset() SWR cache'i
 * boşaltmaz ama React tree'yi remount eder — geçici hatalar (timeout,
 * büyük graf render) için yeterli.
 */

import { useEffect } from "react";

export default function DeepAnalysisError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[deep-analysis error]", error);
  }, [error]);

  return (
    <main className="flex-1">
      <section className="px-4 sm:px-6 lg:px-10 max-w-[1440px] mx-auto py-16">
        <div
          className="border-l-2 pl-6 py-2"
          style={{ borderColor: "var(--color-ink-700)" }}
        >
          <p className="ui-label mb-2">Derin analiz</p>
          <h1 className="font-serif text-3xl tracking-tighter">
            Bu görünüm yüklenirken bir sorun çıktı
          </h1>
          <p className="mt-3 text-sm italic font-serif text-[color:var(--color-ink-500)] max-w-2xl">
            Bazen büyük müfredatlarda önkoşul ağı veya ders eşleştirme verisi
            tarayıcıyı zorluyor. Tekrar denemeyi ya da seçimi (üst barda)
            başka bir üniversiteyle değiştirmeyi öneririz.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs font-mono text-[color:var(--color-ink-500)]">
              ref: {error.digest}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="px-4 py-2 text-sm border rounded hover:bg-[color:var(--color-paper-2)] transition-colors"
              style={{ borderColor: "var(--color-ink-900)" }}
            >
              Tekrar dene
            </button>
            <a
              href="/"
              className="px-4 py-2 text-sm text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] transition-colors"
            >
              Ana sayfaya dön
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
