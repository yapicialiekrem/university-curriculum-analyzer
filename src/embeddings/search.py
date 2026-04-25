"""
search.py — FAISS index üzerinde semantik ders arama.

`builder.py`'in ürettiği `index/courses.faiss` + `index/metadata.pkl`
dosyalarını okur. Bir sorgu metnini embed eder, cosine benzerliğiyle en
yakın dersleri döndürür.

Kullanım:
    from src.embeddings.search import get_searcher
    hits = get_searcher().search("derin öğrenme", top_k=5)
    # hits = [{"score": 0.72, "course_id": 12, "university": "...", ...}]

Tasarım notları:
    - `SemanticSearcher` global **singleton** olarak kullanılır (main.py
      startup'ında warm-up). Model + FAISS index yüklemesi ~500 MB RAM
      ve ~2-3 s alıyor — her çağrıda tekrar etmemeli.
    - `IndexFlatIP` + önceden L2-normalize edilmiş vektörler → inner
      product == cosine similarity (0..1 aralığı).
    - `university_filter` FAISS yerine Python'da uygulanıyor: filtre
      öncesi fazladan sonuç çekiyoruz (`OVERSAMPLE_FACTOR`), sonra
      keser, `top_k`'yi garanti ederiz. Küçük N (<10k) için maliyet
      ihmal edilebilir.
"""

from __future__ import annotations

import logging
import pickle
import threading
from pathlib import Path
from typing import Iterable, Optional

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


HERE = Path(__file__).parent
INDEX_DIR = HERE / "index"
FAISS_FILE = INDEX_DIR / "courses.faiss"
META_FILE = INDEX_DIR / "metadata.pkl"

# builder.py ile aynı model — zorunlu, aksi halde vektör uzayları farklı
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Filtreli aramada: önce top_k * OVERSAMPLE_FACTOR çek, sonra filtrele.
# 5x güvenli bir oran — filtrenin tüm sonuçları elese bile genelde
# yeterli aday kalır.
OVERSAMPLE_FACTOR = 5

logger = logging.getLogger(__name__)


class IndexNotFoundError(RuntimeError):
    """FAISS index veya metadata dosyası bulunamadığında fırlatılır."""


class SemanticSearcher:
    """FAISS tabanlı ders arayıcı.

    Thread-safe: `search()` çağrısı sırasında model.encode + index.search
    çağrılıyor; sentence-transformers ve faiss okuma yolu thread-safe
    olduğu için ek kilitleme gereksiz.

    Attributes:
        model: Yüklü SentenceTransformer.
        index: FAISS IndexFlatIP.
        metadata: builder.py'in yazdığı [{...}] listesi; sıra FAISS
            satırıyla bire bir eşleşir.
    """

    def __init__(
        self,
        faiss_path: Path = FAISS_FILE,
        metadata_path: Path = META_FILE,
        model_name: str = MODEL_NAME,
    ) -> None:
        if not faiss_path.exists():
            raise IndexNotFoundError(
                f"FAISS dosyası yok: {faiss_path}. "
                f"`python -m src.embeddings.builder` ile önce oluştur."
            )
        if not metadata_path.exists():
            raise IndexNotFoundError(
                f"Metadata dosyası yok: {metadata_path}."
            )

        logger.info("Semantic searcher yükleniyor (model=%s) ...", model_name)
        self.model = SentenceTransformer(model_name)
        self.index = faiss.read_index(str(faiss_path))
        with metadata_path.open("rb") as f:
            self.metadata: list[dict] = pickle.load(f)

        if self.index.ntotal != len(self.metadata):
            raise IndexNotFoundError(
                f"FAISS ntotal ({self.index.ntotal}) ile metadata uzunluğu "
                f"({len(self.metadata)}) uyumsuz. Index'i yeniden oluştur."
            )
        logger.info(
            "✓ Searcher hazır: %d ders, dim=%d",
            self.index.ntotal, self.index.d,
        )

    # ─── Public API ────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        top_k: int = 10,
        university_filter: Optional[Iterable[str]] = None,
        category_filter: Optional[Iterable[str]] = None,
        department_filter: Optional[Iterable[str]] = None,
        min_score: float = 0.3,
    ) -> list[dict]:
        """Sorgu metnine en yakın dersleri döndür.

        Args:
            query: Doğal dil sorgusu (Türkçe veya İngilizce).
            top_k: Dönecek maksimum sonuç sayısı.
            university_filter: Sadece bu üniversite slug'larıyla sınırla
                (örn. ["metu", "ege"]). None → filtresiz.
            category_filter: Sadece `_enriched.categories` içinde bu
                kategorilerden EN AZ BİRİ olan dersleri döndür
                (örn. ["ai_ml", "data_science"]). None → filtresiz.
                Index v2'den itibaren çalışır.
            department_filter: Sadece bu departmandan dersler
                (örn. ["bilmuh", "yazmuh"]). None → filtresiz.
            min_score: Bu cosine skorunun altındaki sonuçlar atılır.
                0.3 "alakasız" eşiği; 0.5+ "güçlü" eşleşme.

        Returns:
            Skora göre azalan sıralı sözlük listesi (her dict metadata
            v2 alanlarını içerir: course_id, university, university_slug,
            department_code, code, name, semester, type, language,
            categories, primary_category, modernity_score,
            legacy_categories, url).
        """
        if not query or not query.strip():
            return []
        if top_k < 1:
            return []

        # 1) Query'yi embed + normalize et (cosine için şart)
        q_vec = self.model.encode(
            [query],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        ).astype("float32")

        # 2) FAISS arama. Filtre varsa oversample ile fazladan çek
        # (filtre top_k'yi düşürmesin diye).
        uni_set = {s.lower() for s in university_filter} if university_filter else None
        cat_set = {c for c in category_filter} if category_filter else None
        dept_set = {d for d in department_filter} if department_filter else None

        any_filter = bool(uni_set or cat_set or dept_set)
        search_k = top_k * OVERSAMPLE_FACTOR if any_filter else top_k
        search_k = min(search_k, self.index.ntotal)

        scores, indices = self.index.search(q_vec, search_k)
        scores = scores[0]
        indices = indices[0]

        # 3) Filtrele + min_score eşiği + top_k kes
        results: list[dict] = []
        for score, idx in zip(scores, indices):
            if idx < 0:  # FAISS boş slot
                continue
            if score < min_score:
                # FAISS IP sonuçları zaten azalan sıralı → buradan sonra hepsi düşer
                break
            meta = self.metadata[idx]
            if uni_set and (meta.get("university_slug") or "").lower() not in uni_set:
                continue
            if cat_set:
                meta_cats = set(meta.get("categories") or [])
                if not (meta_cats & cat_set):
                    continue
            if dept_set and meta.get("department_code") not in dept_set:
                continue
            results.append({"score": float(score), **meta})
            if len(results) >= top_k:
                break

        return results


# ─── Singleton erişim ──────────────────────────────────────────────────────

_searcher: Optional[SemanticSearcher] = None
_searcher_lock = threading.Lock()


def get_searcher() -> SemanticSearcher:
    """Process-wide tek bir SemanticSearcher döner (lazy init, thread-safe).

    FastAPI startup'ında çağrılıp warm-up yapılmalı; aksi halde ilk
    /api/chat isteği ~3 saniye beklemeye sebep olur.
    """
    global _searcher
    if _searcher is None:
        with _searcher_lock:
            if _searcher is None:        # double-checked locking
                _searcher = SemanticSearcher()
    return _searcher


def reset_searcher() -> None:
    """Test veya re-index sonrası kullanmak üzere singleton'ı temizle."""
    global _searcher
    with _searcher_lock:
        _searcher = None


# ─── CLI — hızlı manuel test ───────────────────────────────────────────────

def _main() -> int:
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    ap = argparse.ArgumentParser(description="FAISS semantik arama CLI'si.")
    ap.add_argument("query", help="Arama sorgusu (tırnak içinde).")
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--uni", action="append", default=None,
                    help="Tekrarlanabilir: --uni metu --uni ege")
    ap.add_argument("--min-score", type=float, default=0.3)
    args = ap.parse_args()

    searcher = get_searcher()
    hits = searcher.search(
        query=args.query,
        top_k=args.top_k,
        university_filter=args.uni,
        min_score=args.min_score,
    )

    if not hits:
        print("(sonuç yok)")
        return 0

    print(f"\nQuery: {args.query!r}")
    if args.uni:
        print(f"Filter: {args.uni}")
    print(f"{'SKOR':>5}  {'ÜNİ':<8}  {'KOD':<14}  AD")
    print("-" * 70)
    for h in hits:
        print(f"{h['score']:>5.3f}  {h['university_slug']:<8}  "
              f"{h['code']:<14}  {h['name'][:55]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
