"use client";

/**
 * LayerThree — Derin Analiz (akademisyen kullanımı).
 *
 *   3.1 CurriculumCoverageHeatmap   /api/compare/curriculum-coverage
 *   3.2 PrereqSummary               /api/compare/prerequisites
 *   3.3 ResourcesTable              /api/compare/resources
 *   3.4 CourseSimilarity            POST /api/search (FAISS)
 */

import useSWR from "swr";

import { CourseSimilarity } from "@/components/charts/CourseSimilarity";
import { CurriculumCoverageHeatmap } from "@/components/charts/CurriculumCoverageHeatmap";
import { PrereqSummary } from "@/components/charts/PrereqSummary";
import { ResourcesTable } from "@/components/charts/ResourcesTable";
import { Section } from "@/components/Section";
import { api } from "@/lib/api";
import type {
  CurriculumCoverageResponse,
  PrerequisitesResponse,
  ResourcesResponse,
  UniversitySummary,
} from "@/lib/types";
import { useSelection } from "@/lib/use-selection";

export function LayerThree() {
  const { selection } = useSelection();
  const { a, b, slugs } = selection;

  // Slug → uni adı (Neo4j endpoint'leri uni adı bekler)
  const summaryAB = useSWR<UniversitySummary[]>(
    ["summaries-deep", a, b],
    async () => {
      const all = await Promise.all([
        api.universitySummary(a),
        api.universitySummary(b),
      ]);
      return all;
    },
    { revalidateOnFocus: false }
  );

  const u1Name = summaryAB.data?.[0]?.name;
  const u2Name = summaryAB.data?.[1]?.name;

  const { data: curriculum, isLoading: curriculumLoading } =
    useSWR<CurriculumCoverageResponse>(
      u1Name && u2Name ? ["curriculum", u1Name, u2Name] : null,
      () => api.compareCurriculumCoverage(u1Name!, u2Name!, 20),
      { revalidateOnFocus: false }
    );

  const { data: prereq, isLoading: prereqLoading } =
    useSWR<PrerequisitesResponse>(
      u1Name && u2Name ? ["prereq", u1Name, u2Name] : null,
      () => api.comparePrerequisites(u1Name!, u2Name!),
      { revalidateOnFocus: false }
    );

  const { data: resources, isLoading: resourcesLoading } =
    useSWR<ResourcesResponse>(
      u1Name && u2Name ? ["resources", u1Name, u2Name] : null,
      () => api.compareResources(u1Name!, u2Name!),
      { revalidateOnFocus: false }
    );

  return (
    <section className="px-6 sm:px-10 max-w-[1440px] mx-auto py-12 space-y-10">
      <header className="border-b pb-6" style={{ borderColor: "var(--color-line)" }}>
        <p className="ui-label mb-1">Derin Analiz</p>
        <h1 className="font-serif text-3xl sm:text-4xl tracking-tighter">
          Müfredatın çekirdeği
        </h1>
        <p className="mt-2 text-sm italic text-[color:var(--color-ink-500)] max-w-2xl">
          Akademisyen / araştırmacı kullanımı için tam haftalık konu eşlemesi,
          önkoşul karmaşıklığı, ortak kaynaklar ve ders-ders embedding araması.
          Karşılaştırılan üniversiteleri ana sayfadan değiştirebilirsiniz; URL
          state korunur.
        </p>
        <p className="mt-3 text-sm">
          <strong>{slugs.length}</strong> üniversite seçili: {slugs.join(", ")}
        </p>
      </header>

      <Section
        label="3.1"
        title="Haftalık Konu Eşlemesi"
        caption="İki üniversitenin tüm dersleri arasında semantik (NLP) en benzer konu çiftleri. Üst sıralarda dersin tam karşılığı, alt sıralarda kısmi örtüşme."
      >
        <CurriculumCoverageHeatmap data={curriculum} loading={curriculumLoading} />
      </Section>

      <Section
        label="3.2"
        title="Önkoşul Yapısı"
        caption="Hangi derslerin diğerlerine bağımlı olduğu, ortalama derinlik ve örnek zincirler."
      >
        <PrereqSummary data={prereq} loading={prereqLoading} />
      </Section>

      <Section
        label="3.3"
        title="Ortak Ders Kaynakları"
        caption="İki üniversitede de okutulan kitap, makale ve kaynaklar."
      >
        <ResourcesTable data={resources} loading={resourcesLoading} />
      </Section>

      <Section
        label="3.4"
        title="Ders-Ders Benzerliği"
        caption="Embedding tabanlı semantik arama. Tüm 51 üniversite, 8721 ders üzerinde anında çalışır."
      >
        <CourseSimilarity />
      </Section>
    </section>
  );
}
