"""
ranking.py — Üniversite YKS sıralama + kontenjan verisi.

Kaynak: data/ranking/{bilmuh,yazmuh,ybs}.json (manuel scrape).
Format:
  [{"isim": "ORTA DOĞU TEKNİK ÜNİVERSİTESİ(İngilizce) (4 Yıllık)",
    "tur": "Devlet",
    "yerlesen_sayisi": "108",
    "basari_sirasi": "1.204"}, ...]

Bir üniversitenin birden fazla programı olabilir (örn. burslu / %50 indirimli /
ücretli). En iyi (en küçük) sıralamayı kullanırız — kullanıcı "bu üniversiteye
girmek için en az kaç olmak gerekir" sorusunu sorar.

Çağrı API'si:
    get_ranking(slug, department, university_name) → {basari_sirasi, yerlesen_sayisi, isim} | None
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

# Türkçe-fold tablosu (slug logic ile aynı yaklaşım)
_TR_FOLD = str.maketrans({
    "ç": "c", "Ç": "c",
    "ğ": "g", "Ğ": "g",
    "ı": "i", "İ": "i",
    "ö": "o", "Ö": "o",
    "ş": "s", "Ş": "s",
    "ü": "u", "Ü": "u",
})

_PAREN = re.compile(r"\(.*?\)")
_WS = re.compile(r"\s+")

# Slug → ranking JSON'da görünen tam ad (ambiguous slug'lar için)
_SLUG_ALIAS: dict[str, str] = {
    "medipol": "istanbul medipol universitesi",
    "bilgi": "istanbul bilgi universitesi",
    "bilkent": "ihsan dogramaci bilkent universitesi",
}

_RANKING_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "ranking"


def _norm(name: str) -> str:
    """Türkçe-fold + parantez temizleme + lowercase + whitespace normalize."""
    s = _PAREN.sub("", name)
    s = s.translate(_TR_FOLD).lower()
    return _WS.sub(" ", s).strip()


@lru_cache(maxsize=1)
def _load_all() -> dict[str, list[dict]]:
    """Tüm department dosyalarını oku, parse edilmiş listeyi döndür."""
    out: dict[str, list[dict]] = {}
    for dept in ("bilmuh", "yazmuh", "ybs"):
        path = _RANKING_DIR / f"{dept}.json"
        if not path.exists():
            out[dept] = []
            continue
        with path.open(encoding="utf-8") as f:
            raw = json.load(f)
        parsed: list[dict] = []
        for r in raw:
            try:
                sira = int(str(r.get("basari_sirasi", "")).replace(".", ""))
                kont = int(str(r.get("yerlesen_sayisi", "")))
            except (ValueError, TypeError):
                continue
            parsed.append({
                "isim": r.get("isim", ""),
                "tur": r.get("tur", ""),
                "basari_sirasi": sira,
                "yerlesen_sayisi": kont,
                "_norm": _norm(r.get("isim", "")),
            })
        out[dept] = parsed
    return out


def _base_slug(slug: str) -> str:
    """`metu-yazilim` → `metu`, `bilkent-ybs` → `bilkent`."""
    return re.sub(r"-(yazi?lim|ybs)$", "", slug)


def get_ranking(
    slug: str,
    department: Optional[str],
    university_name: Optional[str],
) -> Optional[dict]:
    """En iyi (en küçük başarı sırasıyla) eşleşmeyi döndür.

    Args:
        slug: dataset slug (ör. "metu", "ekonomi-yazilim")
        department: "bilmuh" / "yazmuh" / "ybs"
        university_name: kaynak JSON'daki university_name (ad eşlemesi için)

    Returns:
        {"basari_sirasi": int, "yerlesen_sayisi": int, "isim": str} veya None.
    """
    if not department or not university_name:
        return None
    all_data = _load_all()
    rows = all_data.get(department, [])
    if not rows:
        return None

    base = _base_slug(slug)
    target_norm = _SLUG_ALIAS.get(base, _norm(university_name))
    if not target_norm:
        return None

    matches: list[dict] = []
    for r in rows:
        n = r["_norm"]
        if not n.startswith(target_norm):
            continue
        # Word boundary: ya tam eşit ya da hemen sonrasında alfabetik karakter yok
        nxt = n[len(target_norm):len(target_norm) + 1]
        if nxt and nxt.isalpha():
            continue
        matches.append(r)

    if not matches:
        return None

    best = min(matches, key=lambda r: r["basari_sirasi"])
    return {
        "basari_sirasi": best["basari_sirasi"],
        "yerlesen_sayisi": best["yerlesen_sayisi"],
        "isim": best["isim"],
    }
