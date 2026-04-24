"""
heatmap.py — Dönem × Kategori ECTS heatmap (Dashboard Bileşen 2.1).

Kaynak: her dersin `_enriched.categories` + `semester` + `type` + `ects`.

Çıktı şekli frontend Recharts'ın değil, custom heatmap'in beklediği yapıda:
  series[].matrix[category][semester]{zorunlu, secmeli}
"""

from __future__ import annotations

from collections import defaultdict

from .loader import get_store
from .radar import RADAR_AXES   # heatmap satırları radar'dakiyle aynı sıra

VALID_SEMESTERS = list(range(1, 9))   # 1..8


def compute_semester_heatmap(university_slugs: list[str]) -> dict:
    """Her üniversite için 8 dönem × 10 kategori ECTS matrisi.

    Args:
        university_slugs: 1-3 üniversite.

    Returns:
      {
        "categories": [{"key":"math","label":"..."}, ...],
        "semesters": [1,2,...,8],
        "series": [
          {
            "slug": "odtu", "name": "ODTÜ",
            "matrix": {
              "math":    {"1":{"zorunlu":6,"secmeli":0}, "2":{...}, ...},
              "ai_ml":   {"5":{"zorunlu":3,"secmeli":6}, ...},
              ...
            }
          }
        ]
      }

    Notlar:
      - Aynı ders birden fazla kategoride olabilir → ECTS HER kategoride
        sayılır (radar'la aynı yöntem; toplam frontend'e çift sayı
        gözükmez çünkü her satır ayrı kategori).
      - `not_cs` ve `info_systems` heatmap'te yok (radar ile uyumlu).
      - Geçersiz semester'lar (None, <1, >8) atılır.
    """
    if not university_slugs:
        raise ValueError("university_slugs boş olamaz")

    store = get_store()
    valid_categories = {axis for axis, _ in RADAR_AXES}
    series: list[dict] = []

    for slug in university_slugs:
        uni = store.get(slug)
        if not uni:
            continue

        # matrix[cat][sem] = {"zorunlu": int, "secmeli": int}
        matrix: dict[str, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: {"zorunlu": 0, "secmeli": 0})
        )

        for c in uni.get("courses", []) or []:
            sem = c.get("semester")
            if not isinstance(sem, int) or sem not in VALID_SEMESTERS:
                continue
            ctype = c.get("type")
            if ctype not in ("zorunlu", "secmeli"):
                continue
            ects = c.get("ects")
            try:
                ects_int = int(ects) if ects is not None else 0
            except (TypeError, ValueError):
                ects_int = 0

            cats = (c.get("_enriched") or {}).get("categories") or []
            for cat in cats:
                if cat not in valid_categories:
                    continue
                matrix[cat][str(sem)][ctype] += ects_int

        # defaultdict → normal dict
        matrix_clean = {
            cat: {sem: dict(vals) for sem, vals in sems.items()}
            for cat, sems in matrix.items()
        }

        series.append({
            "slug": slug,
            "name": uni.get("university_name") or slug,
            "department": uni.get("_department"),
            "matrix": matrix_clean,
        })

    return {
        "categories": [{"key": k, "label": lbl} for k, lbl in RADAR_AXES],
        "semesters": VALID_SEMESTERS,
        "series": series,
    }
