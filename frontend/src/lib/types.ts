/**
 * Backend API tipleri — `src/api/*.py` ile birebir uyumlu.
 *
 * Her endpoint'in döndürdüğü şeyi olduğu gibi typeladık. Frontend bu
 * tipler üzerinden çalışır, backend'le tek senkron noktası burası.
 */

export type DepartmentCode = "bilmuh" | "yazmuh" | "ybs" | "other";

export type CategoryKey =
  | "math"
  | "programming"
  | "systems"
  | "ai_ml"
  | "data_science"
  | "security"
  | "web_mobile"
  | "software_eng"
  | "graphics_vision"
  | "distributed"
  | "theory"
  | "info_systems"
  | "not_cs";

export type BloomLevel =
  | "remember" | "understand" | "apply"
  | "analyze"  | "evaluate"   | "create";

// ─── /api/universities ──────────────────────────────────────────────

export interface UniversityListItem {
  slug: string;
  name: string;
  department: string | null;
  department_code: DepartmentCode;
  language: string | null;
  type: string | null;
  department_url: string | null;
  total_courses: number;
  enriched_courses: number;
  modernity_score: number | null;
}

// ─── /api/universities/{slug}/summary ───────────────────────────────

export interface CategoryCoverageEntry {
  courses: number;
  total_ects: number;
  required_ects: number;
}

export interface SpecializationDepth {
  required: number;        // ders sayısı
  elective: number;        // ders sayısı
  total: number;           // toplam ders sayısı
  required_ects?: number;  // zorunlu derslerin AKTS toplamı (API on-the-fly)
  elective_ects?: number;  // seçmeli derslerin AKTS toplamı (API on-the-fly)
}

export interface UniversitySummary {
  slug: string;
  name: string;
  department: string | null;
  department_code: DepartmentCode;
  language: string | null;
  type: string | null;
  total_courses: number;
  enriched_courses: number;
  unenrichable_courses: number;
  category_coverage: Partial<Record<CategoryKey, CategoryCoverageEntry>>;
  modernity_score: number | null;
  specialization_depth: Partial<Record<CategoryKey, SpecializationDepth>>;
  earliest_technical_elective_semester: number | null;
  project_heavy_course_count: number;
  total_project_ects: number;
  english_resources_ratio: number;
  /** YKS başarı sırası (en iyi program). Yoksa null. */
  ranking_sira: number | null;
  /** YKS yerleşen sayısı (kontenjan dolumu, en iyi program için). Yoksa null. */
  ranking_kontenjan: number | null;
  /** Program (mezuniyet) çıktıları — tek-uni görünümünde listelenir. */
  program_outcomes?: string[];
}

// ─── /api/compare/radar ─────────────────────────────────────────────

export interface RadarAxis {
  key: CategoryKey;
  label: string;
}

export interface RadarSeries {
  slug: string;
  name: string;
  department: DepartmentCode;
  values: number[];     // 0-100, her eksen için
  raw_ects: number[];   // ham ECTS
}

export interface RadarResponse {
  axes: RadarAxis[];
  series: RadarSeries[];
  global_max_ects: Record<string, number>;
  not_found?: string[];
}

// ─── /api/compare/bloom ─────────────────────────────────────────────

export interface BloomSeries {
  slug: string;
  name: string;
  department: DepartmentCode;
  distribution: Record<BloomLevel, number>;
  dominant: BloomLevel;
  based_on_courses: number;
}

export interface BloomResponse {
  levels: BloomLevel[];
  series: BloomSeries[];
}

// ─── /api/compare/coverage ──────────────────────────────────────────

export interface CoverageUniversityInfo {
  name: string;
  department: DepartmentCode;
  course_count: number;
  ects: number;
  topics: string[];
}

export interface CoverageCategoryEntry {
  universities: Record<string, CoverageUniversityInfo>;
  shared_topics: string[];
  unique_topics: Record<string, string[]>;
}

export interface CoverageResponse {
  by_category: Partial<Record<CategoryKey, CoverageCategoryEntry>>;
}

// ─── /api/compare/semester-heatmap ──────────────────────────────────

export interface HeatmapMatrixCell {
  zorunlu: number;
  secmeli: number;
}

export interface HeatmapSeries {
  slug: string;
  name: string;
  department: DepartmentCode;
  matrix: Partial<Record<CategoryKey, Record<string, HeatmapMatrixCell>>>;
}

export interface HeatmapResponse {
  categories: RadarAxis[];
  semesters: number[];
  series: HeatmapSeries[];
}

// ─── /api/compare/staff (Neo4j) ─────────────────────────────────────

export interface StaffCounts {
  department: string;
  professor: number;
  associate_professor: number;
  assistant_professor: number;
  lecturer: number;
  research_assistant: number;
  total: number;
}

// Backend iki farklı şemada dönebiliyor: nested (`university1.staff.professor`)
// veya flat (`university1.professor`). Frontend her ikisine de tolerans
// göstermek için optional union kabul eder.
export interface StaffComparison {
  university1: {
    name: string;
    department?: string;
    staff?: StaffCounts;
  } & Partial<StaffCounts>;
  university2: {
    name: string;
    department?: string;
    staff?: StaffCounts;
  } & Partial<StaffCounts>;
}

// ─── /api/compare/program-outcomes (Neo4j semantic) ─────────────────

export interface OutcomePair {
  outcome1: { index: number; text: string };
  outcome2: { index: number; text: string };
  similarity: number;
}

export interface ProgramOutcomesResponse {
  // Backend bazen string slug bazen { name, outcome_count } döndürebiliyor.
  university1: string | { name: string; outcome_count: number };
  university2: string | { name: string; outcome_count: number };
  // Tip uyumluluğu için her iki şema da kabul edilir.
  similar_pairs?: OutcomePair[];
  top_matches?: Array<{
    outcome1_index: number;
    outcome1_text: string;
    outcome2_index: number;
    outcome2_text: string;
    similarity_pct: number;
  }>;
  avg_similarity?: number;
  outcome_count1?: number;
  outcome_count2?: number;
  overall_similarity_pct?: number;
  // v3: tüm program çıktısı metinleri (eşleşmemiş olanlar dahil)
  outcomes1?: Array<{ index: number; text: string }>;
  outcomes2?: Array<{ index: number; text: string }>;
}

// ─── /api/compare/curriculum-coverage (Neo4j semantic) ──────────────

export interface TopicPair {
  topic1: { code: string; topic: string };
  topic2: { code: string; topic: string };
  similarity: number;
}

export interface CurriculumCoverageResponse {
  university1: { name: string; total_topics: number };
  university2: { name: string; total_topics: number };
  similar_topics: TopicPair[];
  unique_to_uni1?: Array<{ code: string; topic: string }>;
  unique_to_uni2?: Array<{ code: string; topic: string }>;
}

// ─── /api/compare/prerequisites (Neo4j) ─────────────────────────────

export interface PrereqEdge {
  course: string;
  prerequisite: string;
}

export interface PrereqStats {
  course_count: number;
  with_prereqs: number;
  edges: PrereqEdge[];
  avg_depth?: number;
  max_depth?: number;
}

export interface PrerequisitesResponse {
  university1: PrereqStats & { name: string };
  university2: PrereqStats & { name: string };
}

// ─── /api/compare/resources (Neo4j) ─────────────────────────────────

export interface SharedResource {
  resource: string;
  uni1_courses: string[];
  uni2_courses: string[];
}

export interface ResourcesResponse {
  university1: { name: string; total_resources: number };
  university2: { name: string; total_resources: number };
  shared_resources: SharedResource[];
  jaccard_similarity?: number;
}

// ─── /api/search ───────────────────────────────────────────────────

export interface SearchResult {
  score: number;
  course_id: number;
  university: string;
  university_slug: string;
  department_code: DepartmentCode;
  code: string;
  name: string;
  semester: number | null;
  type: string | null;
  language: string | null;
  categories: string[];
  primary_category: string | null;
  modernity_score: number | null;
  url: string | null;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
}

// ─── Chat ───────────────────────────────────────────────────────────

export type DashboardMetric =
  | "category_radar"
  | "semester_heatmap"
  | "bloom_donut"
  | "staff_bars"
  | "coverage_table"
  | "project_heaviness";

export interface DashboardUpdate {
  show_metric?: DashboardMetric | null;
  highlight_category?: string | null;
  highlight_courses?: string[];
  universities_focus?: string[];
  overlay_data?: Record<string, string>;
}

export interface RecommendationCandidate {
  slug: string;
  name: string;
  fit_score: number;
  reasons: string[];
}

export interface Recommendation {
  top_pick: string | null;
  ranked: RecommendationCandidate[];
  rationale: string | null;
}

export interface AggregateRow {
  slug: string;
  name: string;
  department: string | null;
  department_code: string | null;
  value: number;
}

export interface AggregateResult {
  metric: string;
  metric_label: string;
  order: "asc" | "desc";
  ranked: AggregateRow[];
}

export interface Citation {
  code: string;
  name?: string | null;
  url?: string | null;
  university?: string | null;
}

export interface ChatResponse {
  text: string;
  citations: Citation[];
  dashboard_update: DashboardUpdate | null;
  follow_up_suggestions: string[];
  /** Advisory intent için yapılandırılmış öneri (varsa frontend kart render eder). */
  recommendation?: Recommendation | null;
  /** Aggregate intent için ham sıralama verisi (mini bar chart için). */
  aggregate?: AggregateResult | null;
  meta?: {
    intent_type: string;
    universities_found: string[];
    needs_embedding: boolean;
    latency_ms: number;
    llm: {
      provider: string | null;
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      cost_usd: number;
      status: string;
    };
  };
}
