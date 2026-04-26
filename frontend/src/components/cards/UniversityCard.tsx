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

  // Top 2 teknik uzmanlaşma — tek viewport'a sığsın diye kompakt liste
  const topSpec = TECHNICAL_CATS
    .map((c) => ({
      ...c,
      d: summary.specialization_depth[c.key] || { required: 0, elective: 0, total: 0 },
    }))
    .filter((x) => x.d.total > 0)
    .sort((a, b) => b.d.total - a.d.total)
    .slice(0, 2);

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

        {/* Tek satır metric — YKS sırası · kontenjan · dil · İng. kaynak */}
        <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
          {summary.ranking_sira != null && (
            <Metric
              label="YKS"
              value={summary.ranking_sira.toLocaleString("tr-TR")}
            />
          )}
          {summary.ranking_kontenjan != null && (
            <Metric
              label="Yerleşen"
              value={String(summary.ranking_kontenjan)}
            />
          )}
          <Metric label="Dil" value={summary.language?.slice(0, 3) || "—"} />
          <Metric label="İng. kayn." value={`%${englishPct}`} />
        </dl>

        {/* UZMANLAŞMA — kompakt: kategori adı + zorunlu (solid) ve seçmeli (open)
            ayrı satırda. Lejant en üstte tek sefer. */}
        {topSpec.length > 0 && (
          <section
            className="mt-3 pt-2 border-t"
            style={{ borderColor: "var(--color-line)" }}
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <div className="ui-label">Uzmanlaşma</div>
              <SpecLegend accent={accent} />
            </div>
            <ul className="space-y-1.5">
              {topSpec.map((c) => (
                <li key={c.key} className="text-xs">
                  <div className="text-[color:var(--color-ink-700)] truncate font-medium leading-tight mb-0.5">
                    {c.label}
                  </div>
                  <SpecRow
                    label="zor."
                    count={c.d.required}
                    accent={accent}
                    variant="solid"
                  />
                  <SpecRow
                    label="seç."
                    count={c.d.elective}
                    accent={accent}
                    variant="open"
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
    <div className="min-w-0">
      <dt className="ui-label text-[9px] truncate">{label}</dt>
      <dd className="font-serif text-sm leading-tight mt-0.5 tabular-nums truncate">
        {value}
      </dd>
    </div>
  );
}

/**
 * Uzmanlaşma satırı — bir tip (zorunlu/seçmeli) için etiket + sayı + mini blok.
 * variant="solid" → dolu accent kareler (zorunlu)
 * variant="open" → boş çerçeve kareler (seçmeli)
 * Sayı 0 ise satır yarı opaklıkta "—" ile geçiş yapar (sıralama bozulmasın).
 */
function SpecRow({
  label,
  count,
  accent,
  variant,
}: {
  label: string;
  count: number;
  accent: string;
  variant: "solid" | "open";
}) {
  const MAX = 12;
  const shown = Math.min(count, MAX);
  const overflow = Math.max(0, count - MAX);

  return (
    <div
      className={`flex items-center gap-1.5 ${count === 0 ? "opacity-40" : ""}`}
    >
      <span
        className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--color-ink-500)] w-7 flex-shrink-0"
        aria-hidden
      >
        {label}
      </span>
      <span
        className="font-mono text-[11px] tabular-nums w-5 text-right flex-shrink-0"
        style={{ color: count > 0 ? "var(--color-ink-900)" : "var(--color-ink-500)" }}
      >
        {count > 0 ? count : "—"}
      </span>
      <div className="flex items-center gap-[2px] flex-1 min-w-0" aria-hidden>
        {Array.from({ length: shown }).map((_, i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-[1px] block flex-shrink-0"
            style={
              variant === "solid"
                ? { background: accent }
                : {
                    background: "transparent",
                    border: `1.5px solid ${accent}`,
                  }
            }
          />
        ))}
        {overflow > 0 && (
          <span className="ml-1 font-mono text-[10px] text-[color:var(--color-ink-500)] tabular-nums">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}

/** Mini lejant — kart başında zorunlu/seçmeli sembollerinin anlamı. */
function SpecLegend({ accent }: { accent: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-ink-500)]">
      <span className="flex items-center gap-1">
        <span
          className="w-2 h-2 rounded-[1px] block"
          style={{ background: accent }}
          aria-hidden
        />
        zor.
      </span>
      <span className="flex items-center gap-1">
        <span
          className="w-2 h-2 rounded-[1px] block"
          style={{ border: `1.5px solid ${accent}`, background: "transparent" }}
          aria-hidden
        />
        seç.
      </span>
    </div>
  );
}
