/**
 * Backend API client — basit fetch wrapper + SWR uyumlu fetcher.
 *
 * SWR `fetcher` olarak `apiGet`'i kullanırız:
 *   const { data, error } = useSWR<RadarResponse>(
 *     `/api/compare/radar?a=${a}&b=${b}`, apiGet
 *   );
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

function url(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path.startsWith("/") ? path : "/" + path}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(url(path), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, `GET ${path} → ${res.status}`, body);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let respBody: unknown = undefined;
    try {
      respBody = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, `POST ${path} → ${res.status}`, respBody);
  }
  return (await res.json()) as T;
}

// ─── Convenience ─────────────────────────────────────────────────

export const api = {
  universities: (department?: string) =>
    apiGet<import("./types").UniversityListItem[]>(
      department ? `/api/universities?department=${department}` : "/api/universities"
    ),

  universitySummary: (slug: string) =>
    apiGet<import("./types").UniversitySummary>(
      `/api/universities/${encodeURIComponent(slug)}/summary`
    ),

  compareRadar: (a: string, b?: string, c?: string) =>
    apiGet<import("./types").RadarResponse>(
      `/api/compare/radar?a=${a}${b ? `&b=${b}` : ""}${c ? `&c=${c}` : ""}`
    ),

  compareBloom: (a: string, b?: string, c?: string) =>
    apiGet<import("./types").BloomResponse>(
      `/api/compare/bloom?a=${a}${b ? `&b=${b}` : ""}${c ? `&c=${c}` : ""}`
    ),

  compareCoverage: (a: string, b: string, opts: { c?: string; categories?: string[] } = {}) => {
    const qs = new URLSearchParams({ a, b });
    if (opts.c) qs.set("c", opts.c);
    if (opts.categories?.length) qs.set("categories", opts.categories.join(","));
    return apiGet<import("./types").CoverageResponse>(
      `/api/compare/coverage?${qs}`
    );
  },

  compareHeatmap: (a: string, b?: string, c?: string) =>
    apiGet<import("./types").HeatmapResponse>(
      `/api/compare/semester-heatmap?a=${a}${b ? `&b=${b}` : ""}${c ? `&c=${c}` : ""}`
    ),

  // Neo4j-bazlı eski endpoint'ler — uni adıyla çağrılır (slug değil)
  compareStaff: (uni1: string, uni2: string) =>
    apiGet<import("./types").StaffComparison>(
      `/api/compare/staff?uni1=${encodeURIComponent(uni1)}&uni2=${encodeURIComponent(uni2)}`
    ),

  compareProgramOutcomes: (
    uni1: string,
    uni2: string,
    top_n: number = 8,
    department?: string,
  ) =>
    apiGet<import("./types").ProgramOutcomesResponse>(
      `/api/compare/program-outcomes?uni1=${encodeURIComponent(uni1)}&uni2=${encodeURIComponent(uni2)}&top_n=${top_n}${department ? `&department=${encodeURIComponent(department)}` : ""}`
    ),

  compareCurriculumCoverage: (uni1: string, uni2: string, top_n: number = 20) =>
    apiGet<import("./types").CurriculumCoverageResponse>(
      `/api/compare/curriculum-coverage?uni1=${encodeURIComponent(uni1)}&uni2=${encodeURIComponent(uni2)}&top_n=${top_n}`
    ),

  comparePrerequisites: (uni1: string, uni2: string) =>
    apiGet<import("./types").PrerequisitesResponse>(
      `/api/compare/prerequisites?uni1=${encodeURIComponent(uni1)}&uni2=${encodeURIComponent(uni2)}`
    ),

  compareResources: (uni1: string, uni2: string) =>
    apiGet<import("./types").ResourcesResponse>(
      `/api/compare/resources?uni1=${encodeURIComponent(uni1)}&uni2=${encodeURIComponent(uni2)}`
    ),

  chat: (
    question: string,
    opts: {
      selectedSlugs?: string[];
      userRank?: number;
      goal?: string;
      history?: Array<{ role: "user" | "assistant"; text: string }>;
    } = {}
  ) =>
    apiPost<import("./types").ChatResponse>("/api/chat", {
      question,
      selected_slugs: opts.selectedSlugs ?? undefined,
      user_rank: opts.userRank ?? undefined,
      goal: opts.goal ?? undefined,
      history: opts.history ?? undefined,
    }),

  search: (query: string, opts: { top_k?: number; universities?: string[]; min_score?: number } = {}) =>
    apiPost<import("./types").SearchResponse>(
      "/api/search",
      {
        query,
        top_k: opts.top_k ?? 10,
        universities: opts.universities ?? null,
        min_score: opts.min_score ?? 0.3,
      }
    ),
};
