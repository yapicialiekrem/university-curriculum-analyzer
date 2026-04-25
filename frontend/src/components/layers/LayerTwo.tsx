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
 *   2.6 ResourcesDonut      (İngilizce kaynak oranı)
 */

import useSWR from "swr";

import { BloomDonut } from "@/components/charts/BloomDonut";
import { CoverageTable } from "@/components/charts/CoverageTable";
import { OutcomesHeatmap } from "@/components/charts/OutcomesHeatmap";
import { ResourcesDonut } from "@/components/charts/ResourcesDonut";
import { SemesterHeatmap } from "@/components/charts/SemesterHeatmap";
import { StaffBars } from "@/components/charts/StaffBars";
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

interface SectionProps {
  label: string;
  title: string;
  caption?: string;
  children: React.ReactNode;
}

function Section({ label, title, caption, children }: SectionProps) {
  return (
    <section className="card">
      <div className="ui-label">{label}</div>
      <h2 className="font-serif text-2xl mb-2">{title}</h2>
      {caption && (
        <p className="text-sm italic text-[color:var(--color-ink-500)] mb-6 max-w-2xl">
          {caption}
        </p>
      )}
      <div className={caption ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export function LayerTwo() {
  const { selection } = useSelection();
  const { a, b, c, slugs } = selection;

  // Heatmap, coverage, bloom — yeni enrichment endpoint'leri (slug)
  const { data: heatmap, isLoading: heatmapLoading } = useSWR<HeatmapResponse>(
    ["heatmap", a, b, c],
    () => api.compareHeatmap(a, b, c || undefined),
    { revalidateOnFocus: false }
  );

  const { data: coverage, isLoading: coverageLoading } =
    useSWR<CoverageResponse>(
      ["coverage", a, b, c],
      () => api.compareCoverage(a, b, { c: c || undefined }),
      { revalidateOnFocus: false }
    );

  const { data: bloom, isLoading: bloomLoading } = useSWR<BloomResponse>(
    ["bloom", a, b, c],
    () => api.compareBloom(a, b, c || undefined),
    { revalidateOnFocus: false }
  );

  // Üni özetleri (slug → name lookup ve resources için)
  const summaryAB = useSWR<UniversitySummary[]>(
    ["summaries", a, b, c],
    async () => {
      const all = await Promise.all(slugs.map((s) => api.universitySummary(s)));
      return all;
    },
    { revalidateOnFocus: false }
  );
  const summaries = (summaryAB.data || []).map((d, i) => ({
    slug: slugs[i],
    data: d as UniversitySummary | undefined,
  }));

  // Staff + Outcomes — Neo4j endpoint'leri uni adıyla çağırır
  const u1Name = summaryAB.data?.[0]?.name;
  const u2Name = summaryAB.data?.[1]?.name;

  const { data: staff, isLoading: staffLoading } = useSWR<StaffComparison>(
    u1Name && u2Name ? ["staff", u1Name, u2Name] : null,
    () => api.compareStaff(u1Name!, u2Name!),
    { revalidateOnFocus: false }
  );

  const { data: outcomes, isLoading: outcomesLoading } =
    useSWR<ProgramOutcomesResponse>(
      u1Name && u2Name ? ["outcomes", u1Name, u2Name] : null,
      () => api.compareProgramOutcomes(u1Name!, u2Name!, 8),
      { revalidateOnFocus: false }
    );

  return (
    <section className="px-6 sm:px-10 max-w-[1440px] mx-auto py-16 space-y-12">
      <header className="border-t pt-8" style={{ borderColor: "var(--color-line)" }}>
        <h2 className="font-serif text-3xl tracking-tighter">Daha yakından</h2>
        <p className="mt-2 text-sm italic text-[color:var(--color-ink-500)] max-w-2xl">
          Dönem dağılımı, ortak konular, bilişsel zorluk dağılımı, program
          çıktıları benzerliği, akademik kadro ve kaynak dili.
        </p>
      </header>

      <Section
        label="2.1"
        title="Konu × Dönem Haritası"
        caption="Hücre boyutu AKTS yoğunluğunu gösterir. Solid = zorunlu, çizgili = seçmeli."
      >
        <SemesterHeatmap data={heatmap} loading={heatmapLoading} />
      </Section>

      <Section
        label="2.2"
        title="Konu Kapsamı"
        caption="Her kategoride iki/üç üniversitenin ders haftalarındaki ortak ve özel konular."
      >
        <CoverageTable
          data={coverage}
          loading={coverageLoading}
          selectedSlugs={slugs}
        />
      </Section>

      <Section
        label="2.3"
        title="Bilişsel Yoğunluk"
        caption="Bloom taksonomisi seviyelerine ECTS-ağırlıklı dağılım."
      >
        <BloomDonut data={bloom} loading={bloomLoading} />
      </Section>

      <Section
        label="2.4"
        title="Program Çıktıları Benzerliği"
        caption="Mezuniyet çıktılarının semantik (NLP) eşleşmesi."
      >
        <OutcomesHeatmap data={outcomes} loading={outcomesLoading} />
      </Section>

      <Section
        label="2.5"
        title="Akademik Kadro"
        caption="Unvan dağılımı — her nokta bir akademisyen."
      >
        <StaffBars data={staff} loading={staffLoading} />
      </Section>

      <Section
        label="2.6"
        title="Ders Kaynaklarının Dili"
        caption="Program dilinden bağımsız olarak derslerin kullandığı kaynakların dağılımı."
      >
        <ResourcesDonut summaries={summaries} loading={summaryAB.isLoading} />
      </Section>
    </section>
  );
}
