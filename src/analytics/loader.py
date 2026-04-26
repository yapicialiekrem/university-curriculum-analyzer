"""
loader.py — EnrichmentStore singleton.

Tüm data/**/*.json'u belleğe yükler (~21 MB enrichment'tan sonra).
Backend startup'ta bir kez çağrılır; her sorgu için disk okuma yapmaz.

Önemli farklılıklar BACKEND_PROMPT (2).md'deki şablondan:
  1) Klasör yapısı flat değil — `data/{bilgisayar,yazilim,ybs}/<slug>.json`.
     `rglob("*.json")` ile tarıyoruz.
  2) Department TESPİTİ klasör adından (string heuristic'ten daha güvenli):
       data/bilgisayar/X.json → bilmuh
       data/yazilim/X.json    → yazmuh
       data/ybs/X.json        → ybs
     Yine de `_department` alanını her university dict'ine ekliyoruz ki
     downstream (chat context, kart filtreleri) tek alandan okusun.
  3) `_slug` alanı her university dict'ine eklenir (path.stem).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"

# Klasör adı → kısa departman kodu
_DEPT_FOLDER_MAP = {
    "bilgisayar": "bilmuh",
    "yazilim": "yazmuh",
    "ybs": "ybs",
}

# Geçerli department kodları (filter için)
VALID_DEPARTMENTS = {"bilmuh", "yazmuh", "ybs"}


# Türkçe → ASCII katlama. URL slug'larında ı/ç/ş/ğ/ö/ü problemli (kullanıcı
# `sabanci` yazıyor, dosya adı `sabancı.json`). Canonical slug ASCII tutulur,
# orijinal Türkçe slug alias olarak korunur.
_TR_FOLD = str.maketrans({
    "ı": "i", "İ": "i",
    "ç": "c", "Ç": "c",
    "ş": "s", "Ş": "s",
    "ğ": "g", "Ğ": "g",
    "ö": "o", "Ö": "o",
    "ü": "u", "Ü": "u",
})


def ascii_fold(s: str) -> str:
    """Türkçe karakterli slug'ı ASCII'ye çevir (lower-case)."""
    return s.translate(_TR_FOLD).lower() if s else ""


class EnrichmentStore:
    """51 üniversitenin enriched JSON verilerini bellekte tutar.

    Tek bir global instance var (`get_store()`). Backend startup'ında
    `load()` çağrılır.

    Attributes:
        _universities: dict[slug] = university dict (ders listesi dahil)
                        + ek alanlar: _slug, _department.
        _loaded:       İdempotent guard.
    """

    def __init__(self) -> None:
        self._universities: dict[str, dict] = {}
        # Türkçe slug → ASCII canonical alias (sabancı → sabanci).
        # get() bu alias'tan geçirir ki eski URL'ler de çalışsın.
        self._aliases: dict[str, str] = {}
        self._loaded = False

    # ─── Yükleme ──────────────────────────────────────────────────────

    def load(self) -> None:
        """data/**/*.json'u tara, JSON'ları belleğe al.

        Aynı slug iki farklı klasörde varsa: ilki kazanır + uyarı log'u.
        Boş JSON'lar (tau gibi 0 ders) yüklenir ama listelenmez.
        """
        if self._loaded:
            return

        for path in sorted(DATA_DIR.rglob("*.json")):
            if not path.is_file():
                continue
            # data/ranking/*.json gibi yardımcı dosyalar üniversite şeması
            # değildir (list of programs) — store'a karıştırma.
            folder = path.parent.name
            if folder not in _DEPT_FOLDER_MAP:
                continue
            original_slug = path.stem
            # Canonical slug: lower-case + Türkçe karakter fold
            slug = ascii_fold(original_slug)
            if slug in self._universities:
                logger.warning(
                    "Slug çakışması: %s zaten yüklü (yeni: %s, atlandı)",
                    slug, path
                )
                continue
            try:
                with path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.warning("%s yüklenemedi: %s", path.name, e)
                continue
            if not isinstance(data, dict):
                logger.warning("%s dict değil, atlandı", path)
                continue

            data["_slug"] = slug
            data["_department"] = _DEPT_FOLDER_MAP.get(folder, "other")

            self._universities[slug] = data
            # Türkçe orijinal slug → ASCII canonical alias (geriye uyum)
            if original_slug.lower() != slug:
                self._aliases[original_slug.lower()] = slug

        self._loaded = True
        non_empty = sum(
            1 for u in self._universities.values()
            if u.get("courses")
        )
        logger.info(
            "✓ EnrichmentStore: %d üniversite yüklü (%d ders içeren)",
            len(self._universities), non_empty
        )

    # ─── Erişim ───────────────────────────────────────────────────────

    def get(self, slug: str) -> Optional[dict]:
        """Tek üniversite dict'i (None: bulunamadı).

        Slug ASCII fold + lower-case sonrası lookup yapar; Türkçe karakterli
        eski slug'lar (sabancı, fırat, ytü) alias üzerinden de bulunur.
        """
        if not slug:
            return None
        key = ascii_fold(slug)
        # Önce direkt canonical key'le dene
        if key in self._universities:
            return self._universities[key]
        # Geriye uyumluluk: alias üzerinden
        canonical = self._aliases.get(slug.lower())
        if canonical:
            return self._universities.get(canonical)
        return None

    def list_slugs(self, department: Optional[str] = None,
                   include_empty: bool = False) -> list[str]:
        """Tüm slug'lar; istenirse departmana göre filtrele.

        Args:
            department: 'bilmuh' | 'yazmuh' | 'ybs' | None (hepsi).
            include_empty: 0 dersli üniversiteleri de listele (default False —
                            tau gibi placeholder'lar dashboard'da gözükmesin).

        Returns:
            Slug listesi (alfabetik sıralı).

        Raises:
            ValueError: Geçersiz department.
        """
        if department is not None and department not in VALID_DEPARTMENTS:
            raise ValueError(
                f"Geçersiz department: {department!r} "
                f"(geçerli: {sorted(VALID_DEPARTMENTS)})"
            )
        out: list[str] = []
        for slug, data in self._universities.items():
            if department and data.get("_department") != department:
                continue
            if not include_empty and not data.get("courses"):
                continue
            out.append(slug)
        return sorted(out)

    def all(self) -> dict[str, dict]:
        """Tüm slug→data sözlüğü (read-only kullanım için)."""
        return self._universities

    # ─── Yardımcı ─────────────────────────────────────────────────────

    def reload(self) -> None:
        """Enrichment sonrası bellek tazeleme (admin endpoint'i için)."""
        self._universities.clear()
        self._loaded = False
        self.load()

    def stats(self) -> dict:
        """Hızlı stat — debug + admin için."""
        total_courses = 0
        enriched_courses = 0
        per_dept: dict[str, int] = {}
        for u in self._universities.values():
            if not u.get("courses"):
                continue
            total_courses += len(u["courses"])
            enriched_courses += sum(
                1 for c in u["courses"] if c.get("_enriched")
            )
            d = u.get("_department", "other")
            per_dept[d] = per_dept.get(d, 0) + 1
        return {
            "universities": len(self._universities),
            "non_empty_universities": sum(
                1 for u in self._universities.values() if u.get("courses")
            ),
            "total_courses": total_courses,
            "enriched_courses": enriched_courses,
            "by_department": per_dept,
        }


# ─── Global singleton ─────────────────────────────────────────────────

_store: Optional[EnrichmentStore] = None


def get_store() -> EnrichmentStore:
    """Process-wide tek bir EnrichmentStore. İlk çağrıda lazy-load yapar."""
    global _store
    if _store is None:
        _store = EnrichmentStore()
        _store.load()
    return _store


def reset_store() -> None:
    """Test için store'u sıfırla."""
    global _store
    _store = None


# ─── CLI ──────────────────────────────────────────────────────────────

def _main() -> int:
    """python -m src.analytics.loader → sayım çıktısı."""
    import json
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    store = get_store()
    s = store.stats()
    print(json.dumps(s, ensure_ascii=False, indent=2))

    print("\nDepartmana göre slug listesi:")
    for dept in ["bilmuh", "yazmuh", "ybs"]:
        slugs = store.list_slugs(department=dept)
        print(f"  {dept} ({len(slugs)}): {', '.join(slugs[:5])}"
              + (" ..." if len(slugs) > 5 else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
