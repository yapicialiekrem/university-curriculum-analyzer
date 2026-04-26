"use client";

/**
 * LayerOne — Dashboard Katman 1: İlk Bakış
 *
 * Layout (geniş ekran):
 *   ┌──────────────────────────────────────────────┐
 *   │  Card A    │   Card B    │   Card C (ops.)   │  ← yatay strip
 *   ├──────────────────────────────────────────────┤
 *   │             RADAR (max-w 520px, ortada)      │  ← tek bakışta okuma
 *   └──────────────────────────────────────────────┘
 *
 * Kullanıcı 2-3 üniversiteyi YAN YANA görür ve gözünü hemen radar'a kaydırır
 * — kartların ve radar'ın aynı viewport içinde okunabilmesi için.
 */

import useSWR from "swr";

import { CategoryRadar } from "@/components/charts/CategoryRadar";
import { UniversityCard } from "@/components/cards/UniversityCard";
import { DepartmentTabs } from "@/components/selectors/DepartmentTabs";
import { UniversityPicker } from "@/components/selectors/UniversityPicker";
import { api } from "@/lib/api";
import type { RadarResponse, UniversitySummary } from "@/lib/types";
import { useOverlay } from "@/lib/use-overlay";
import { useSelection } from "@/lib/use-selection";

export function LayerOne() {
  const {
    selection,
    setDepartment,
    addUniversity,
    removeUniversity,
    replaceUniversity,
    setSelection,
  } = useSelection();
  const { overlay } = useOverlay();
  const { a, b, c, slugs, department, isEmpty } = selection;

  // Radar verisi — yalnız >=1 üni seçiliyse fetch
  const { data: radar, isLoading: radarLoading } = useSWR<RadarResponse>(
    !isEmpty ? ["radar", a, b, c] : null,
    () => api.compareRadar(a as string, b || undefined, c || undefined),
    { revalidateOnFocus: false }
  );

  const radarHighlighted = overlay?.show_metric === "category_radar";

  return (
    <section className="px-4 sm:px-6 lg:px-10 max-w-[1440px] mx-auto pt-4 sm:pt-5 pb-10">
      {/* Üst bar — tek satır: ad + seçici + bölüm sekmeleri */}
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mb-3 lg:mb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-xl sm:text-2xl tracking-tighter leading-none">
            İlk Bakışta
          </h1>
          <span className="ui-label">Temel Bilgiler</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 lg:flex-1 lg:justify-end">
          <UniversityPicker
            selectedSlugs={slugs}
            department={department}
            onAdd={addUniversity}
            onRemove={removeUniversity}
            onReplace={replaceUniversity}
            onSetSelection={setSelection}
          />
          <DepartmentTabs active={department} onChange={setDepartment} />
        </div>
      </header>

      {/* Üst strip: 1-3 kart. Hiç seçim yoksa 2 boş placeholder kart →
          dashboard yapısı korunsun, kullanıcı ne göreceğini önceden anlasın. */}
      <div
        className={`grid gap-3 lg:gap-4 mb-4 lg:mb-5 grid-cols-1 ${
          isEmpty || slugs.length === 2
            ? "sm:grid-cols-2"
            : slugs.length === 1
            ? "sm:grid-cols-1 max-w-[480px]"
            : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {isEmpty
          ? [0, 1].map((idx) => <EmptyCard key={idx} slotIndex={idx} />)
          : slugs.map((slug, idx) => (
              <UniversitySummaryCard
                key={slug}
                slug={slug}
                slotIndex={idx}
                removable
                onRemove={() => removeUniversity(slug)}
              />
            ))}
      </div>

      {/* Altta radar — ortalı, kompakt; başlık tek satırda yan tarafta */}
      <div
        id="section-radar"
        className={`card relative !p-3 lg:!p-4 flex flex-col items-center${
          radarHighlighted ? " overlay-glow" : ""
        }`}
      >
        <div className="absolute top-3 left-4 lg:top-4 lg:left-5 flex items-baseline gap-2 z-10">
          <h2 className="font-serif text-base lg:text-lg leading-none tracking-tight">
            10 eksende kapsam
          </h2>
          <span className="ui-label text-[10px]">Konu Kapsamı</span>
        </div>
        <div className="w-full flex items-center justify-center">
          {isEmpty ? (
            <EmptyRadarShell />
          ) : (
            <CategoryRadar
              data={radar}
              loading={radarLoading}
              highlight_axis={overlay?.highlight_category || null}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** Boş placeholder kart — dashboard yapısı korunsun. */
function EmptyCard({ slotIndex }: { slotIndex: number }) {
  const accent = ["var(--color-uni-a)", "var(--color-uni-b)", "var(--color-uni-c)"][slotIndex] || "var(--color-ink-700)";
  return (
    <article
      className="card relative h-full flex flex-col items-center justify-center text-center !p-4 lg:!p-5 py-8"
      style={{
        borderStyle: "dashed",
        borderColor: "var(--color-line)",
        opacity: 0.85,
      }}
    >
      <div
        className="absolute left-0 top-5 bottom-5 w-1 rounded opacity-30"
        style={{ background: accent }}
      />
      <div className="ml-3 px-4">
        <p className="ui-label text-[10px] mb-1">Üniversite seçilmedi</p>
        <p className="text-sm italic font-serif text-[color:var(--color-ink-500)] leading-snug">
          Yukarıdan üniversite ekle — burada özet, YKS verisi ve uzmanlaşma
          görünür.
        </p>
      </div>
    </article>
  );
}

/** Boş radar silüet — 10 eksenli dashed çokgen. */
function EmptyRadarShell() {
  const axes = 10;
  const cx = 50;
  const cy = 50;
  const r = 38;
  return (
    <div className="aspect-square w-full max-w-[340px] mx-auto opacity-40" aria-hidden>
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <polygon
          points={Array.from({ length: axes })
            .map((_, i) => {
              const a = (i / axes) * Math.PI * 2 - Math.PI / 2;
              return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
            })
            .join(" ")}
          fill="none"
          stroke="rgba(15,14,13,0.20)"
          strokeWidth="0.6"
          strokeDasharray="2 2"
        />
        {Array.from({ length: axes }).map((_, i) => {
          const a = (i / axes) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + Math.cos(a) * r}
              y2={cy + Math.sin(a) * r}
              stroke="rgba(15,14,13,0.10)"
              strokeWidth="0.4"
            />
          );
        })}
      </svg>
    </div>
  );
}

function UniversitySummaryCard({
  slug,
  slotIndex,
  removable,
  onRemove,
}: {
  slug: string;
  slotIndex: number;
  removable: boolean;
  onRemove: () => void;
}) {
  const { data, isLoading, error } = useSWR<UniversitySummary>(
    ["summary", slug],
    () => api.universitySummary(slug),
    { revalidateOnFocus: false }
  );

  if (error) {
    return (
      <article className="card">
        <p className="text-sm text-[color:var(--color-alert)]">
          {slug}: özet yüklenemedi.
        </p>
      </article>
    );
  }

  return (
    <UniversityCard
      summary={data}
      loading={isLoading}
      slotIndex={slotIndex}
      removable={removable}
      onRemove={onRemove}
    />
  );
}
