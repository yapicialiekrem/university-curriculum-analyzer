"""
Üniversite seviyesi özet hesaplamaları — LLM KULLANMAZ.

Her `_enriched` field'ı olan dersi tarayıp `_summary` üretir. Bu fonksiyon
her `enrich_university()` tamamlanışında çağrılır ve JSON'a gömülür.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .prompts import ALL_CATEGORIES, TECHNICAL_CATEGORIES

SUMMARY_VERSION = 1


def _coerce_int(v: Any) -> int:
    """None / str '6' → int; parse edilemezse 0."""
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def build_university_summary(university: dict) -> dict:
    """Tüm derslerden aggregate özet üret.

    Args:
        university: JSON dosyasından yüklenmiş dict
            (courses[] + _enriched[]'lar).

    Returns:
        `_summary` dict (MD schema ile birebir uyumlu).
    """
    courses: list[dict] = university.get("courses", []) or []
    enriched: list[dict] = [c for c in courses if c.get("_enriched")]

    summary: dict[str, Any] = {
        "total_courses": len(courses),
        "enriched_courses": len(enriched),
        "unenrichable_courses": len(courses) - len(enriched),
        "summary_version": SUMMARY_VERSION,
        "last_enriched_at": datetime.now(timezone.utc).isoformat(),
    }

    if not enriched:
        return summary

    # ─── Kategori kapsamı (required_ects = zorunlu derslerin AKTS'i) ──
    category_coverage: dict[str, dict[str, int]] = {}
    for cat in ALL_CATEGORIES:
        cat_courses = [
            c for c in enriched
            if cat in (c.get("_enriched", {}).get("categories") or [])
        ]
        required = [c for c in cat_courses if c.get("type") == "zorunlu"]
        category_coverage[cat] = {
            "courses": len(cat_courses),
            "total_ects": sum(_coerce_int(c.get("ects")) for c in cat_courses),
            "required_ects": sum(_coerce_int(c.get("ects")) for c in required),
        }
    summary["category_coverage"] = category_coverage

    # ─── Güncellik skoru (ortalama, int) ────────────────────────────────
    scores = [
        c["_enriched"].get("modernity_score")
        for c in enriched
        if isinstance(c["_enriched"].get("modernity_score"), (int, float))
    ]
    summary["modernity_score"] = (
        round(sum(scores) / len(scores)) if scores else None
    )

    # ─── Uzmanlaşma derinliği (sadece teknik kategoriler) ───────────────
    specialization: dict[str, dict[str, int]] = {}
    for cat in sorted(TECHNICAL_CATEGORIES):
        cat_courses = [
            c for c in enriched
            if cat in (c.get("_enriched", {}).get("categories") or [])
        ]
        specialization[cat] = {
            "required": sum(
                1 for c in cat_courses if c.get("type") == "zorunlu"
            ),
            "elective": sum(
                1 for c in cat_courses if c.get("type") == "secmeli"
            ),
            "total": len(cat_courses),
        }
    summary["specialization_depth"] = specialization

    # ─── En erken teknik seçmeli dönemi ─────────────────────────────────
    elective_semesters: list[int] = []
    for c in enriched:
        if c.get("type") != "secmeli":
            continue
        sem = c.get("semester")
        if not isinstance(sem, int) or sem < 1:
            continue
        cats = c.get("_enriched", {}).get("categories") or []
        if any(cat in TECHNICAL_CATEGORIES for cat in cats):
            elective_semesters.append(sem)
    summary["earliest_technical_elective_semester"] = (
        min(elective_semesters) if elective_semesters else None
    )

    # ─── Proje ağırlığı ─────────────────────────────────────────────────
    project_courses = [
        c for c in enriched
        if c.get("_enriched", {}).get("is_project_heavy") is True
    ]
    summary["project_heavy_course_count"] = len(project_courses)
    summary["total_project_ects"] = sum(
        _coerce_int(c.get("ects")) for c in project_courses
    )

    # ─── İngilizce kaynak oranı ─────────────────────────────────────────
    lang_counts: dict[str, int] = {
        "tr": 0, "en": 0, "mixed": 0, "unknown": 0,
    }
    for c in enriched:
        lang = c["_enriched"].get("resources_language") or "unknown"
        if lang not in lang_counts:
            lang_counts[lang] = 0
        lang_counts[lang] += 1
    total_lang = sum(lang_counts.values())
    summary["english_resources_ratio"] = (
        round(
            (lang_counts["en"] + 0.5 * lang_counts["mixed"]) / total_lang, 2
        )
        if total_lang else 0.0
    )

    return summary
