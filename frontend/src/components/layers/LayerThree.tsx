"use client";

/**
 * LayerThree — Derin Analiz (akademisyen kullanımı).
 *
 *   3.1 CurriculumCoverageHeatmap   /api/compare/curriculum-coverage
 *   3.2 PrereqSummary               /api/compare/prerequisites
 *   3.3 ResourcesTable              /api/compare/resources
 *   3.4 CourseSimilarity            POST /api/search (FAISS)
 */

import { useEffect, useMemo } from "react";
import useSWR from "swr";

import dynamic from "next/dynamic";

import { CourseSimilarity } from "@/components/charts/CourseSimilarity";
import { CurriculumCoverageHeatmap } from "@/components/charts/CurriculumCoverageHeatmap";
import { ResourcesTable } from "@/components/charts/ResourcesTable";
import { Section } from "@/components/Section";
import { api } from "@/lib/api";

// ReactFlow ağır (~80 KB) — sadece deep-analysis sayfasında ve scroll
// edildiğinde yüklensin
const PrereqGraph = dynamic(
  () => import("@/components/charts/PrereqGraph").then((m) => ({ default: m.PrereqGraph })),
  { ssr: false, loading: () => <div className="h-[420px] skeleton rounded" /> }
);
import type {
  CurriculumCoverageResponse,
  PrerequisitesResponse,
  ResourcesResponse,
  UniversityListItem,
  UniversitySummary,
} from "@/lib/types";
import { useSelection } from "@/lib/use-selection";

const SLOT_KEYS: Array<"a" | "b" | "c"> = ["a", "b", "c"];

export function LayerThree() {
  const { selection, setSelection } = useSelection();
  const { a, b, slugs, department, isEmpty } = selection;
  const needsTwoUnis = slugs.length < 2;

  // Bölüm listesini çek — slug → ad eşlemesi + invalid slug auto-correction.
  // Ana sayfadaki UniversityPicker bu işi yapar; deep-link ile gelen kullanıcı
  // veya stale slug'lı eski URL'lerde de aynı düzeltme tetiklensin.
  const { data: uniList } = useSWR<UniversityListItem[]>(
    ["universities", department],
    () => api.universities(department),
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const slugToName = useMemo(() => {
    const m = new Map<string, string>();
    uniList?.forEach((u) => m.set(u.slug, u.name));
    return m;
  }, [uniList]);

  // Geçersiz slug'ları ilk uygun üniversite ile değiştir (atomik replace)
  useEffect(() => {
    if (!uniList || uniList.length === 0) return;
    const valid = new Set(uniList.map((u) => u.slug));
    const invalidSlots: Array<"a" | "b" | "c"> = [];
    slugs.forEach((slug, idx) => {
      if (!valid.has(slug)) invalidSlots.push(SLOT_KEYS[idx]);
    });
    if (invalidSlots.length === 0) return;

    const used = new Set(slugs.filter((s) => valid.has(s)));
    const available = uniList.filter((u) => !used.has(u.slug));

    const update: Partial<{ a: string; b: string; c: string | null }> = {};
    invalidSlots.forEach((slot, i) => {
      const next = available[i];
      if (next) {
        used.add(next.slug);
        update[slot] = next.slug;
      } else if (slot === "c") {
        update.c = null;
      }
    });
    if (Object.keys(update).length > 0) {
      setSelection(update);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniList, slugs.join(",")]);

  const selectedNames = slugs.map((s) => slugToName.get(s) || s);

  // Slug → uni adı (Neo4j endpoint'leri uni adı bekler)
  const summaryAB = useSWR<UniversitySummary[]>(
    !isEmpty && a && b ? ["summaries-deep", a, b] : null,
    async () => {
      const all = await Promise.all([
        api.universitySummary(a as string),
        api.universitySummary(b as string),
      ]);
      return all;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const u1Name = summaryAB.data?.[0]?.name;
  const u2Name = summaryAB.data?.[1]?.name;
  const summaryError = summaryAB.error;

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
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-xl sm:text-2xl tracking-tighter leading-none">
            Derin Analiz
          </h1>
          <span className="ui-label">Akademisyen Görünümü</span>
        </div>
        <p className="mt-3 text-sm">
          <strong>{slugs.length}</strong> üniversite seçili: {selectedNames.join(", ") || "—"}
        </p>
      </header>

      {needsTwoUnis && (
        <div
          className="border-l-2 pl-4 py-3 text-sm italic font-serif text-[color:var(--color-ink-700)]"
          style={{ borderColor: "var(--color-ink-700)" }}
        >
          Derin analiz iki üniversite arasında karşılaştırma yapar. Ana
          sayfadan {isEmpty ? "iki" : "bir tane daha"} üniversite seç.
          Aşağıdaki ders-ders benzerliği tek başına da çalışır.
        </div>
      )}

      {summaryError && (
        <div
          className="border-l-2 pl-4 py-3 text-sm italic font-serif text-[color:var(--color-ink-700)]"
          style={{ borderColor: "var(--color-ink-700)" }}
        >
          Üniversite bilgisi alınamadı. Backend kapalı olabilir veya seçili
          slug ({a} / {b}) geçersiz — ana sayfadan başka bir üniversite seç.
        </div>
      )}

      {!needsTwoUnis && (
        <>
          <Section
            label="3.1"
            title="Haftalık Konu Eşlemesi"
            caption="İki üniversitenin tüm dersleri arasında semantik (NLP) en benzer konu çiftleri. Üst sıralarda dersin tam karşılığı, alt sıralarda kısmi örtüşme."
          >
            <CurriculumCoverageHeatmap data={curriculum} loading={curriculumLoading} />
          </Section>

          <Section
            label="3.2"
            title="Önkoşul Ağı"
            caption="Hangi dersin neye bağımlı olduğu — köklerden yukarı doğru. Bir derse tıkla, alt zinciri vurgulanır."
          >
            <PrereqGraph data={prereq} loading={prereqLoading} />
          </Section>

          <Section
            label="3.3"
            title="Ortak Ders Kaynakları"
            caption="İki üniversitede de okutulan kitap, makale ve kaynaklar."
          >
            <ResourcesTable data={resources} loading={resourcesLoading} />
          </Section>
        </>
      )}

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
