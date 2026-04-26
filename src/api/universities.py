"""
universities.py — Üniversite liste/detay/summary endpoint'leri.

Dashboard'un üniversite seçicisi + kart içeriği bunu kullanır.
EnrichmentStore'dan (analytics/loader.py) okur, Neo4j'ye gitmez.

Mevcut main.py'deki /api/universities endpoint'iyle YERINI ALIR.
Eski endpoint sadece {name, type, language} döndürüyordu; yenisi slug,
modernity_score, enriched_courses gibi zenginlik içeriyor (superset).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

# Mevcut flat-import örüntüsü (main.py `from comparison import ...` gibi)
from analytics.loader import VALID_DEPARTMENTS, get_store
from api.ranking import get_ranking


router = APIRouter(prefix="/api/universities", tags=["Universities"])


# ─── Yardımcılar ──────────────────────────────────────────────────────

def _name(uni: dict) -> str:
    """Eski/yeni JSON şemalarında ad alanı `university_name` veya
    `uni_name`; her durumda doğru olanı döndür."""
    return uni.get("university_name") or uni.get("uni_name") or uni.get("_slug", "")


def _ranking_view(slug: str, uni: dict) -> dict | None:
    """Üniversitenin YKS sıralama + kontenjanını döndür (yoksa None)."""
    return get_ranking(
        slug=slug,
        department=uni.get("_department"),
        university_name=_name(uni),
    )


def _compute_specialization_ects(uni: dict) -> dict[str, dict[str, int]]:
    """Her kategori için zorunlu / seçmeli AKTS toplamı.

    Kaynak: her dersin `_enriched.categories` listesi + `type` + `ects`.
    Aggregator zaten ders sayısı (`required` / `elective`) hesaplıyor; biz
    de aynı kategori atamalarına göre AKTS toplamı çıkarıp endpoint'te
    `specialization_depth` içine `required_ects` / `elective_ects` ekliyoruz.
    """
    out: dict[str, dict[str, int]] = {}
    for c in uni.get("courses") or []:
        enriched = c.get("_enriched") or {}
        cats = enriched.get("categories") or []
        if not cats:
            continue
        try:
            ects = int(c.get("ects") or 0)
        except (TypeError, ValueError):
            ects = 0
        ctype = c.get("type")
        for cat in cats:
            entry = out.setdefault(cat, {"required_ects": 0, "elective_ects": 0})
            if ctype == "zorunlu":
                entry["required_ects"] += ects
            elif ctype == "secmeli":
                entry["elective_ects"] += ects
    return out


def _short_view(slug: str, uni: dict) -> dict:
    """Liste endpoint'i için kısa kart verisi."""
    summary = uni.get("_summary") or {}
    courses = uni.get("courses") or []
    ranking = _ranking_view(slug, uni)
    return {
        "slug": slug,
        "name": _name(uni),
        "department": uni.get("department"),
        "department_code": uni.get("_department"),  # bilmuh/yazmuh/ybs
        "language": uni.get("language"),
        "type": uni.get("type"),
        "department_url": uni.get("department_url"),
        "total_courses": summary.get("total_courses", len(courses)),
        "enriched_courses": summary.get("enriched_courses", 0),
        "modernity_score": summary.get("modernity_score"),
        "ranking_sira": ranking["basari_sirasi"] if ranking else None,
        "ranking_kontenjan": ranking["yerlesen_sayisi"] if ranking else None,
    }


# ─── Endpoint'ler ─────────────────────────────────────────────────────

@router.get(
    "",
    summary="Tüm üniversiteler (filtrelenebilir)",
    description=(
        "Dashboard üniversite seçicisi için. Opsiyonel `department` filtresi: "
        "`bilmuh`, `yazmuh`, `ybs`. Boş üniversiteler (0 ders) listelenmez."
    ),
)
def list_universities(
    department: Optional[str] = Query(
        None,
        description="bilmuh | yazmuh | ybs (boşsa hepsi)",
    ),
) -> list[dict]:
    store = get_store()
    if department and department not in VALID_DEPARTMENTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Geçersiz department: {department!r} "
                f"(geçerli: {sorted(VALID_DEPARTMENTS)})"
            ),
        )
    slugs = store.list_slugs(department=department)
    out: list[dict] = []
    for slug in slugs:
        uni = store.get(slug)
        if uni:
            out.append(_short_view(slug, uni))
    return out


@router.get(
    "/{slug}",
    summary="Tek üniversite — full veri (dersler dahil)",
)
def get_university(slug: str) -> dict:
    store = get_store()
    uni = store.get(slug)
    if not uni:
        raise HTTPException(status_code=404, detail=f"Bulunamadı: {slug}")
    # full dict — courses dahil. Dashboard Katman 3'te ders detayı için.
    # Internal alanları (_slug, _department) JSON'da kalabilir, frontend
    # filtre yapabilir; yine de temizledim.
    return {
        **{k: v for k, v in uni.items() if not k.startswith("_")},
        "slug": slug,
        "department_code": uni.get("_department"),
    }


@router.get(
    "/{slug}/summary",
    summary="Üniversite özeti (_summary alanı)",
    description="Dashboard kartları için. `_summary` enrichment ile üretilir.",
)
def get_summary(slug: str) -> dict:
    store = get_store()
    uni = store.get(slug)
    if not uni:
        raise HTTPException(status_code=404, detail=f"Bulunamadı: {slug}")
    summary = uni.get("_summary")
    if not summary:
        raise HTTPException(
            status_code=404,
            detail=(
                f"{slug}: _summary alanı yok — enrichment çalıştırılmamış. "
                "`python -m src.enrichment.enrich --file data/.../<slug>.json` "
                "ile üretebilirsin."
            ),
        )
    ranking = _ranking_view(slug, uni)
    # specialization_depth'i AKTS bilgisiyle zenginleştir (count + ects bir arada)
    spec_depth = dict(summary.get("specialization_depth") or {})
    ects_by_cat = _compute_specialization_ects(uni)
    for cat, entry in spec_depth.items():
        e = ects_by_cat.get(cat, {"required_ects": 0, "elective_ects": 0})
        spec_depth[cat] = {**entry, **e}

    # Program çıktıları (tek-uni görünümünde liste olarak frontend'e iletilir)
    program_outcomes = uni.get("program_outcomes") or []
    if not isinstance(program_outcomes, list):
        program_outcomes = []

    return {
        "slug": slug,
        "name": _name(uni),
        "department": uni.get("department"),
        "department_code": uni.get("_department"),
        "language": uni.get("language"),
        "type": uni.get("type"),
        "ranking_sira": ranking["basari_sirasi"] if ranking else None,
        "ranking_kontenjan": ranking["yerlesen_sayisi"] if ranking else None,
        "program_outcomes": program_outcomes,
        **summary,
        "specialization_depth": spec_depth,
    }


@router.get(
    "/{slug}/resources",
    summary="Tek üniversitenin ders kaynakları (kitap/makale)",
    description=(
        "JSON store'dan o üniversitenin tüm dersleri tarandı, her dersteki "
        "`resources` listesi tekilleştirilip kaynak başına hangi derslerde "
        "kullanıldığı çıkarıldı. Karşılaştırma değil — single-uni listesi."
    ),
)
def get_resources(slug: str) -> dict:
    store = get_store()
    uni = store.get(slug)
    if not uni:
        raise HTTPException(status_code=404, detail=f"Bulunamadı: {slug}")

    # resource (string, normalize edilmemiş) → list[course_code]
    by_resource: dict[str, list[str]] = {}
    for c in uni.get("courses") or []:
        code = (c.get("code") or "").strip()
        for r in c.get("resources") or []:
            if not r or not isinstance(r, str):
                continue
            r_clean = r.strip()
            if not r_clean:
                continue
            by_resource.setdefault(r_clean, [])
            if code and code not in by_resource[r_clean]:
                by_resource[r_clean].append(code)

    # Çoğunlukla kullanılan kaynaklar üstte
    items = sorted(
        (
            {"resource": r, "courses": codes}
            for r, codes in by_resource.items()
        ),
        key=lambda x: (-len(x["courses"]), x["resource"].lower()),
    )

    return {
        "university": {"slug": slug, "name": _name(uni)},
        "total_resources": len(items),
        "resources": items,
    }
