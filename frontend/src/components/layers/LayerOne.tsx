"use client";

/**
 * LayerOne — Dashboard Katman 1: İlk Bakış
 *
 * Grid:
 *   ┌─ Radar (7/12) ─┬─ Card A (5/12) ─┐
 *   │                ├─────────────────┤
 *   │                │  Card B         │
 *   └────────────────┴─────────────────┘
 *
 * Üst bar: üniversite seçici + bölüm sekmeleri
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
  const { selection, setDepartment, addUniversity, removeUniversity } = useSelection();
  const { overlay } = useOverlay();
  const { a, b, c, slugs, department } = selection;

  // Radar verisi
  const { data: radar, isLoading: radarLoading } = useSWR<RadarResponse>(
    ["radar", a, b, c],
    () => api.compareRadar(a, b, c || undefined),
    { revalidateOnFocus: false }
  );

  const radarHighlighted = overlay?.show_metric === "category_radar";

  return (
    <section className="px-4 sm:px-6 lg:px-10 max-w-[1440px] mx-auto pt-8 sm:pt-12 pb-16">
      {/* Üst bar — başlık + seçici */}
      <header className="flex flex-col gap-6 mb-8 lg:mb-10">
        <div>
          <p className="ui-label mb-1">İlk bakışta</p>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tighter leading-[1.1]">
            İki müfredatı yan yana oku
          </h1>
          <p className="mt-3 text-sm sm:text-base italic font-serif text-[color:var(--color-ink-500)] max-w-2xl leading-relaxed">
            Türk üniversitelerinin bilgisayar / yazılım mühendisliği / yönetim
            bilişim sistemleri müfredatlarını 10 eksende, 8 dönemde ve LLM
            destekli sohbetle yan yana gör.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <UniversityPicker
            selectedSlugs={slugs}
            department={department}
            onAdd={addUniversity}
            onRemove={removeUniversity}
          />
          <DepartmentTabs active={department} onChange={setDepartment} />
        </div>
      </header>

      {/* Grid: radar (sol) + kartlar (sağ) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        <div
          id="section-radar"
          className={`lg:col-span-7 card lg:p-8 flex flex-col${
            radarHighlighted ? " overlay-glow" : ""
          }`}
        >
          <div className="ui-label mb-2">Konu Kapsamı</div>
          <h2 className="font-serif text-2xl mb-4 tracking-tight">
            10 eksende kapsam
          </h2>
          <div className="flex-1 flex items-center justify-center">
            <CategoryRadar
              data={radar}
              loading={radarLoading}
              highlight_axis={overlay?.highlight_category || null}
            />
          </div>
        </div>

        <div className="lg:col-span-5 grid grid-rows-[auto_auto] gap-6">
          {slugs.map((slug, idx) => (
            <UniversitySummaryCard
              key={slug}
              slug={slug}
              slotIndex={idx}
              removable={idx === 2}
              onRemove={() => removeUniversity(slug)}
            />
          ))}
        </div>
      </div>
    </section>
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
