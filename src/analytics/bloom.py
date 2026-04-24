"""
bloom.py — Bloom taksonomisi donut grafiği verisi (Dashboard Bileşen 2.3).

Kaynak: her dersin `_enriched.bloom_distribution` alanı (6 float, ~1.0 toplam).
Üniversite başına: ECTS-ağırlıklı ortalama.
"""

from __future__ import annotations

from .loader import get_store

BLOOM_LEVELS: list[str] = [
    "remember", "understand", "apply", "analyze", "evaluate", "create",
]


def compute_bloom(university_slugs: list[str]) -> dict:
    """Üniversite başına bloom seviye dağılımı (ECTS-ağırlıklı ortalama).

    Args:
        university_slugs: hesaplanacak üniversiteler.

    Returns:
      {
        "levels": ["remember", "understand", "apply", "analyze", "evaluate", "create"],
        "series": [
          {
            "slug": "odtu", "name": "ODTÜ",
            "distribution": {"remember": 0.10, "understand": 0.20, "apply": 0.45,
                             "analyze": 0.15, "evaluate": 0.05, "create": 0.05},
            "dominant": "apply",
            "based_on_courses": 78
          },
          ...
        ]
      }

    Notlar:
      - `not_cs` dersleri DAHİL — bloom seviyesi yine bilişsel zorluk
        sinyali verir, kategori bağımsız.
      - ECTS yoksa ders ağırlığı 1 alınır (eşit ağırlık).
      - Tek dersi olmayan üniversite series'e dahil edilmez.
    """
    if not university_slugs:
        raise ValueError("university_slugs boş olamaz")

    store = get_store()
    series: list[dict] = []

    for slug in university_slugs:
        uni = store.get(slug)
        if not uni:
            continue
        enriched_courses = [
            c for c in uni.get("courses", []) or []
            if c.get("_enriched")
            and isinstance(c["_enriched"].get("bloom_distribution"), dict)
        ]
        if not enriched_courses:
            continue

        totals: dict[str, float] = {lvl: 0.0 for lvl in BLOOM_LEVELS}
        total_weight: float = 0.0
        for c in enriched_courses:
            try:
                weight = float(c.get("ects") or 1)
            except (TypeError, ValueError):
                weight = 1.0
            if weight <= 0:
                weight = 1.0
            dist = c["_enriched"]["bloom_distribution"]
            for lvl in BLOOM_LEVELS:
                try:
                    totals[lvl] += float(dist.get(lvl) or 0) * weight
                except (TypeError, ValueError):
                    pass
            total_weight += weight

        if total_weight <= 0:
            continue

        distribution = {
            lvl: round(totals[lvl] / total_weight, 3)
            for lvl in BLOOM_LEVELS
        }
        # Hafif yuvarlama hatasını dengele — toplamı 1.0'a yakın olsun
        s = sum(distribution.values())
        if s > 0 and abs(s - 1.0) > 0.005:
            distribution = {
                lvl: round(distribution[lvl] / s, 3) for lvl in BLOOM_LEVELS
            }

        dominant = max(distribution, key=distribution.get)

        series.append({
            "slug": slug,
            "name": uni.get("university_name") or slug,
            "department": uni.get("_department"),
            "distribution": distribution,
            "dominant": dominant,
            "based_on_courses": len(enriched_courses),
        })

    return {"levels": BLOOM_LEVELS, "series": series}
