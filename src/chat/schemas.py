"""
schemas.py — Chat pipeline Pydantic modelleri.

Router çıktısı, context yapısı, final ChatResponse burada tanımlanır.
LLM cevaplarını doğrulamak ve FastAPI request/response modeli olarak
kullanmak için hem input hem de output şemaları tek dosyada.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ═══════════════════════════════════════════════════════════════════════════
# INTENT — Router çıktısı
# ═══════════════════════════════════════════════════════════════════════════

IntentType = Literal[
    "deterministic",   # sayısal / filtrelenebilir
    "comparison",      # iki+ üniversite karşılaştırma
    "semantic",        # konu/kategori bazlı arama
    "detail",          # tek ders / üniversite detayı
    "general",         # sistem hakkında genel
    "advisory",        # tavsiye / yönlendirme — kullanıcı profili + hedef
    "aggregate",       # tüm üniversiteler arasında "en çok / en az / sıralama"
    "complex",         # multi-step / kompozisyon (oranlar, kombinatör) — tools loop
]


# Aggregate intent için metrik anahtarları — context builder bunlara bakıp
# enrichment store'dan değer çeker. Her metrik tek sayıdır per üniversite.
AggregateMetric = Literal[
    # Akademik kadro
    "staff.professor",
    "staff.associate_professor",
    "staff.assistant_professor",
    "staff.lecturer",
    "staff.research_assistant",
    "staff.total",
    # Müfredat genel
    "summary.total_courses",
    "summary.modernity_score",
    "summary.english_resources_ratio",
    "summary.project_heavy_course_count",
    "summary.total_project_ects",
    # Uzmanlaşma — hedef kategori AKTS / ders sayısı
    "spec.ai_ml.ects",
    "spec.ai_ml.courses",
    "spec.programming.ects",
    "spec.programming.courses",
    "spec.math.ects",
    "spec.math.courses",
    "spec.systems.ects",
    "spec.systems.courses",
    "spec.theory.ects",
    "spec.theory.courses",
    "spec.data_science.ects",
    "spec.data_science.courses",
    "spec.security.ects",
    "spec.security.courses",
    "spec.web_mobile.ects",
    "spec.web_mobile.courses",
    "spec.software_eng.ects",
    "spec.software_eng.courses",
    "spec.graphics_vision.ects",
    "spec.graphics_vision.courses",
    "spec.distributed.ects",
    "spec.distributed.courses",
    "spec.info_systems.ects",
    "spec.info_systems.courses",
    # YKS sıralama (en düşük sıra = en seçici)
    "ranking.basari_sirasi",
    "ranking.yerlesen_sayisi",
    # Önkoşul yoğunluğu
    "courses_with_prereqs",
    # Bloom (LLM-enriched öğrenme çıktıları, 6 seviye yüzdesi)
    "bloom.remember.pct",
    "bloom.understand.pct",
    "bloom.apply.pct",
    "bloom.analyze.pct",
    "bloom.evaluate.pct",
    "bloom.create.pct",
    # Kaynaklar
    "resources.unique_count",
    # Dil
    "language.english_courses",
    "language.turkish_courses",
]


# Enrichment'tan gelen kategori anahtarları — advisory hedef alanları için.
# CategoryFilter (router) ile karışmasın diye ayrı tutuldu (router daha kısa
# bir set kullanıyor: ai/programming/math/systems/theory).
GoalCategoryKey = Literal[
    "ai_ml", "programming", "math", "systems", "theory",
    "data_science", "security", "web_mobile", "software_eng",
    "graphics_vision", "distributed", "info_systems",
]

ComparisonMetric = Literal[
    "courses", "staff", "workload", "program-outcomes",
    "learning-outcomes", "curriculum-coverage", "prerequisites",
    "semester-distribution", "mandatory-elective",
    "language-distribution", "resources",
]

CategoryFilter = Literal[
    "ai", "programming", "math", "systems", "theory",
]

CourseTypeFilter = Literal["zorunlu", "secmeli"]

LanguageFilter = Literal["tr", "en"]


class IntentFilters(BaseModel):
    """Opsiyonel filtreler — router doldurmasa bile boş obje döner."""
    model_config = ConfigDict(extra="ignore")

    category: Optional[CategoryFilter] = None
    semester: Optional[int] = Field(None, ge=1, le=8)
    year: Optional[int] = Field(None, ge=1, le=4)  # 1-4 sınıf
    course_type: Optional[CourseTypeFilter] = None
    language: Optional[LanguageFilter] = None
    uni_type: Optional[Literal["devlet", "özel"]] = None
    department: Optional[Literal["bilmuh", "yazmuh", "ybs"]] = None


class Intent(BaseModel):
    """Router'ın sınıflandırma çıktısı — context builder bunu tüketir."""
    model_config = ConfigDict(extra="ignore")

    type: IntentType = "general"
    universities: list[str] = Field(default_factory=list)
    metric: Optional[ComparisonMetric] = None
    filters: IntentFilters = Field(default_factory=IntentFilters)
    needs_embedding: bool = False
    top_k: int = Field(10, ge=1, le=50)
    semantic_query: Optional[str] = None
    # Advisory için — tavsiyenin temel parametreleri. Diğer intent türlerinde
    # boş kalır; router prompt'undan gelir veya ChatRequest'ten override edilir.
    goal_categories: list[GoalCategoryKey] = Field(default_factory=list)
    user_rank: Optional[int] = Field(None, ge=1, le=2_000_000)
    # Aggregate intent — "en çok prof olan üni", "en yüksek AKTS'li ders" gibi
    # cross-üniversite sıralama soruları için.
    aggregate_metric: Optional[AggregateMetric] = None
    aggregate_order: Literal["desc", "asc"] = "desc"
    aggregate_top_n: int = Field(5, ge=1, le=20)
    aggregate_department: Optional[Literal["bilmuh", "yazmuh", "ybs"]] = None

    @field_validator("universities", mode="before")
    @classmethod
    def _normalize_unis(cls, v: Any) -> list[str]:
        """None → []; string → [string]; listede None/boş'u at."""
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        return [str(x).strip().lower() for x in v if x and str(x).strip()]

    @field_validator("goal_categories", mode="before")
    @classmethod
    def _normalize_goals(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        return [str(x).strip().lower() for x in v if x and str(x).strip()]


# ═══════════════════════════════════════════════════════════════════════════
# CHAT RESPONSE — /api/chat cevabı
# ═══════════════════════════════════════════════════════════════════════════

class Citation(BaseModel):
    """Cevapta referans verilen bir ders."""
    model_config = ConfigDict(extra="ignore")

    code: str
    name: Optional[str] = None
    url: Optional[str] = None
    university: Optional[str] = None


# Dashboard'da overlay için tetiklenecek bileşen.
# BACKEND_PROMPT (2).md FAZ 3 — yeni enum (frontend'de Katman 1-2 bileşenleriyle
# birebir uyumlu). Eski `category_distribution` vs. yerine doğrudan bileşen
# isimleri.
DashboardMetric = Literal[
    "category_radar",      # Bileşen 1.1 — radar grafiği
    "semester_heatmap",    # Bileşen 2.1 — dönem×kategori heatmap
    "bloom_donut",         # Bileşen 2.3 — Bloom donut
    "staff_bars",          # Bileşen 2.5 — kadro barları
    "coverage_table",      # Bileşen 2.2 — kapsam tablosu
    "project_heaviness",   # _summary.project_heavy_course_count vurgusu
]


class DashboardUpdate(BaseModel):
    """Frontend dashboard'una yansıtılacak görsel güncellemeler.

    LLM'den gelen yapı (ANSWER_PROMPT şablonu):
      {
        "show_metric": "category_radar",
        "highlight_category": "ai_ml",
        "highlight_courses": ["CENG499","CS440"],
        "universities_focus": ["metu","ege"],
        "overlay_data": {"metu": "13 AI dersi, 48 AKTS", ...}
      }
    """
    model_config = ConfigDict(extra="ignore")

    show_metric: Optional[DashboardMetric] = None
    highlight_category: Optional[str] = None      # 13 enrichment kategorisinden biri
    highlight_courses: list[str] = Field(default_factory=list)
    universities_focus: list[str] = Field(default_factory=list)
    overlay_data: dict[str, str] = Field(default_factory=dict)
    # Geriye dönük uyumluluk: eski şemada `filter` ve `show_chart` vardı.
    # LLM bazen hâlâ üretebilir; sessizce yutup yeni alana köprü kuruyoruz.

    @field_validator("highlight_courses", "universities_focus", mode="before")
    @classmethod
    def _coerce_list(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        return [str(x).strip() for x in v if x and str(x).strip()]

    @field_validator("overlay_data", mode="before")
    @classmethod
    def _coerce_overlay(cls, v: Any) -> dict[str, str]:
        if v is None:
            return {}
        if not isinstance(v, dict):
            return {}
        # Tüm value'ları string'e çevir
        return {str(k): str(val) for k, val in v.items() if val is not None}


class RecommendationCandidate(BaseModel):
    """Tek bir tavsiye adayı — bir üniversite + uyum skoru + nedenler."""
    model_config = ConfigDict(extra="ignore")

    slug: str
    name: str
    fit_score: int = Field(ge=0, le=100)
    reasons: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    """Advisory cevabında structured tavsiye çıktısı.

    Frontend bu alanı algılar → "Öneri kartı" render eder; LLM'in serbest
    metni `text` alanında, makinece okunabilir öneri burada.
    """
    model_config = ConfigDict(extra="ignore")

    top_pick: Optional[str] = None             # en iyi adayın slug'ı
    ranked: list[RecommendationCandidate] = Field(default_factory=list)
    rationale: Optional[str] = None            # 1-2 cümle özet


class ChatResponse(BaseModel):
    """/api/chat endpoint cevabı."""
    model_config = ConfigDict(extra="ignore")

    text: str
    citations: list[Citation] = Field(default_factory=list)
    dashboard_update: Optional[DashboardUpdate] = None
    follow_up_suggestions: list[str] = Field(default_factory=list)
    # Advisory intent için yapılandırılmış öneri. Diğer intent türlerinde
    # null kalır; frontend null ise prose-only render eder.
    recommendation: Optional[Recommendation] = None

    @field_validator("follow_up_suggestions", mode="before")
    @classmethod
    def _coerce_suggestions(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        return [str(x).strip() for x in v if x and str(x).strip()]


# ═══════════════════════════════════════════════════════════════════════════
# REQUEST MODEL — /api/chat POST body
# ═══════════════════════════════════════════════════════════════════════════

class ChatHistoryTurn(BaseModel):
    """Konuşma geçmişinde tek bir tur (user veya assistant)."""
    model_config = ConfigDict(extra="ignore")

    role: Literal["user", "assistant"]
    text: str = Field(..., max_length=2000)


class ChatRequest(BaseModel):
    """POST /api/chat body.

    Frontend'den gelen kullanıcı bağlamı opsiyoneldir; doldurulduğunda
    advisory intent için somut tavsiye üretilebilir:
      - selected_slugs: kullanıcının dashboard'da seçili olduğu üniversiteler
      - user_rank: opsiyonel YKS sıralaması (advisory için filtre)
      - goal: serbest metin "AI uzmanlaşmak istiyorum" gibi (router parser)
      - history: önceki konuşma turları (multi-turn dialog için).
        En fazla 6 turn (3 user + 3 assistant); fazlası kesilir.
    """
    model_config = ConfigDict(extra="ignore")

    question: str = Field(..., min_length=3, max_length=500)
    session_id: Optional[str] = None
    selected_slugs: list[str] = Field(default_factory=list, max_length=3)
    user_rank: Optional[int] = Field(None, ge=1, le=2_000_000)
    goal: Optional[str] = Field(None, max_length=200)
    history: list[ChatHistoryTurn] = Field(default_factory=list, max_length=6)

    @field_validator("selected_slugs", mode="before")
    @classmethod
    def _normalize_slugs(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        return [str(x).strip().lower() for x in v if x and str(x).strip()]
