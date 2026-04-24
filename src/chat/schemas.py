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


DashboardChart = Literal[
    "category_distribution",
    "semester_distribution",
    "workload_comparison",
    "staff_comparison",
    "language_distribution",
]


class DashboardUpdate(BaseModel):
    """Frontend dashboard'una yansıtılacak görsel güncellemeler."""
    model_config = ConfigDict(extra="ignore")

    highlight_courses: list[str] = Field(default_factory=list)
    show_chart: Optional[DashboardChart] = None
    filter: dict[str, Any] = Field(default_factory=dict)
    universities_focus: list[str] = Field(default_factory=list)

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

    @field_validator("filter", mode="before")
    @classmethod
    def _coerce_filter(cls, v: Any) -> dict[str, Any]:
        # LLM bazen `filter: null` döndürüyor — default'a düşelim
        if v is None:
            return {}
        if not isinstance(v, dict):
            return {}
        return v


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
