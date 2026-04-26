"""
compare_enriched.py — Enrichment-bazlı karşılaştırma endpoint'leri.

Dashboard Katman 1-2 bileşenlerini besler:
  /api/compare/radar              → Bileşen 1.1 (10 eksen radar)
  /api/compare/coverage           → Bileşen 2.2 (kapsam tablosu)
  /api/compare/bloom              → Bileşen 2.3 (Bloom donut)
  /api/compare/semester-heatmap   → Bileşen 2.1 (dönem×kategori)

Mevcut /api/compare/* (Neo4j-bazlı) ile YAN YANA çalışır — çakışma yok.
Mevcut: courses, staff, workload, program-outcomes, learning-outcomes,
        curriculum-coverage, prerequisites, semester-distribution,
        mandatory-elective, language-distribution, resources, composite

Yeni: radar, coverage, bloom, semester-heatmap (bunlar enrichment kaynaklı)
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from analytics import bloom, coverage, heatmap, radar
from analytics.loader import get_store


router = APIRouter(prefix="/api/compare", tags=["Comparison — Enriched"])


# ─── Slug doğrulama ──────────────────────────────────────────────────

def _resolve_slugs(a: str, b: Optional[str] = None, c: Optional[str] = None) -> list[str]:
    """Query parametrelerinden slug listesi + varlık kontrolü.

    Args:
        a: Üniversite A slug'ı (zorunlu)
        b: Üniversite B slug'ı (zorunlu)
        c: Üniversite C slug'ı (opsiyonel, 3'lü karşılaştırma için)

    Returns:
        Geçerli ve farklı slug'lar.

    Raises:
        HTTPException 400: slug duplike veya boş
        HTTPException 404: bulunamayan slug
    """
    slugs: list[str] = [s for s in [a, b, c] if s]
    if len(set(slugs)) != len(slugs):
        raise HTTPException(
            status_code=400,
            detail="Aynı üniversite birden fazla seçilemez",
        )
    store = get_store()
    missing = [s for s in slugs if store.get(s) is None]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Üniversite bulunamadı: {missing}",
        )
    return slugs


# ─── Endpoint'ler ────────────────────────────────────────────────────

@router.get(
    "/radar",
    summary="📊 10 eksen kapsam radar (Dashboard Bileşen 1.1)",
    description=(
        "Her eksende, üniversitenin ilgili kategorideki toplam ECTS'inin "
        "TÜM ÜNİVERSİTELERDEKİ MAKSIMUM'a oranı (0-100). "
        "Eksenler: math, programming, systems, ai_ml, data_science, security, "
        "web_mobile, software_eng, graphics_vision, distributed."
    ),
)
def get_radar(
    a: str = Query(..., description="Üniversite A slug"),
    b: Optional[str] = Query(None, description="Üniversite B slug (opsiyonel — tek-uni radar)"),
    c: Optional[str] = Query(None, description="Üniversite C slug (opsiyonel)"),
) -> dict:
    return radar.compute_radar(_resolve_slugs(a, b, c))


@router.get(
    "/coverage",
    summary="📚 Kategori bazlı ortak/ayrı konu haritası (Bileşen 2.2)",
    description=(
        "Seçili üniversitelerin haftalık konularını kategori bazında karşılaştırır. "
        "`shared_topics`: birden fazla üni'de bulunan konular. "
        "`unique_topics`: sadece tek bir üni'ye özgü konular. "
        "Opsiyonel `categories` parametresi ile filtreleme yapılabilir."
    ),
)
def get_coverage(
    a: str = Query(..., description="Üniversite A slug"),
    b: str = Query(..., description="Üniversite B slug"),
    c: Optional[str] = Query(None, description="Üniversite C slug (opsiyonel)"),
    categories: Optional[str] = Query(
        None,
        description="Virgülle ayrılmış kategori filtresi (örn: ai_ml,security)",
    ),
) -> dict:
    cat_list = (
        [s.strip() for s in categories.split(",") if s.strip()]
        if categories else None
    )
    return coverage.compute_coverage(_resolve_slugs(a, b, c), cat_list)


@router.get(
    "/bloom",
    summary="🧠 Bloom taksonomisi donut grafiği (Bileşen 2.3)",
    description=(
        "Her üniversite için ECTS-ağırlıklı Bloom seviye dağılımı: "
        "remember, understand, apply, analyze, evaluate, create. "
        "`dominant`: en yüksek seviye."
    ),
)
def get_bloom(
    a: str = Query(..., description="Üniversite A slug"),
    b: Optional[str] = Query(None, description="Üniversite B slug (opsiyonel — tek-uni)"),
    c: Optional[str] = Query(None, description="Üniversite C slug (opsiyonel)"),
) -> dict:
    return bloom.compute_bloom(_resolve_slugs(a, b, c))


@router.get(
    "/semester-heatmap",
    summary="🗓️ Dönem × Kategori ECTS heatmap (Bileşen 2.1)",
    description=(
        "Her üniversite için: 8 dönem × 10 kategori matrisi. "
        "Hücre değeri = o dönem o kategoride toplam ECTS. "
        "{zorunlu, secmeli} ayrımı tutulur (frontend solid vs pattern fill)."
    ),
)
def get_semester_heatmap(
    a: str = Query(..., description="Üniversite A slug"),
    b: Optional[str] = Query(None, description="Üniversite B slug (opsiyonel — tek-uni)"),
    c: Optional[str] = Query(None, description="Üniversite C slug (opsiyonel)"),
) -> dict:
    return heatmap.compute_semester_heatmap(_resolve_slugs(a, b, c))
