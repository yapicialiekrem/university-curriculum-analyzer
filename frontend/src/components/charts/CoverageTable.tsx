"use client";

/**
 * CoverageTable — Dashboard Bileşen 2.2.
 *
 * Kategori bazlı ortak/farklı konu özeti. Sekmelerde kategori seçimi.
 *
 *   AI / ML
 *   ──────────────────────
 *   ● Veri Yapıları       4 / 3 hafta — Ortak
 *   ○ NP-Complete         2 / —       — Sadece A
 *   ○ Amortized Analysis  — / 1       — Sadece B
 */

import { useMemo, useState } from "react";

import type { CategoryKey, CoverageResponse } from "@/lib/types";
import { uniColor, uniShortName } from "@/lib/use-selection";

const CATEGORY_LABELS: Record<string, string> = {
  ai_ml: "Yapay Zeka / ML",
  programming: "Programlama",
  systems: "Sistem / Donanım",
  software_eng: "Yazılım Müh.",
  security: "Güvenlik",
  web_mobile: "Web / Mobil",
  data_science: "Veri Bilimi",
  graphics_vision: "Grafik / Görüntü",
  distributed: "Dağıtık Sistemler",
  theory: "Hesaplama Kuramı",
  math: "Matematik",
  info_systems: "Bilgi Sistemleri",
};

export interface CoverageTableProps {
  data: CoverageResponse | undefined;
  loading?: boolean;
  selectedSlugs: string[];     // Hangi sırayla render edileceği için
}

export function CoverageTable({ data, loading, selectedSlugs }: CoverageTableProps) {
  const categories = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.by_category)
      .filter(([, v]) => v && Object.keys(v.universities).length > 0)
      .sort((a, b) => {
        const aCt = Object.values(a[1]!.universities).reduce((s, u) => s + u.course_count, 0);
        const bCt = Object.values(b[1]!.universities).reduce((s, u) => s + u.course_count, 0);
        return bCt - aCt;
      })
      .map(([key]) => key as CategoryKey);
  }, [data]);

  const [active, setActive] = useState<CategoryKey | null>(null);
  const activeKey = active || categories[0];

  if (loading || !data) {
    return <div className="space-y-3"><div className="h-6 w-1/3 skeleton" /><div className="h-[200px] skeleton" /></div>;
  }

  if (!categories.length) {
    return <p className="text-sm text-[color:var(--color-ink-500)]">Karşılaştırılabilir konu bulunamadı.</p>;
  }

  const entry = activeKey ? data.by_category[activeKey] : undefined;

  return (
    <div className="space-y-4">
      {/* Sekmeler */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => {
          const isActive = cat === activeKey;
          return (
            <button
              key={cat}
              onClick={() => setActive(cat)}
              className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                isActive
                  ? "bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)]"
                  : "bg-[color:var(--color-paper-2)] text-[color:var(--color-ink-700)] hover:bg-[color:var(--color-paper-3)]"
              }`}
            >
              {CATEGORY_LABELS[cat] || cat}
            </button>
          );
        })}
      </div>

      {entry && <CategoryView entry={entry} selectedSlugs={selectedSlugs} />}
    </div>
  );
}

/**
 * Kaynak müfredat dosyalarındaki haftalık konular zaman zaman ders kitabı
 * bölüm referansları içeriyor (ör. "limits 1 4 1 5" → "limits, sections 1.4
 * 1.5"). En sondaki 2+ kısa-sayı dizisini kullanıcıya göstermeden temizliyoruz.
 */
function cleanTopic(t: string): string {
  return t.replace(/(\s+\d{1,2}){2,}\s*$/, "").trim();
}

/** Temizleme sonrası eşit çıkan konuları tekilleştir — "limits 1 4" ve
 * "limits 1 6" ikisi de "limits" oluyor, sadece bir chip görünsün. */
function dedupeCleaned(topics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of topics) {
    const c = cleanTopic(t);
    if (!c) continue;
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function CategoryView({
  entry,
  selectedSlugs,
}: {
  entry: NonNullable<CoverageResponse["by_category"][CategoryKey]>;
  selectedSlugs: string[];
}) {
  const slugs = selectedSlugs.filter((s) => entry.universities[s]);

  return (
    <div className="space-y-4">
      {/* Üst satır: ders sayıları */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${slugs.length}, minmax(0, 1fr))` }}>
        {slugs.map((slug, idx) => {
          const u = entry.universities[slug];
          if (!u) return null;
          return (
            <div
              key={slug}
              className="flex items-baseline gap-3 px-3 py-2 rounded border"
              style={{
                borderColor: "var(--color-line)",
                background: "var(--color-paper-2)",
              }}
            >
              <span
                aria-hidden
                className="w-2 h-2 rounded-full"
                style={{ background: uniColor(idx) }}
              />
              <div className="flex-1">
                <div className="text-sm font-medium leading-tight">{u.name}</div>
                <div className="font-mono text-xs text-[color:var(--color-ink-500)] tabular-nums">
                  {u.course_count} ders · {u.ects} AKTS
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ana matris — 2 üni → 3 sütun (sol: yalnız A, orta: ortak, sağ: yalnız B);
          3 üni → ortak satırı üstte, alta 3 yalnız sütunu. */}
      {slugs.length === 2 ? (
        <TwoUniMatrix entry={entry} slugs={slugs} />
      ) : (
        <ThreeUniMatrix entry={entry} slugs={slugs} />
      )}
    </div>
  );
}

function TwoUniMatrix({
  entry,
  slugs,
}: {
  entry: NonNullable<CoverageResponse["by_category"][CategoryKey]>;
  slugs: string[];
}) {
  const [slugA, slugB] = slugs;
  const uA = entry.universities[slugA];
  const uB = entry.universities[slugB];
  const uniqueA = entry.unique_topics[slugA] || [];
  const uniqueB = entry.unique_topics[slugB] || [];
  const shared = entry.shared_topics;

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
      <UniqueColumn
        title={`Sadece ${uniShortName(slugA, uA?.name)}`}
        topics={uniqueA}
        accent={uniColor(0)}
      />
      <SharedColumn topics={shared} />
      <UniqueColumn
        title={`Sadece ${uniShortName(slugB, uB?.name)}`}
        topics={uniqueB}
        accent={uniColor(1)}
        align="right"
      />
    </div>
  );
}

function ThreeUniMatrix({
  entry,
  slugs,
}: {
  entry: NonNullable<CoverageResponse["by_category"][CategoryKey]>;
  slugs: string[];
}) {
  return (
    <div className="space-y-4">
      <SharedColumn topics={entry.shared_topics} />
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${slugs.length}, minmax(0, 1fr))` }}
      >
        {slugs.map((slug, idx) => {
          const unique = entry.unique_topics[slug] || [];
          const u = entry.universities[slug];
          return (
            <UniqueColumn
              key={slug}
              title={`${uniShortName(slug, u?.name)}`}
              topics={unique}
              accent={uniColor(idx)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SharedColumn({ topics }: { topics: string[] }) {
  return (
    <div
      className="rounded p-3"
      style={{
        background: "rgba(45,106,138,0.06)",
        border: "1px solid rgba(45,106,138,0.18)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--color-info)" }}
        />
        <h4 className="ui-label">
          Ortak{topics.length > 0 && ` (${topics.length})`}
        </h4>
      </div>
      {topics.length === 0 ? (
        <p className="text-xs italic text-[color:var(--color-ink-500)]">
          — ortak konu yok
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {dedupeCleaned(topics).slice(0, 30).map((c) => (
            <li
              key={c}
              className="text-xs px-2.5 py-1 rounded-full bg-[color:rgba(45,106,138,0.10)] text-[color:var(--color-info)]"
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UniqueColumn({
  title,
  topics,
  accent,
  align,
}: {
  title: string;
  topics: string[];
  accent: string;
  align?: "right";
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-1.5 mb-2 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: accent }}
        />
        <h4 className="ui-label">{title}</h4>
      </div>
      {topics.length === 0 ? (
        <p
          className={`text-xs italic text-[color:var(--color-ink-500)] ${
            align === "right" ? "text-right" : ""
          }`}
        >
          — özel konu yok
        </p>
      ) : (
        <ul
          className={`flex flex-wrap gap-1.5 ${
            align === "right" ? "justify-end" : ""
          }`}
        >
          {dedupeCleaned(topics).slice(0, 20).map((c) => (
            <li
              key={c}
              className="text-xs px-2.5 py-1 rounded-full"
              style={{
                border: `1px dashed ${accent}`,
                color: accent,
              }}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
