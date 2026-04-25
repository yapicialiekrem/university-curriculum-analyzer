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
    course_type: Optional[CourseTypeFilter] = None
    language: Optional[LanguageFilter] = None


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
    "resources_donut",     # Bileşen 2.6 — kaynak dili
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


class ChatResponse(BaseModel):
    """/api/chat endpoint cevabı."""
    model_config = ConfigDict(extra="ignore")

    text: str
    citations: list[Citation] = Field(default_factory=list)
    dashboard_update: Optional[DashboardUpdate] = None
    follow_up_suggestions: list[str] = Field(default_factory=list)

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

class ChatRequest(BaseModel):
    """POST /api/chat body."""
    model_config = ConfigDict(extra="ignore")

    question: str = Field(..., min_length=3, max_length=500)
    session_id: Optional[str] = None   # v2'de kullanılacak; şimdilik yok
