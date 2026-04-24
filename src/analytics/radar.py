"""
radar.py — 10 eksenli radar grafiği verisi (Dashboard Bileşen 1.1).

Kaynak: her üniversitenin `_summary.category_coverage` alanı.
Normalizasyon: her eksen için **tüm üniversitelerdeki maksimum ECTS'e** göre
0-100 aralığına. Böylece "bu konuya en çok ağırlık veren üni" 100 alır,
diğerleri ona oranla.

`compute_radar(["odtu","ieu"])` → frontend'in Recharts veya D3 ile
çizebileceği yapısal sözlük.
"""

from __future__ import annotations

from .loader import get_store

# Saat yönünde sıralama (DASHBOARD_PROMPT.md Bileşen 1.1 ile uyumlu).
# `not_cs` ve `info_systems` radar'a girmez — radar saf "CS müfredatı"
# karakterini gösterir. info_systems özellikle YBS'lerde ana eksendir
# ama CS/SE için çevresel; eklemek istersen (ör. YBS modunda) ek eksen
# olarak ele alınabilir — bu PR'da default 10 eksen.
RADAR_AXES: list[tuple[str, str]] = [
    ("math",            "Matematik / Teorik Temel"),
    ("programming",     "Programlama"),
    ("systems",         "Sistem / Donanım"),
    ("ai_ml",           "Yapay Zeka / ML"),
    ("data_science",    "Veri Bilimi"),
    ("security",        "Siber Güvenlik"),
    ("web_mobile",      "Web / Mobil"),
    ("software_eng",    "Yazılım Mühendisliği"),
    ("graphics_vision", "Grafik / Görüntü"),
    ("distributed",     "Dağıtık Sistemler"),
]


def _ects_for(uni: dict, axis_key: str) -> int:
    """Bir üniversitenin ilgili eksendeki toplam_ects değeri (yoksa 0)."""
    summary = uni.get("_summary") or {}
    coverage = summary.get("category_coverage") or {}
    return int((coverage.get(axis_key) or {}).get("total_ects") or 0)


def compute_radar(university_slugs: list[str]) -> dict:
    """Seçili üniversiteler için radar verisi.

    Args:
        university_slugs: 1-3 arası slug — tipik 2 (A vs B karşılaştırması).

    Returns:
      {
        "axes": [{"key":"math","label":"Matematik / Teorik Temel"}, ...],
        "series": [
          {
            "slug": "odtu", "name": "ODTÜ",
            "values":   [85, 92, 70, 100, 65, 45, 55, 78, 60, 40],  // 0-100
            "raw_ects": [120, 144, 96, 156, 84, 60, 72, 108, 84, 48]
          },
          ...
        ],
        "global_max_ects": {"math": 144, "ai_ml": 156, ...}
      }

    Raises:
        ValueError: slugs boş ya da hiçbiri bulunamadıysa.
    """
    if not university_slugs:
        raise ValueError("university_slugs boş olamaz")

    store = get_store()

    # Tüm üniversitelerdeki max ECTS — normalize tabanı
    # (boş JSON'lar zaten 0 katkı yapar, sıfıra bölünmeyi önlüyoruz)
    global_max: dict[str, int] = {axis: 0 for axis, _ in RADAR_AXES}
    for slug in store.list_slugs():
        uni = store.get(slug)
        if not uni:
            continue
        for axis, _ in RADAR_AXES:
            ects = _ects_for(uni, axis)
            if ects > global_max[axis]:
                global_max[axis] = ects

    # Seçili üniversiteler
    series: list[dict] = []
    not_found: list[str] = []
    for slug in university_slugs:
        uni = store.get(slug)
        if not uni:
            not_found.append(slug)
            continue
        raw = []
        values = []
        for axis, _ in RADAR_AXES:
            ects = _ects_for(uni, axis)
            raw.append(ects)
            base = global_max[axis]
            normalized = round((ects / base) * 100) if base > 0 else 0
            values.append(normalized)
        series.append({
            "slug": slug,
            "name": uni.get("university_name") or slug,
            "department": uni.get("_department"),
            "values": values,
            "raw_ects": raw,
        })

    if not series:
        raise ValueError(
            f"Hiç üniversite bulunamadı: {university_slugs}"
        )

    return {
        "axes": [{"key": k, "label": lbl} for k, lbl in RADAR_AXES],
        "series": series,
        "global_max_ects": global_max,
        "not_found": not_found,  # frontend uyarı gösterebilir
    }
