"use client";

/**
 * UniversityCard — Dashboard Bileşen 1.2.
 *
 * Kompakt yan-yana okunabilirlik için tasarlandı: 1-3 üniversite üst stripte
 * yan yana sığsın. Üst rolü: ad + bölüm + temel metrikler. Detaylar (Bloom,
 * akademik kadro) Layer 2'de.
 */

import type { UniversitySummary } from "@/lib/types";
import { X } from "lucide-react";

import { uniColor } from "@/lib/use-selection";

const TECHNICAL_CATS = [
  { key: "ai_ml", label: "Yapay Zeka" },
  { key: "security", label: "Güvenlik" },
  { key: "web_mobile", label: "Web / Mobil" },
  { key: "data_science", label: "Veri Bilimi" },
  { key: "software_eng", label: "Yazılım Müh." },
  { key: "graphics_vision", label: "Grafik / Görüntü" },
  { key: "distributed", label: "Dağıtık Sistemler" },
] as const;

export interface UniversityCardProps {
  summary: UniversitySummary | undefined;
  loading?: boolean;
  slotIndex: number;             // 0/1/2 → renk
  onRemove?: () => void;         // X butonu (a/b'de gizli, c'de var)
  removable?: boolean;
}

export function UniversityCard({
  summary,
  loading,
  slotIndex,
  onRemove,
  removable,
}: UniversityCardProps) {
  if (loading || !summary) {
    return (
      <article className="card relative">
        <div className="absolute left-0 top-6 bottom-6 w-1 rounded skeleton" />
        <div className="space-y-3 ml-2">
          <div className="h-7 w-3/4 skeleton" />
          <div className="h-4 w-1/2 skeleton" />
          <div className="h-20 w-full skeleton mt-6" />
          <div className="h-32 w-full skeleton" />
        </div>
      </article>
    );
  }

  const accent = uniColor(slotIndex);
  const enrichedRatio = summary.total_courses
    ? summary.enriched_courses / summary.total_courses
    : 1;
  const dataSparse = enrichedRatio < 0.5;
  const englishPct = Math.round(summary.english_resources_ratio * 100);

  // Top 3 teknik uzmanlaşma
  const topSpec = TECHNICAL_CATS
    .map((c) => ({
      ...c,
      d: summary.specialization_depth[c.key] || { required: 0, elective: 0, total: 0 },
    }))
    .filter((x) => x.d.total > 0)
    .sort((a, b) => b.d.total - a.d.total)
    .slice(0, 3);

  return (
    <article
      className="card relative h-full flex flex-col"
      data-testid={`uni-card-${slotIndex}`}
    >
      {/* Sol accent line */}
      <div
        className="absolute left-0 top-5 bottom-5 w-1 rounded"
        style={{ background: accent }}
      />

      {/* X kapama */}
      {removable && onRemove && (
        <button
          onClick={onRemove}
          className="absolute right-3 top-3 p-1 text-[color:var(--color-ink-300)] hover:text-[color:var(--color-ink-900)] transition-opacity"
          aria-label={`${summary.name} kaldır`}
        >
          <X size={16} />
        </button>
      )}

      <div className="ml-3 pr-6 flex-1 flex flex-col">
        <h3 className="font-serif text-base lg:text-lg font-medium leading-tight tracking-tight">
          {summary.name}
        </h3>
        <p className="text-xs text-[color:var(--color-ink-500)] italic mt-0.5">
          {summary.department || "—"}
        </p>

        {dataSparse && (
          <div
            role="status"
            className="mt-2 text-[11px] font-mono italic px-2 py-1 rounded"
            style={{
              background: "rgba(212,160,23,0.10)",
              color: "var(--color-warn)",
            }}
          >
            ⚠ {summary.enriched_courses}/{summary.total_courses} ders detaylı
          </div>
        )}

        {/* Inline metric satırı: YKS sırası · kontenjan · dil · İng. kaynak % */}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          {summary.ranking_sira != null && (
            <Metric
              label="YKS sırası"
              value={summary.ranking_sira.toLocaleString("tr-TR")}
            />
          )}
          {summary.ranking_kontenjan != null && (
            <Metric
              label="Yerleşen"
              value={`${summary.ranking_kontenjan} kişi`}
            />
          )}
          <Metric label="Dil" value={summary.language || "—"} />
          <Metric label="İng. kaynak" value={`%${englishPct}`} />
        </dl>

        {/* UZMANLAŞMA — kompakt */}
        {topSpec.length > 0 && (
          <section className="mt-4 pt-3 border-t" style={{ borderColor: "var(--color-line)" }}>
            <div className="ui-label mb-2">Uzmanlaşma</div>
            <ul className="space-y-2">
              {topSpec.map((c) => (
                <li key={c.key} className="text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[color:var(--color-ink-700)] flex-1 truncate">
                      {c.label}
                    </span>
                    <span className="font-mono text-[10px] text-[color:var(--color-ink-500)] tabular-nums">
                      {c.d.required}+{c.d.elective}
                    </span>
                  </div>
                  <SpecBlocks
                    required={c.d.required}
                    elective={c.d.elective}
                    accent={accent}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="ui-label text-[10px]">{label}</dt>
      <dd className="font-serif text-base leading-tight mt-0.5 tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/**
 * UZMANLAŞMA mini bar — FRONTEND_PROMPT.md "8px × 4px blok" görseli.
 * Zorunlu: solid accent. Seçmeli: 2px stroke, transparent fill. Max 20 blok.
 */
function SpecBlocks({
  required,
  elective,
  accent,
}: {
  required: number;
  elective: number;
  accent: string;
}) {
  const MAX = 12;
  const total = required + elective;
  const overflow = Math.max(0, total - MAX);
  const reqShown = Math.min(required, MAX);
  const elShown = Math.max(0, Math.min(elective, MAX - reqShown));

  if (total === 0) return null;

  return (
    <div className="mt-1 flex items-center gap-[2px]" aria-hidden>
      {Array.from({ length: reqShown }).map((_, i) => (
        <span
          key={`r${i}`}
          className="w-2 h-1 rounded-[1px] block"
          style={{ background: accent }}
        />
      ))}
      {Array.from({ length: elShown }).map((_, i) => (
        <span
          key={`e${i}`}
          className="w-2 h-1 rounded-[1px] block"
          style={{ border: `1px solid ${accent}`, background: "transparent" }}
        />
      ))}
      {overflow > 0 && (
        <span className="ml-1 font-mono text-[10px] text-[color:var(--color-ink-500)] tabular-nums">
          +{overflow}
        </span>
      )}
    </div>
  );
}
