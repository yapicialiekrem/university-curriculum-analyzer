"""
builder.py — Ders bazlı FAISS embedding index oluşturucu.

Her ders TEK bir 384 boyutlu vektörle temsil edilir. Vektöre gömülen metin
formatı:

    f"{code} {name}. Amaç: {purpose}. İçerik: {description}. "
    f"Konular: {topics_joined}. Kazanımlar: {outcomes_joined}"

Girdi:
    data/*.json  — `university_name` + `courses[]` alanları olan dosyalar.

Çıktı:
    src/embeddings/index/courses.faiss   — `IndexFlatIP` (cosine için
                                            önceden L2-normalize edilmiş).
    src/embeddings/index/metadata.pkl    — Her ders için meta kayıt
                                            (course_id, university, code,
                                            name, url, semester, type,
                                            language, category, file).
    src/embeddings/index/manifest.json   — İnsan okunur özet / debug için
                                            (kaç ders, hangi dosyalar vs.).

CLI:
    python -m src.embeddings.builder                # tüm data/*.json
    python -m src.embeddings.builder --limit 2      # sadece ilk 2 dosya
                                                      (prompt Adım 1 testi)
    python -m src.embeddings.builder --data-dir X   # farklı klasör
"""

from __future__ import annotations

import argparse
import json
import logging
import pickle
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Optional

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


# ─── Sabitler ──────────────────────────────────────────────────────────────
# Not: Mevcut `src/config.py` EMBEDDING_MODEL'i bu sabit değeri tutuyor,
# ama bu modül standalone çalışabilsin diye explicit tanımlıyoruz.
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384

HERE = Path(__file__).parent
INDEX_DIR = HERE / "index"
DEFAULT_DATA_DIR = HERE.parent.parent / "data"    # <repo>/data

FAISS_FILE = INDEX_DIR / "courses.faiss"
META_FILE = INDEX_DIR / "metadata.pkl"
MANIFEST_FILE = INDEX_DIR / "manifest.json"

logger = logging.getLogger(__name__)


# ─── Metin birleştirme ─────────────────────────────────────────────────────

def build_course_text(course: dict) -> str:
    """Ders sözlüğünden embedding için birleşik (tek satır) metin üret.

    Kısa alanlar boş ise atlanır; böylece kısa/eksik dersler de makul bir
    vektöre sahip olur. Uzun listeler (weekly_topics, learning_outcomes)
    ilk 10 elemanla kesilir — LLM token baskısı yok, ama çok uzun metinler
    embedding kalitesini seyreltebiliyor.

    Args:
        course: Ders JSON'u (code, name, purpose, description,
                weekly_topics, learning_outcomes alanlarını kullanır).

    Returns:
        Tek bir string — boşsa boş string döner.
    """
    code = (course.get("code") or "").strip()
    name = (course.get("name") or "").strip()
    purpose = (course.get("purpose") or "").strip()
    description = (course.get("description") or "").strip()

    parts: list[str] = []
    if code or name:
        parts.append(f"{code} {name}".strip())
    if purpose:
        parts.append(f"Amaç: {purpose}")
    if description:
        parts.append(f"İçerik: {description}")

    topics = [
        t.strip() for t in (course.get("weekly_topics") or [])
        if isinstance(t, str) and t.strip() and t.strip() != "-"
    ][:10]
    if topics:
        parts.append(f"Konular: {'. '.join(topics)}")

    outcomes = [
        o.strip() for o in (course.get("learning_outcomes") or [])
        if isinstance(o, str) and o.strip()
    ][:10]
    if outcomes:
        parts.append(f"Kazanımlar: {'. '.join(outcomes)}")

    return " ".join(parts).strip()


# ─── Meta kaydı ────────────────────────────────────────────────────────────

@dataclass
class CourseMeta:
    """FAISS satırına karşılık gelen meta kayıt.

    course_id: Bu run'a özel sıra numarası (FAISS index satırı ile aynı).
    Diğer alanlar frontend (dashboard/citations) ve search filtreleri için.

    v2 (FAZ 3):
        - `categories` artık `_enriched.categories` (konu kategorileri)
        - `legacy_categories` eski root.categories (elective havuz isimleri)
        - `primary_category` ve `modernity_score` enrichment'tan geldi
        - `department_code` (bilmuh/yazmuh/ybs) klasör adından
    """

    course_id: int
    university: str
    university_slug: str         # dosya adı (uzantısız) — filter anahtarı
    department_code: str         # bilmuh | yazmuh | ybs | other
    code: str
    name: str
    semester: Optional[int]
    type: Optional[str]
    language: Optional[str]
    # Enrichment (v2)
    categories: list[str]              # _enriched.categories (konu)
    primary_category: Optional[str]    # _enriched.primary_category
    modernity_score: Optional[int]     # _enriched.modernity_score (0-100)
    # Eski elective havuzları (frontend filter için bilgilendirici)
    legacy_categories: list[str]
    url: Optional[str]
    source_file: str

    # Index versiyonu — search.py uyumluluğu için
    schema_version: int = 2


# ─── Core build ────────────────────────────────────────────────────────────

def _iter_data_files(data_dir: Path, limit: Optional[int]) -> list[Path]:
    """data/*.json + data/**/*.json (recursive — alt klasörler için)."""
    seen: set[Path] = set()
    files: list[Path] = []
    for p in sorted(data_dir.rglob("*.json")):
        if p.is_file() and p not in seen:
            seen.add(p)
            files.append(p)
    if limit is not None and limit > 0:
        files = files[:limit]
    return files


def _load_university(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _slug_from_path(path: Path) -> str:
    """`data/metu.json` → `metu`."""
    return path.stem


def _collect_courses(
    files: Iterable[Path],
) -> tuple[list[str], list[CourseMeta]]:
    """Dersleri yürü, (embedding_text[], meta[]) listelerini üret.

    Metin boşsa dersi atla — embedding kalitesi düşer ve zaten aramada hiç
    benzerlik üretmez.
    """
    texts: list[str] = []
    metas: list[CourseMeta] = []
    course_id = 0

    # Klasör adı → departman kodu (analytics/loader.py ile aynı eşleme)
    DEPT_MAP = {"bilgisayar": "bilmuh", "yazilim": "yazmuh", "ybs": "ybs"}

    for path in files:
        data = _load_university(path)
        university = (
            data.get("university_name")
            or data.get("uni_name")          # eski şema fallback
            or path.stem
        )
        slug = _slug_from_path(path)
        dept_code = DEPT_MAP.get(path.parent.name, "other")

        for course in data.get("courses", []) or []:
            text = build_course_text(course)
            if not text:
                continue

            enriched = course.get("_enriched") or {}

            meta = CourseMeta(
                course_id=course_id,
                university=university,
                university_slug=slug,
                department_code=dept_code,
                code=(course.get("code") or "").strip(),
                name=(course.get("name") or "").strip(),
                semester=course.get("semester"),
                type=course.get("type"),
                language=course.get("language"),
                # v2 — enrichment
                categories=list(enriched.get("categories") or []),
                primary_category=enriched.get("primary_category"),
                modernity_score=(
                    int(enriched["modernity_score"])
                    if isinstance(enriched.get("modernity_score"), (int, float))
                    else None
                ),
                legacy_categories=list(course.get("categories") or []),
                url=course.get("source_url"),
                source_file=path.name,
            )
            texts.append(text)
            metas.append(meta)
            course_id += 1

    return texts, metas


def _encode(texts: list[str], model: SentenceTransformer) -> np.ndarray:
    """Texts → (N, D) float32 matris. L2-normalize edilmiş.

    Cosine benzerliği için `IndexFlatIP` (iç çarpım) kullanıyoruz; bu
    vektörlerin normalize edilmesi şart.
    """
    logger.info("Encoding %d belge ...", len(texts))
    vecs = model.encode(
        texts,
        batch_size=32,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,    # cosine için birim vektör
    ).astype("float32")
    if vecs.shape[1] != EMBEDDING_DIM:
        raise RuntimeError(
            f"Model {MODEL_NAME} boyutu {vecs.shape[1]} olması beklenmiyor "
            f"(beklenen {EMBEDDING_DIM})."
        )
    return vecs


def build_index(
    data_dir: Path = DEFAULT_DATA_DIR,
    limit: Optional[int] = None,
) -> dict:
    """Ana giriş: data/*.json → courses.faiss + metadata.pkl.

    Args:
        data_dir: JSON dosyalarının bulunduğu klasör.
        limit: Sadece ilk N dosyayı işle (None = hepsi). ADIM 1 testi için
               prompt `--limit 2` öneriyor.

    Returns:
        Manifest sözlüğü (çıktı dosya yollarına ve sayımlara giriş).

    Raises:
        FileNotFoundError: data_dir yoksa ya da .json hiç yoksa.
    """
    if not data_dir.exists():
        raise FileNotFoundError(f"Data dizini yok: {data_dir}")

    files = _iter_data_files(data_dir, limit)
    if not files:
        raise FileNotFoundError(f"'{data_dir}' altında JSON yok")

    logger.info("İşlenecek dosyalar (%d): %s",
                len(files), [p.name for p in files])

    texts, metas = _collect_courses(files)
    if not texts:
        raise RuntimeError("Hiç uygun ders bulunamadı (tüm metinler boştu).")
    logger.info("Toplam ders: %d", len(texts))

    # Model yükle
    logger.info("Model yükleniyor: %s", MODEL_NAME)
    model = SentenceTransformer(MODEL_NAME)

    # Encode
    vectors = _encode(texts, model)

    # FAISS index
    index = faiss.IndexFlatIP(EMBEDDING_DIM)
    index.add(vectors)
    logger.info("FAISS index hazır: ntotal=%d, dim=%d",
                index.ntotal, index.d)

    # Kaydet
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(FAISS_FILE))
    with META_FILE.open("wb") as f:
        pickle.dump([asdict(m) for m in metas], f)

    manifest = {
        "model": MODEL_NAME,
        "dim": EMBEDDING_DIM,
        "total_courses": len(metas),
        "files": [p.name for p in files],
        "universities": sorted({m.university for m in metas}),
        "faiss_path": str(FAISS_FILE.relative_to(HERE.parent.parent)),
        "metadata_path": str(META_FILE.relative_to(HERE.parent.parent)),
    }
    with MANIFEST_FILE.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    logger.info("✓ Yazıldı: %s (%d bayt)",
                FAISS_FILE.name, FAISS_FILE.stat().st_size)
    logger.info("✓ Yazıldı: %s (%d bayt)",
                META_FILE.name, META_FILE.stat().st_size)
    logger.info("✓ Yazıldı: %s", MANIFEST_FILE.name)

    return manifest


# ─── CLI ───────────────────────────────────────────────────────────────────

def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description="FAISS embedding index oluştur (data/*.json)."
    )
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                    help="JSON kaynak klasörü (varsayılan: <repo>/data).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Sadece ilk N dosyayı işle (test için).")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    _configure_logging(args.verbose)

    try:
        manifest = build_index(data_dir=args.data_dir, limit=args.limit)
    except Exception as e:
        logger.error("build_index başarısız: %s", e, exc_info=True)
        return 1

    print("\n=== MANIFEST ===")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
