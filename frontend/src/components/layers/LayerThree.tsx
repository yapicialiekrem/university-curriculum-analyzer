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
import { ResourcesSingleUni } from "@/components/charts/ResourcesSingleUni";
import { ResourcesTable } from "@/components/charts/ResourcesTable";
import { WeeklyTopicsSingleUni } from "@/components/charts/WeeklyTopicsSingleUni";
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
  UniversityFull,
  UniversityListItem,
  UniversityResourcesResponse,
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

  // Slug → uni adı (Neo4j endpoint'leri uni adı bekler).
  // Tek üni modunda da çalışır — sadece u1 alınır.
  const summaryAB = useSWR<UniversitySummary[]>(
    !isEmpty && a ? ["summaries-deep", a, b] : null,
    async () => {
      const calls = [api.universitySummary(a as string)];
      if (b) calls.push(api.universitySummary(b));
      return Promise.all(calls);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const u1Name = summaryAB.data?.[0]?.name;
  const u2Name = summaryAB.data?.[1]?.name;
  const summaryError = summaryAB.error;

  // 3.1 Haftalık Konu Eşlemesi — kıyaslama, hala 2 üni gerekli
  const { data: curriculum, isLoading: curriculumLoading } =
    useSWR<CurriculumCoverageResponse>(
      u1Name && u2Name ? ["curriculum", u1Name, u2Name] : null,
      () => api.compareCurriculumCoverage(u1Name!, u2Name!, 20),
      { revalidateOnFocus: false }
    );

  // 3.2 Önkoşul Ağı — tek üni modunda backend same-uni trick'i kabul ediyor
  const { data: prereq, isLoading: prereqLoading } =
    useSWR<PrerequisitesResponse>(
      u1Name ? ["prereq", u1Name, u2Name || u1Name] : null,
      () => api.comparePrerequisites(u1Name!, u2Name || u1Name!),
      { revalidateOnFocus: false }
    );

  // 3.3 Ders Kaynakları — 2 üni: ortak kıyas; 1 üni: o üni'nin tüm kaynakları
  const { data: resources, isLoading: resourcesLoading } =
    useSWR<ResourcesResponse>(
      u1Name && u2Name ? ["resources", u1Name, u2Name] : null,
      () => api.compareResources(u1Name!, u2Name!),
      { revalidateOnFocus: false }
    );

  // Per-uni full + resources — 1, 2 veya 3 üni için çalışır.
  // 3.1 her üni'nin haftalık konularını ayrı gösterir, altında 2+ üni
  // varsa CurriculumCoverageHeatmap eşleşmeyi gösterir.
  // 3.3 her üni'nin kaynaklarını ayrı gösterir, altında 2+ üni varsa
  // ResourcesTable ortak kaynakları gösterir.
  const { data: fullBySlug, isLoading: fullLoading } = useSWR<
    Record<string, UniversityFull>
  >(
    !isEmpty ? ["full-multi", slugs.join(",")] : null,
    async () => {
      const res = await Promise.all(slugs.map((s) => api.universityFull(s)));
      return slugs.reduce<Record<string, UniversityFull>>((acc, s, i) => {
        acc[s] = res[i];
        return acc;
      }, {});
    },
    { revalidateOnFocus: false }
  );

  const { data: resourcesBySlug, isLoading: resourcesBySlugLoading } = useSWR<
    Record<string, UniversityResourcesResponse>
  >(
    !isEmpty ? ["resources-multi", slugs.join(",")] : null,
    async () => {
      const res = await Promise.all(
        slugs.map((s) => api.universityResources(s))
      );
      return slugs.reduce<Record<string, UniversityResourcesResponse>>(
        (acc, s, i) => {
          acc[s] = res[i];
          return acc;
        },
        {}
      );
    },
    { revalidateOnFocus: false }
  );

  return (
    <section className="px-6 sm:px-10 max-w-[1440px] mx-auto py-12 space-y-10">
      <header className="border-b pb-6" style={{ borderColor: "var(--color-line)" }}>
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-xl sm:text-2xl tracking-tighter leading-none">
            Derin Analiz
          </h1>
        </div>
        {!needsTwoUnis && (
          <p className="mt-3 text-sm">
            <strong>{slugs.length}</strong> üniversite seçili: {selectedNames.join(", ") || "—"}
          </p>
        )}
      </header>

      {summaryError && !needsTwoUnis && (
        <div
          className="border-l-2 pl-4 py-3 text-sm italic font-serif text-[color:var(--color-ink-700)]"
          style={{ borderColor: "var(--color-ink-700)" }}
        >
          Üniversite bilgisi alınamadı. Backend kapalı olabilir veya seçili
          slug ({a} / {b}) geçersiz — ana sayfadan başka bir üniversite seç.
        </div>
      )}

      <Section label="3.1" title="Haftalık Konular">
        {isEmpty ? (
          <DeepEmptyHint />
        ) : (
          <div className="space-y-8">
            {slugs.map((slug, idx) => (
              <PerUniBlock
                key={slug}
                slug={slug}
                slotIndex={idx}
                fallbackName={slugToName.get(slug) || slug}
                data={fullBySlug?.[slug]}
              >
                <WeeklyTopicsSingleUni
                  data={fullBySlug?.[slug]}
                  loading={fullLoading}
                />
              </PerUniBlock>
            ))}
            {slugs.length >= 2 && (
              <div
                className="pt-6 border-t"
                style={{ borderColor: "var(--color-line)" }}
              >
                <h3 className="font-serif text-base font-medium leading-tight mb-1">
                  Eşleşme
                </h3>
                <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] mb-4">
                  Üst üniversiteler arasında semantik (NLP) en benzer ders
                  çiftleri.
                </p>
                <CurriculumCoverageHeatmap
                  data={curriculum}
                  loading={curriculumLoading}
                />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        label="3.2"
        title="Önkoşul Ağı"
        caption="Hangi dersin neye bağımlı olduğu — köklerden yukarı doğru. Bir derse tıkla, alt zinciri vurgulanır."
      >
        {isEmpty ? (
          <DeepEmptyHint />
        ) : (
          <PrereqGraph data={prereq} loading={prereqLoading} />
        )}
      </Section>

      <Section label="3.3" title="Ders Kaynakları">
        {isEmpty ? (
          <DeepEmptyHint />
        ) : (
          <div className="space-y-8">
            {slugs.map((slug, idx) => (
              <PerUniBlock
                key={slug}
                slug={slug}
                slotIndex={idx}
                fallbackName={slugToName.get(slug) || slug}
                data={resourcesBySlug?.[slug]?.university}
              >
                <ResourcesSingleUni
                  data={resourcesBySlug?.[slug]}
                  loading={resourcesBySlugLoading}
                />
              </PerUniBlock>
            ))}
            {slugs.length >= 2 && (
              <div
                className="pt-6 border-t"
                style={{ borderColor: "var(--color-line)" }}
              >
                <h3 className="font-serif text-base font-medium leading-tight mb-1">
                  Ortak Kaynaklar
                </h3>
                <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] mb-4">
                  Üst üniversitelerin de okuttuğu kitap, makale ve kaynaklar.
                </p>
                <ResourcesTable data={resources} loading={resourcesLoading} />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section label="3.4" title="Ders Benzerliği">
        <CourseSimilarity />
      </Section>
    </section>
  );
}

/**
 * Tek bir üniversitenin başlığını ve içeriğini wrap eder. Çok-üni
 * görünümünde her uni için tekrar render edilir; başlıkta uni rengi
 * (a/b/c) + tam ad belirir.
 */
function PerUniBlock({
  slug,
  slotIndex,
  fallbackName,
  data,
  children,
}: {
  slug: string;
  slotIndex: number;
  fallbackName: string;
  /** name alanı içeren herhangi bir obje; {name} (resources.university)
   * veya UniversityFull. Çıkarsanan ismi başlıkta gösterir. */
  data?: { name?: string; university_name?: string } | undefined;
  children: React.ReactNode;
}) {
  const accent =
    ["var(--color-uni-a)", "var(--color-uni-b)", "var(--color-uni-c)"][slotIndex] ||
    "var(--color-ink-700)";
  const resolvedName: string =
    data?.name || data?.university_name || fallbackName || slug;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span
          aria-hidden
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="font-serif text-base font-medium leading-tight">
          {resolvedName}
        </h3>
      </div>
      {children}
    </div>
  );
}

function DeepEmptyHint({ message }: { message?: string }) {
  return (
    <div
      className="border border-dashed rounded p-6 text-center"
      style={{ borderColor: "var(--color-line)" }}
    >
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)] leading-relaxed">
        {message || "Üniversite seç."}
      </p>
    </div>
  );
}
