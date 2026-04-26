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
            Yan yana
          </h1>
          <span className="ui-label">İlk bakışta</span>
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

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* Üst strip: üniversite kartları yan yana (1-3 kart) */}
          <div
            className={`grid gap-3 lg:gap-4 mb-4 lg:mb-5 grid-cols-1 ${
              slugs.length === 1
                ? "sm:grid-cols-1 max-w-[480px]"
                : slugs.length === 2
                ? "sm:grid-cols-2"
                : "sm:grid-cols-2 lg:grid-cols-3"
            }`}
          >
            {slugs.map((slug, idx) => (
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
              <CategoryRadar
                data={radar}
                loading={radarLoading}
                highlight_axis={overlay?.highlight_category || null}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div
      className="card flex flex-col items-center justify-center text-center py-16 lg:py-24"
      style={{ borderStyle: "dashed", borderColor: "var(--color-line)" }}
    >
      <p className="ui-label mb-2">Üniversite seçimi bekleniyor</p>
      <h2 className="font-serif text-2xl tracking-tight max-w-md leading-tight">
        Yukarıdaki seçiciden 1, 2 veya 3 üniversite ekle
      </h2>
      <p className="mt-3 text-sm italic font-serif text-[color:var(--color-ink-500)] max-w-md leading-relaxed">
        Tek seçimle bir üniversitenin müfredatına bakabilir, iki/üç seçimle
        karşılaştırma yapabilirsin. İstediğin zaman alttaki asistana doğrudan
        soru da sorabilirsin.
      </p>
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
