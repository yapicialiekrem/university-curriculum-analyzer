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
import { uniColor } from "@/lib/use-selection";

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

      {/* Ortak / unique konular */}
      {entry.shared_topics.length > 0 && (
        <div>
          <h4 className="ui-label mb-2">Ortak Konular ({entry.shared_topics.length})</h4>
          <ul className="flex flex-wrap gap-1.5">
            {entry.shared_topics.slice(0, 30).map((t) => (
              <li
                key={t}
                className="text-xs px-2.5 py-1 rounded-full bg-[color:rgba(45,106,138,0.10)] text-[color:var(--color-info)]"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.entries(entry.unique_topics).filter(([, v]) => v.length > 0).length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${slugs.length}, minmax(0, 1fr))` }}>
          {slugs.map((slug, idx) => {
            const unique = entry.unique_topics[slug] || [];
            const u = entry.universities[slug];
            if (!u || unique.length === 0) {
              return (
                <div key={slug}>
                  <h4 className="ui-label mb-2">Sadece {u?.name?.split(" ")[0] || slug}</h4>
                  <p className="text-xs italic text-[color:var(--color-ink-500)]">— bu kategoride özel konu yok</p>
                </div>
              );
            }
            return (
              <div key={slug}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: uniColor(idx) }} />
                  <h4 className="ui-label">Sadece {u.name.split(" ")[0]}</h4>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {unique.slice(0, 20).map((t) => (
                    <li
                      key={t}
                      className="text-xs px-2.5 py-1 rounded-full"
                      style={{
                        border: `1px dashed ${uniColor(idx)}`,
                        color: uniColor(idx),
                      }}
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
