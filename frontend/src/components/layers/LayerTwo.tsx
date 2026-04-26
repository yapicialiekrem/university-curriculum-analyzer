"use client";

/**
 * LayerTwo — Dashboard Katman 2 (Detay).
 *
 * Scroll ile erişilen bölüm. 6 bileşen alt alta:
 *   2.1 SemesterHeatmap     (her üni ayrı ısı haritası)
 *   2.2 CoverageTable       (kategori sekmesi + ortak/farklı konu)
 *   2.3 BloomDonut          (her üni ayrı donut + alt liste)
 *   2.4 OutcomesHeatmap     (program çıktıları benzerliği)
 *   2.5 StaffBars           (akademik kadro dot-cluster)
 */

import useSWR from "swr";

import { BloomDonut } from "@/components/charts/BloomDonut";
import { CoverageTable } from "@/components/charts/CoverageTable";
import { OutcomesHeatmap } from "@/components/charts/OutcomesHeatmap";
import { SemesterHeatmap } from "@/components/charts/SemesterHeatmap";
import { StaffBars } from "@/components/charts/StaffBars";
import { Section } from "@/components/Section";
import { useOverlay } from "@/lib/use-overlay";
import { api } from "@/lib/api";
import type {
  BloomResponse,
  CoverageResponse,
  HeatmapResponse,
  ProgramOutcomesResponse,
  StaffComparison,
  UniversitySummary,
} from "@/lib/types";
import { useSelection } from "@/lib/use-selection";

export function LayerTwo() {
  const { selection } = useSelection();
  const { overlay } = useOverlay();
  const { a, b, c, slugs, isEmpty } = selection;

  // Heatmap, coverage, bloom — yalnız >=1 üni varsa fetch
  const { data: heatmap, isLoading: heatmapLoading } = useSWR<HeatmapResponse>(
    !isEmpty && a ? ["heatmap", a, b, c] : null,
    () => api.compareHeatmap(a as string, b || undefined, c || undefined),
    { revalidateOnFocus: false }
  );

  const { data: coverage, isLoading: coverageLoading } =
    useSWR<CoverageResponse>(
      !isEmpty && a ? ["coverage", a, b, c] : null,
      () => api.compareCoverage(a as string, b || undefined, { c: c || undefined }),
      { revalidateOnFocus: false }
    );

  const { data: bloom, isLoading: bloomLoading } = useSWR<BloomResponse>(
    !isEmpty && a ? ["bloom", a, b, c] : null,
    () => api.compareBloom(a as string, b || undefined, c || undefined),
    { revalidateOnFocus: false }
  );

  // Üni özetleri (slug → name lookup ve resources için)
  const summaryAB = useSWR<UniversitySummary[]>(
    !isEmpty ? ["summaries", a, b, c] : null,
    async () => {
      const all = await Promise.all(slugs.map((s) => api.universitySummary(s)));
      return all;
    },
    { revalidateOnFocus: false }
  );
  // Staff + Outcomes — Neo4j endpoint'leri uni adıyla çağırır
  const u1Name = summaryAB.data?.[0]?.name;
  const u2Name = summaryAB.data?.[1]?.name;
  const u3Name = summaryAB.data?.[2]?.name;

  // Tek üni → same-uni trick (backend uni1=uni2 kabul ediyor; tek panel render)
  const { data: staff, isLoading: staffLoading } = useSWR<StaffComparison>(
    u1Name ? ["staff", u1Name, u2Name || u1Name] : null,
    () => api.compareStaff(u1Name!, u2Name || u1Name!),
    { revalidateOnFocus: false }
  );

  // 3 üni varsa 3 ikili (A-B, A-C, B-C) program çıktısı karşılaştırması.
  // Her ikili için ayrı SWR çağrısı — backend tek-ikili endpoint sunuyor.
  const { data: outcomesAB, isLoading: outcomesABLoading } =
    useSWR<ProgramOutcomesResponse>(
      u1Name && u2Name ? ["outcomes", u1Name, u2Name, selection.department] : null,
      () => api.compareProgramOutcomes(u1Name!, u2Name!, 8, selection.department),
      { revalidateOnFocus: false }
    );
  const { data: outcomesAC, isLoading: outcomesACLoading } =
    useSWR<ProgramOutcomesResponse>(
      u1Name && u3Name ? ["outcomes", u1Name, u3Name, selection.department] : null,
      () => api.compareProgramOutcomes(u1Name!, u3Name!, 8, selection.department),
      { revalidateOnFocus: false }
    );
  const { data: outcomesBC, isLoading: outcomesBCLoading } =
    useSWR<ProgramOutcomesResponse>(
      u2Name && u3Name ? ["outcomes", u2Name, u3Name, selection.department] : null,
      () => api.compareProgramOutcomes(u2Name!, u3Name!, 8, selection.department),
      { revalidateOnFocus: false }
    );

  const outcomePairs: import("@/components/charts/OutcomesHeatmap").PairwiseOutcomes[] = [
    {
      slotA: 0,
      slotB: 1,
      slugA: slugs[0],
      slugB: slugs[1],
      data: outcomesAB,
      loading: outcomesABLoading,
    },
  ];
  if (u3Name) {
    outcomePairs.push(
      {
        slotA: 0,
        slotB: 2,
        slugA: slugs[0],
        slugB: slugs[2],
        data: outcomesAC,
        loading: outcomesACLoading,
      },
      {
        slotA: 1,
        slotB: 2,
        slugA: slugs[1],
        slugB: slugs[2],
        data: outcomesBC,
        loading: outcomesBCLoading,
      },
    );
  }

  // Empty mode: tüm bölümler iskelet halinde görünür. Her Section
  // içeriğinde "Üniversite seç" mesajı ya da boş silüet gösterir.

  return (
    <section className="px-6 sm:px-10 max-w-[1440px] mx-auto py-16 space-y-12">
      <header className="border-t pt-8" style={{ borderColor: "var(--color-line)" }}>
        <h2 className="font-serif text-3xl tracking-tighter">Daha yakından</h2>
      </header>

      <Section
        id="section-2-1"
        label="2.1"
        title="Konu × Dönem Haritası"
        caption="Her karede üst sayı zorunlu AKTS, alttaki italik +N seçmeli AKTS. Boş kareler o dönemde ders yok demek."
        delay={0}
        highlighted={overlay?.show_metric === "semester_heatmap"}
      >
        {isEmpty ? (
          <SectionEmptyHint />
        ) : (
          <SemesterHeatmap data={heatmap} loading={heatmapLoading} />
        )}
      </Section>

      <Section
        id="section-2-2"
        label="2.2"
        title="Konu Kapsamı"
        caption={
          slugs.length === 1
            ? "Üniversitenin ders haftalarındaki konuları."
            : "Farklı alanlarda üniversitelerin ders haftalarındaki ortak ve özel konular."
        }
        delay={0.05}
        highlighted={overlay?.show_metric === "coverage_table"}
      >
        {isEmpty ? (
          <SectionEmptyHint />
        ) : (
          <CoverageTable
            data={coverage}
            loading={coverageLoading}
            selectedSlugs={slugs}
          />
        )}
      </Section>

      <Section
        id="section-2-3"
        label="2.3"
        title="Bilişsel Yoğunluk"
        caption="Öğrenme çıktılarından çıkarılan Bloom seviyelerine ECTS-ağırlıklı dağılım."
        delay={0.1}
        highlighted={overlay?.show_metric === "bloom_donut" || overlay?.show_metric === "project_heaviness"}
      >
        {isEmpty ? <SectionEmptyHint /> : <BloomDonut data={bloom} loading={bloomLoading} />}
      </Section>

      <Section
        id="section-2-4"
        label="2.4"
        title="Program Çıktıları"
        caption={
          slugs.length === 1
            ? "Bu üniversitenin mezuniyet kazanımları (program çıktıları) listesi."
            : "Mezuniyet çıktılarının semantik (NLP) eşleşmesi. Hücreye gel — iki çıktının tam metni alttan açılır."
        }
        delay={0.15}
      >
        {isEmpty ? (
          <SectionEmptyHint />
        ) : slugs.length === 1 ? (
          <SingleUniOutcomes slug={slugs[0]} department={selection.department} />
        ) : (
          <OutcomesHeatmap pairs={outcomePairs} />
        )}
      </Section>

      <Section
        id="section-2-5"
        label="2.5"
        title="Akademik Kadro"
        caption="Unvan dağılımı."
        delay={0.2}
        highlighted={overlay?.show_metric === "staff_bars"}
      >
        {isEmpty ? (
          <SectionEmptyHint />
        ) : (
          <StaffBars data={staff} loading={staffLoading} singleMode={slugs.length === 1} />
        )}
      </Section>
    </section>
  );
}

function SectionEmptyHint() {
  return (
    <div
      className="border border-dashed rounded p-6 text-center"
      style={{ borderColor: "var(--color-line)" }}
    >
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)] leading-relaxed">
        Üniversite seç.
      </p>
    </div>
  );
}

function NeedsMoreHint({ message }: { message: string }) {
  return (
    <div
      className="border border-dashed rounded p-6 text-center"
      style={{ borderColor: "var(--color-line)" }}
    >
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        {message}
      </p>
    </div>
  );
}

function SingleUniOutcomes({ slug, department: _department }: { slug: string; department: string }) {
  void _department;
  const { data, isLoading, error } = useSWR<UniversitySummary>(
    ["summary-outcomes", slug],
    () => api.universitySummary(slug),
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 w-full skeleton rounded" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Program çıktıları yüklenemedi.
      </p>
    );
  }

  const outcomes = data?.program_outcomes || [];
  if (outcomes.length === 0) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Bu üniversite için program çıktısı verisi yok.
      </p>
    );
  }

  return (
    <ol
      className="space-y-2.5 text-sm leading-relaxed"
      style={{ counterReset: "po" }}
    >
      {outcomes.map((text, i) => (
        <li
          key={i}
          className="grid grid-cols-[auto_1fr] gap-3 items-baseline"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-ink-500)] tabular-nums">
            P{i + 1}
          </span>
          <span className="text-[color:var(--color-ink-900)]">{text}</span>
        </li>
      ))}
    </ol>
  );
}
