"""
coverage.py — Kategori bazlı ortak/ayrı konu haritası (Dashboard Bileşen 2.2).

Kaynak: her dersin `_enriched.categories` + `weekly_topics`.
İlk versiyon (semantik benzerlik yok — string normalize). Sonraki iterasyon
embedding ile semantik kümeleme yapabilir.
"""

from __future__ import annotations

import re
from collections import defaultdict

from .loader import get_store


def _normalize_topic(t: str) -> str:
    """Topic string'ini karşılaştırma anahtarına dönüştür.
    'Hafta 1: Veri Yapıları (Linked Lists)' → 'veri yapilari linked lists'
    """
    s = (t or "").lower()
    s = re.sub(r"^\s*hafta\s*\d+\s*[:\-]\s*", "", s)
    s = re.sub(r"^\s*week\s*\d+\s*[:\-]\s*", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    # Türkçe karakter normalize
    repl = str.maketrans({
        "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
        "ç": "c", "Ç": "c", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u",
    })
    s = s.translate(repl)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:80]   # eşleştirme için yeterli


def compute_coverage(university_slugs: list[str],
                     categories: list[str] | None = None,
                     max_topics_per_uni: int = 30) -> dict:
    """Kategori bazlı ortak/farklı konu özeti.

    Args:
        university_slugs: 2-3 üniversite (1 verilirse de çalışır ama
                          'ortak' kavramı anlamsız).
        categories: filtre — sadece bu kategorilere ait dersleri kapsa.
                    None → tüm kategoriler (not_cs hariç).
        max_topics_per_uni: çıktı listesi başına max konu (LLM context
                          ve frontend okunabilirliği için).

    Returns:
      {
        "by_category": {
          "ai_ml": {
            "universities": {
              "metu": {
                "name": "ODTÜ",
                "course_count": 5,
                "ects": 26,
                "topics": ["derin ogrenme", "rnn", ...]
              },
              "ege": {...}
            },
            "shared_topics":  ["derin ogrenme", "rnn"],   # her iki üni'de de var
            "unique_topics":  {"metu": ["np-complete"], "ege": ["amortized"]}
          }
        }
      }
    """
    if not university_slugs:
        raise ValueError("university_slugs boş olamaz")

    store = get_store()

    # category → uni → {course_count, ects, topics_normalized}
    raw: dict[str, dict[str, dict]] = defaultdict(dict)

    for slug in university_slugs:
        uni = store.get(slug)
        if not uni:
            continue
        for c in uni.get("courses", []) or []:
            enriched = c.get("_enriched") or {}
            cats = enriched.get("categories") or []
            if categories and not any(cat in cats for cat in categories):
                continue
            for cat in cats:
                if cat == "not_cs":
                    continue
                if categories and cat not in categories:
                    continue

                bucket = raw[cat].setdefault(slug, {
                    "name": uni.get("university_name") or slug,
                    "department": uni.get("_department"),
                    "course_count": 0,
                    "ects": 0,
                    "topics_set": set(),
                    "topics_ordered": [],   # ilk görüldüğü sırayı koru
                })
                bucket["course_count"] += 1
                try:
                    bucket["ects"] += int(c.get("ects") or 0)
                except (TypeError, ValueError):
                    pass
                for t in (c.get("weekly_topics") or [])[:14]:
                    norm = _normalize_topic(t)
                    if not norm or norm in bucket["topics_set"]:
                        continue
                    bucket["topics_set"].add(norm)
                    bucket["topics_ordered"].append(norm)

    # Sonuç şekli
    by_category: dict[str, dict] = {}
    for cat, by_uni in raw.items():
        unis_out: dict[str, dict] = {}
        all_sets = []
        for slug, info in by_uni.items():
            topics = info["topics_ordered"][:max_topics_per_uni]
            unis_out[slug] = {
                "name": info["name"],
                "department": info["department"],
                "course_count": info["course_count"],
                "ects": info["ects"],
                "topics": topics,
            }
            all_sets.append(set(topics))

        # Ortak topics: en az 2 üni'de bulunanlar
        shared: list[str] = []
        if len(all_sets) >= 2:
            inter = set.intersection(*all_sets) if all_sets else set()
            # Ordering: ilk üni'de görüldüğü sıraya göre
            first_order = unis_out[list(unis_out.keys())[0]]["topics"]
            shared = [t for t in first_order if t in inter]

        # Tek üni'de olan topics
        unique: dict[str, list[str]] = {}
        if len(all_sets) >= 2:
            others_union = set()
            for s in all_sets:
                others_union |= s
            for slug, info in unis_out.items():
                my_set = set(info["topics"])
                only_mine = my_set - (others_union - my_set)
                # only_mine = my - (toplam - my) yapay; doğru hesap:
                rest = set()
                for other_slug, other_info in unis_out.items():
                    if other_slug != slug:
                        rest |= set(other_info["topics"])
                only_mine = [t for t in info["topics"] if t not in rest]
                unique[slug] = only_mine[:max_topics_per_uni]

        by_category[cat] = {
            "universities": unis_out,
            "shared_topics": shared,
            "unique_topics": unique,
        }

    return {"by_category": by_category}
