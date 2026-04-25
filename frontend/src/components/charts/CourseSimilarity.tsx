"use client";

/**
 * CourseSimilarity — Dashboard Bileşen 3.4.
 *
 * Kullanıcı serbest metin yazar ("derin öğrenme", "blockchain"...) →
 * FAISS embedding search ile en yakın 10 ders. Skor + üni + kategori chip'i.
 */

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { SearchResponse, SearchResult } from "@/lib/types";

const PRESETS = [
  "derin öğrenme",
  "blockchain ve akıllı kontrat",
  "veri yapıları algoritmalar",
  "ağ güvenliği",
  "web programlama",
];

export function CourseSimilarity() {
  const [query, setQuery] = useState("derin öğrenme");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (q: string) => {
    if (q.trim().length < 2) return;
    setLoading(true);
    try {
      const r = await api.search(q, { top_k: 10, min_score: 0.3 });
      setData(r);
      setQuery(q);
    } catch (err) {
      console.error("search hatası:", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // İlk yüklemede default sorgu
  useEffect(() => {
    run("derin öğrenme");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(String(fd.get("q") || ""));
        }}
      >
        <label className="ui-label block mb-1">Konu / Anahtar Kelime</label>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md border bg-[color:var(--color-white-paper)] focus-within:border-[color:var(--color-ink-700)] transition-colors"
          style={{ borderColor: "var(--color-line)" }}
        >
          <Search size={16} className="text-[color:var(--color-ink-500)]" />
          <input
            name="q"
            type="text"
            defaultValue={query}
            placeholder="Örn: yapay sinir ağları, kriptografi..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-md bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)] disabled:opacity-30 hover:opacity-90 transition-opacity"
          >
            Ara
          </button>
        </div>
      </form>

      {/* Preset'ler */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => run(p)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              p === query
                ? "bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)]"
                : "bg-[color:var(--color-paper-2)] hover:bg-[color:var(--color-paper-3)]"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Sonuçlar */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 skeleton rounded" />
          ))}
        </div>
      ) : data ? (
        <SearchResults data={data} />
      ) : null}
    </div>
  );
}

function SearchResults({ data }: { data: SearchResponse }) {
  if (data.count === 0) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        "<strong>{data.query}</strong>" için yeterince yakın bir ders bulunamadı.
        Farklı kelimeler deneyebilirsin.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="ui-label">
        {data.count} sonuç · "{data.query}"
      </p>
      <ul className="space-y-2">
        {data.results.map((r) => (
          <ResultRow key={r.course_id} result={r} />
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ result }: { result: SearchResult }) {
  const pct = Math.round(result.score * 100);
  return (
    <li
      className="flex gap-4 px-4 py-3 rounded border bg-[color:var(--color-white-paper)] hover:shadow-paper transition-shadow"
      style={{ borderColor: "var(--color-line)" }}
    >
      {/* Skor */}
      <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
        <div className="font-serif text-2xl font-medium tabular-nums leading-none">
          {pct}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--color-ink-500)] mt-0.5">
          %
        </div>
      </div>

      {/* İçerik */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <code className="font-mono text-xs text-[color:var(--color-ink-700)] tracking-tight">
            {result.code}
          </code>
          <a
            href={result.url || undefined}
            target={result.url ? "_blank" : undefined}
            rel="noreferrer"
            className="text-sm font-medium leading-tight hover:underline"
          >
            {result.name}
          </a>
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-[color:var(--color-ink-500)]">
          <span>{result.university}</span>
          {result.semester && (
            <>
              <span>·</span>
              <span className="font-mono">D{result.semester}</span>
            </>
          )}
          {result.type && (
            <>
              <span>·</span>
              <span>{result.type}</span>
            </>
          )}
          {result.modernity_score !== null && (
            <>
              <span>·</span>
              <span className="font-mono">M{result.modernity_score}</span>
            </>
          )}
        </div>

        {/* Kategori chip'leri */}
        {result.categories.filter((c) => c !== "not_cs").length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.categories
              .filter((c) => c !== "not_cs")
              .slice(0, 3)
              .map((c) => (
                <span
                  key={c}
                  className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[color:var(--color-paper-2)] text-[color:var(--color-ink-500)]"
                >
                  {c}
                </span>
              ))}
          </div>
        )}
      </div>
    </li>
  );
}
