"use client";

/**
 * UniversityCard — Dashboard Bileşen 1.2.
 *
 * Kompakt yan-yana okunabilirlik için tasarlandı: 1-3 üniversite üst stripte
 * yan yana sığsın. Üst rolü: ad + bölüm + temel metrikler. Detaylar (Bloom,
 * akademik kadro) Layer 2'de.
 */

import { useState } from "react";

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
      className="card relative h-full flex flex-col !p-4 lg:!p-5"
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

        {/* Tek satır metric — YKS sırası · kontenjan · dil · yabancı kaynak */}
        <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
          {summary.ranking_sira != null && (
            <Metric
              label="YKS"
              value={summary.ranking_sira.toLocaleString("tr-TR")}
              hover={
                <>
                  <strong>Son kayıtlı kişinin YKS sıralaması</strong>
                  <br />
                  {summary.ranking_sira.toLocaleString("tr-TR")}
                </>
              }
            />
          )}
          {summary.ranking_kontenjan != null && (
            <Metric
              label="Kontenjan"
              value={String(summary.ranking_kontenjan)}
              hover={
                <>
                  <strong>Bu programa yerleşen kişi sayısı</strong>
                  <br />
                  {summary.ranking_kontenjan} kişi
                </>
              }
            />
          )}
          <Metric
            label="Dil"
            value={summary.language || "—"}
            hover={
              <>
                <strong>Öğretim dili</strong>
                <br />
                {summary.language || "Bilinmiyor"}
              </>
            }
          />
          <Metric
            label="Yabancı kaynak"
            value={`%${englishPct}`}
            hover={
              <>
                <strong>Yabancı kaynak oranı</strong>
                <br />
                Ders kaynaklarının %{englishPct}'i yabancı (İngilizce) dilde
              </>
            }
          />
        </dl>

        {/* UZMANLAŞMA — her tip için 2 mini-row: ders bloku + AKTS bloku */}
        {topSpec.length > 0 && (
          <section
            className="mt-3 pt-2 border-t"
            style={{ borderColor: "var(--color-line)" }}
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <div className="ui-label">Uzmanlaşma · ders / AKTS</div>
              <SpecLegend accent={accent} />
            </div>
            <ul className="space-y-2">
              {topSpec.map((c) => {
                const reqEcts = c.d.required_ects ?? 0;
                const elEcts = c.d.elective_ects ?? 0;
                return (
                  <li key={c.key} className="text-xs">
                    <div className="text-[color:var(--color-ink-700)] truncate font-medium leading-tight mb-0.5">
                      {c.label}
                    </div>
                    <SpecRow
                      label="zorunlu"
                      count={c.d.required}
                      ects={reqEcts}
                      accent={accent}
                      variant="solid"
                      categoryLabel={c.label}
                    />
                    <SpecRow
                      label="seçmeli"
                      count={c.d.elective}
                      ects={elEcts}
                      accent={accent}
                      variant="soft"
                      categoryLabel={c.label}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

/** Metric hücresi — YKS / Kontenjan / Dil / Yabancı kaynak. Hover'da
 * yarı-saydam custom popup (native title değil). */
function Metric({
  label,
  value,
  hover,
}: {
  label: string;
  value: string;
  hover?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="min-w-0 relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <dt className="ui-label text-[9px] truncate">{label}</dt>
      <dd className="font-serif text-sm leading-tight mt-0.5 truncate">
        {value}
      </dd>
      {hovered && hover && <FloatingTooltip>{hover}</FloatingTooltip>}
    </div>
  );
}

/**
 * Uzmanlaşma tek-tip satırı (zorunlu veya seçmeli) — TEK SATIRDA ders ve
 * AKTS yan yana. CSS grid sabit-genişlikli kolonlar kullanır → zorunlu ve
 * seçmeli satırları arasında ders sayısı/AKTS farkı olsa bile AKTS kutucuk
 * kolonu vertikal hizalı kalır.
 *
 * Kolonlar: [tip etiketi] [N ders] [ders kareleri] [K AKTS] [AKTS kareleri]
 *
 * variant="solid" → dolu accent kareler (zorunlu)
 * variant="soft" → translucent (~32% alpha) accent dolgu (seçmeli)
 * Sayı 0 ise satır yarı opaklıkta "—" ile geçiş yapar.
 */
function SpecRow({
  label,
  count,
  ects,
  accent,
  variant,
  categoryLabel,
}: {
  label: "zorunlu" | "seçmeli";
  count: number;
  ects: number;
  accent: string;
  variant: "solid" | "soft";
  categoryLabel: string;
}) {
  const [hovered, setHovered] = useState(false);
  const isEmpty = count === 0;

  const block = (key: string | number, size: "ders" | "akts") => (
    <span
      key={key}
      className={`block flex-shrink-0 rounded-[1px] ${
        size === "ders" ? "w-2 h-2" : "w-2 h-1"
      }`}
      style={
        variant === "solid"
          ? { background: accent }
          : { background: hexWithAlpha(accent, 0.32) }
      }
    />
  );

  const dersMax = 12;
  const dersShown = Math.min(count, dersMax);
  const dersOverflow = Math.max(0, count - dersMax);

  // Her AKTS kutucuğu = 5 AKTS, max 12 kutucuk (60 AKTS sınırı)
  const aktsPerBlock = 5;
  const aktsMax = 12;
  const aktsBlocks = Math.min(Math.floor(ects / aktsPerBlock), aktsMax);
  const aktsOverflow = Math.max(0, ects - aktsBlocks * aktsPerBlock);

  // 12 ders bloğu = 12 * 8 + 11 * 2 = 118px → cell w-32 (128px) overflow text için yer bırakır
  return (
    <div
      className={`relative grid items-center gap-2 ${isEmpty ? "opacity-40" : ""}`}
      style={{
        gridTemplateColumns: "3.5rem 4rem 8rem 4rem 1fr",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--color-ink-500)] truncate"
        aria-hidden
      >
        {label}
      </span>
      <span
        className="font-mono text-[10px] tabular-nums"
        style={{ color: isEmpty ? "var(--color-ink-500)" : "var(--color-ink-900)" }}
      >
        {isEmpty ? "—" : `${count} ders`}
      </span>
      <div className="flex items-center gap-[2px] min-w-0 overflow-hidden" aria-hidden>
        {Array.from({ length: dersShown }).map((_, i) => block(`d${i}`, "ders"))}
        {dersOverflow > 0 && (
          <span className="ml-0.5 font-mono text-[9px] text-[color:var(--color-ink-500)] tabular-nums">
            +{dersOverflow}
          </span>
        )}
      </div>
      <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-500)]">
        {isEmpty ? "" : `${ects} AKTS`}
      </span>
      <div className="flex items-center gap-[2px] min-w-0 overflow-hidden" aria-hidden>
        {!isEmpty &&
          Array.from({ length: aktsBlocks }).map((_, i) => block(`a${i}`, "akts"))}
        {!isEmpty && aktsOverflow > 0 && (
          <span className="ml-0.5 font-mono text-[9px] text-[color:var(--color-ink-500)] tabular-nums">
            +{aktsOverflow}
          </span>
        )}
      </div>

      {hovered && (
        <FloatingTooltip>
          <strong>{categoryLabel}</strong>
          <br />
          {count} {label} ders · toplam {ects} AKTS
        </FloatingTooltip>
      )}
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
        zorunlu
      </span>
      <span className="flex items-center gap-1">
        <span
          className="w-2 h-2 rounded-[1px] block"
          style={{ background: hexWithAlpha(accent, 0.32) }}
          aria-hidden
        />
        seçmeli
      </span>
    </div>
  );
}

/**
 * Custom hover popup — yarı-saydam paper bg + backdrop blur. SemesterHeatmap
 * CellTooltip ile aynı stil. Native browser title yerine bu kullanılır;
 * cursor değişmez (`?` çıkmaz) ve görsel tutarlı kalır.
 */
function FloatingTooltip({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="tooltip"
      className="absolute left-1/2 -translate-x-1/2 -top-1 -translate-y-full z-30 pointer-events-none"
    >
      <div
        className="rounded shadow-paper px-3 py-2 text-xs whitespace-normal max-w-[260px] text-[color:var(--color-ink-900)] leading-snug"
        style={{
          background: "rgba(252,250,246,0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid var(--color-line)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * CSS color (hex/rgb/var()) + alpha → renderable color.
 *
 * uniColor() bizde "var(--color-uni-a)" gibi CSS değişkeni döner — alpha
 * ekleyemeyiz. color-mix() destekli modern tarayıcılarda doğal çözüm.
 */
function hexWithAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
