"""
context.py — Intent → yapısal veri sözlüğü.

LLM KULLANMAZ. Intent'in tipine göre:
    - Neo4j (mevcut ComparisonEngine üzerinden)
    - FAISS semantik arama
    - Statik sistem bilgisi

arasından uygun kaynağı seçip bir dict döner. Bu dict answer.generate_answer'a
`context_json` olarak verilir.

Slug ↔ üniversite adı eşleştirmesi `data/*.json` dosyalarının adından ve
içindeki `university_name` alanından çıkarılır — LRU cache'li.

Mevcut üniversite yoksa LLM uydurmasın diye
`context["universities_missing"]` doldurulur (MD #7 kuralı).
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .schemas import Intent

logger = logging.getLogger(__name__)

# ─── Yollar ────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"

# Context size cap'i — ANSWER_PROMPT'a gömerken answer.py 8k char'dan
# keser. Bizim per-üniversite listeleri burada truncate edelim ki
# yararlı bilgi önce gitsin.
MAX_COURSES_PER_UNI = 20


# ═══════════════════════════════════════════════════════════════════════════
# SLUG ↔ AD EŞLEŞMESİ
# ═══════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def _slug_to_name_map() -> dict[str, str]:
    """data/*.json → {slug_lower: university_name}. Cached."""
    mapping: dict[str, str] = {}
    if not DATA_DIR.exists():
        logger.warning("Data dir yok: %s", DATA_DIR)
        return mapping
    for path in DATA_DIR.glob("*.json"):
        try:
            with path.open("r", encoding="utf-8") as f:
                d = json.load(f)
        except Exception as e:
            logger.warning("%s okunamadı: %s", path.name, e)
            continue
        name = d.get("university_name")
        if name:
            mapping[path.stem.lower()] = name
    return mapping


def _resolve_uni(slug: str) -> Optional[str]:
    """Slug'ı resmi üniversite adına çevir."""
    return _slug_to_name_map().get((slug or "").strip().lower())


# ═══════════════════════════════════════════════════════════════════════════
# LAZY SINGLETON'LAR (engine + searcher)
# ═══════════════════════════════════════════════════════════════════════════

_engine: Any = None  # ComparisonEngine; import hatalarında None kalır


def _get_engine() -> Optional[Any]:
    """ComparisonEngine lazy init. Neo4j bağlanamazsa None döner (→ ilgili
    dallar context'e `"error"` ekler, LLM yine cevap üretebilir)."""
    global _engine
    if _engine is None:
        try:
            # comparison.py flat-import (src/ sys.path'te) bekliyor
            import sys
            src_dir = str(Path(__file__).resolve().parent.parent)
            if src_dir not in sys.path:
                sys.path.insert(0, src_dir)
            from comparison import ComparisonEngine  # noqa: E402
            _engine = ComparisonEngine()
            logger.info("ComparisonEngine yüklendi")
        except Exception as e:
            logger.warning("ComparisonEngine yüklenemedi: %s", e)
            return None
    return _engine


def _get_searcher():
    """FAISS searcher lazy init. Index yoksa None."""
    try:
        from src.embeddings.search import get_searcher, IndexNotFoundError
    except Exception as e:
        logger.warning("search modülü import hatası: %s", e)
        return None
    try:
        return get_searcher()
    except IndexNotFoundError as e:
        logger.warning("FAISS index yok: %s", e)
        return None
    except Exception as e:
        logger.warning("Searcher init hatası: %s", e)
        return None


# ═══════════════════════════════════════════════════════════════════════════
# ÜNİVERSİTE ÇÖZÜMLEMESİ
# ═══════════════════════════════════════════════════════════════════════════

def _resolve_universities(intent: Intent) -> tuple[list[dict], list[str]]:
    """Intent.universities → ([{slug,name}], missing_slugs).

    `missing_slugs` LLM'e açıkça "bu üniversite verimizde yok" sinyali
    verilsin diye context'e eklenir.
    """
    found: list[dict] = []
    missing: list[str] = []
    for slug in intent.universities:
        name = _resolve_uni(slug)
        if name:
            found.append({"slug": slug, "name": name})
        else:
            missing.append(slug)
    return found, missing


# ═══════════════════════════════════════════════════════════════════════════
# KOLLAR — her intent.type için
# ═══════════════════════════════════════════════════════════════════════════

def _language_matches(course_lang: Optional[str], filt: Optional[str]) -> bool:
    if not filt:
        return True
    if not course_lang:
        return False
    cl = course_lang.lower().strip()
    if filt == "tr":
        return cl in ("türkçe", "turkce", "turkish", "tr")
    if filt == "en":
        return cl in ("i̇ngilizce", "ingilizce", "english", "en")
    return True


def _build_deterministic(intent: Intent, resolved: list[dict]) -> dict:
    """list_courses + filter — sayısal sorular için."""
    engine = _get_engine()
    if engine is None:
        return {"error": "Veritabanına bağlanılamadı (ComparisonEngine yok)"}
    if not resolved:
        # Tüm üniversiteler için dashboard stats da pratik
        try:
            return {
                "scope": "all_universities",
                "dashboard_stats": engine.get_dashboard_stats(),
            }
        except Exception as e:
            return {"error": f"dashboard_stats alınamadı: {e}"}

    per_uni: list[dict] = []
    f = intent.filters
    for r in resolved:
        try:
            courses = engine.list_courses(r["name"]) or []
        except Exception as e:
            per_uni.append({"university": r["name"], "slug": r["slug"],
                            "error": str(e)})
            continue

        filtered = list(courses)
        if f.course_type:
            filtered = [c for c in filtered if (c.get("type") or "").lower() == f.course_type]
        if f.semester is not None:
            filtered = [c for c in filtered if c.get("semester") == f.semester]
        if f.language:
            filtered = [c for c in filtered if _language_matches(c.get("language"), f.language)]

        per_uni.append({
            "university": r["name"],
            "slug": r["slug"],
            "total_courses": len(courses),
            "filtered_count": len(filtered),
            "sample_filtered": filtered[:MAX_COURSES_PER_UNI],
        })
    return {
        "per_university": per_uni,
        "filters_applied": f.model_dump(),
    }


def _build_comparison(intent: Intent, resolved: list[dict]) -> dict:
    """Uygun /api/compare/* metodunu çağır."""
    engine = _get_engine()
    if engine is None:
        return {"error": "Veritabanına bağlanılamadı"}
    if len(resolved) < 2:
        return {
            "error": "Karşılaştırma için en az iki üniversite gerekli",
            "resolved": resolved,
        }
    uni1, uni2 = resolved[0]["name"], resolved[1]["name"]
    top_n = intent.top_k

    metric_map = {
        "courses":
            lambda: engine.find_similar_courses(uni1, uni2, top_n=top_n),
        "staff":
            lambda: engine.compare_staff(uni1, uni2),
        "workload":
            lambda: engine.compare_workload(uni1, uni2),
        "program-outcomes":
            lambda: engine.compare_program_outcomes(uni1, uni2, top_n=top_n),
        "curriculum-coverage":
            lambda: engine.compare_curriculum_coverage(uni1, uni2, top_n=top_n),
        "prerequisites":
            lambda: engine.compare_prerequisites(uni1, uni2),
        "semester-distribution":
            lambda: engine.compare_semester_distribution(uni1, uni2),
        "mandatory-elective":
            lambda: engine.compare_mandatory_elective(uni1, uni2),
        "language-distribution":
            lambda: engine.compare_language_distribution(uni1, uni2),
        "resources":
            lambda: engine.compare_resources(uni1, uni2),
    }

    metric = intent.metric
    if metric == "learning-outcomes":
        return {
            "error": (
                "learning-outcomes iki spesifik ders kodu ister; "
                "router bu sorudan kodu çıkaramıyor. comparison başka metrik "
                "dene."
            ),
        }

    if metric and metric in metric_map:
        try:
            return {"metric": metric, "uni1": uni1, "uni2": uni2,
                    "result": metric_map[metric]()}
        except Exception as e:
            logger.exception("Comparison '%s' başarısız", metric)
            return {"metric": metric, "error": str(e)}

    # metric yoksa → composite score (hepsi birden)
    try:
        return {"metric": "composite", "uni1": uni1, "uni2": uni2,
                "result": engine.get_composite_score(uni1, uni2)}
    except Exception as e:
        return {"error": f"Composite alınamadı: {e}"}


def _build_semantic(intent: Intent) -> dict:
    """FAISS semantik arama."""
    searcher = _get_searcher()
    if searcher is None:
        return {"error": "Semantik index yok; builder ile önce oluştur"}
    query = (intent.semantic_query or "").strip()
    if not query:
        return {"error": "semantic_query boş"}

    hits = searcher.search(
        query=query,
        top_k=intent.top_k,
        university_filter=intent.universities or None,
    )
    return {
        "query": query,
        "total_hits": len(hits),
        "results": hits,
    }


def _build_detail(intent: Intent, resolved: list[dict]) -> dict:
    """Spesifik ders/üniversite detayı.

    Strateji:
        - Üniversite verildiyse: o bölümün özeti + örnek dersler.
        - Üniversite yok ama semantic_query varsa: top-5 semantik arama.
        - Hiçbiri yoksa: açık hata.
    """
    if resolved:
        engine = _get_engine()
        if engine is None:
            return {"error": "Veritabanına bağlanılamadı"}
        out: list[dict] = []
        for r in resolved:
            try:
                courses = engine.list_courses(r["name"]) or []
                out.append({
                    "university": r["name"],
                    "slug": r["slug"],
                    "course_count": len(courses),
                    "sample_courses": courses[:MAX_COURSES_PER_UNI],
                })
            except Exception as e:
                out.append({"university": r["name"], "error": str(e)})
        return {"per_university": out}

    if intent.semantic_query:
        return {"fallback": "semantic_search", **_build_semantic(intent)}

    return {"error": "Hangi ders veya üniversite? Soruda spesifik bir şey bulunamadı."}


def _build_general() -> dict:
    """Statik sistem bilgisi."""
    unis = list(_slug_to_name_map().values())
    return {
        "system": "UniCurriculum",
        "description": (
            "Türk üniversitelerinin bilgisayar / yazılım mühendisliği ve "
            "YBS bölümlerinin müfredatlarını Neo4j knowledge graph ve "
            "NLP embedding'leri ile 11 metrik üzerinden karşılaştıran "
            "sistem."
        ),
        "data_source": (
            "data/*.json (her üniversite ayrı dosya) → Neo4j'ye ingest "
            "edilip ders/öğrenim çıktısı/konu embedding'leri üretiliyor. "
            "FAISS ayrı katman: chat/semantik arama için."
        ),
        "available_universities": unis,
        "available_universities_count": len(unis),
        "available_metrics": [
            "courses", "staff", "workload", "program-outcomes",
            "learning-outcomes", "curriculum-coverage",
            "prerequisites", "semester-distribution",
            "mandatory-elective", "language-distribution", "resources",
        ],
    }


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC
# ═══════════════════════════════════════════════════════════════════════════

def build_context(intent: Intent) -> dict:
    """Intent → yapısal veri dict (LLM girdisi).

    Dönüş şeması:
        {
          "intent_type": "...",
          "universities_found": ["metu", ...],
          "universities_missing": [...],   # LLM uydurmasın diye
          # intent.type'a göre:
          "data": {...}                    # deterministic
          "comparison": {...}              # comparison
          "related_courses": [...]         # comparison + needs_embedding
          "search_results": {...}          # semantic
          "detail": {...}                  # detail
          "system_info": {...}             # general
        }
    """
    found, missing = _resolve_universities(intent)

    ctx: dict[str, Any] = {
        "intent_type": intent.type,
        "universities_found": [r["slug"] for r in found],
    }
    if missing:
        # LLM "bu üni verimizde yok" bilgisini ileteceğiz — MD #7
        ctx["universities_missing"] = missing

    if intent.type == "deterministic":
        ctx["data"] = _build_deterministic(intent, found)

    elif intent.type == "comparison":
        ctx["comparison"] = _build_comparison(intent, found)
        if intent.needs_embedding and intent.semantic_query:
            ctx["related_courses"] = _build_semantic(intent)

    elif intent.type == "semantic":
        ctx["search_results"] = _build_semantic(intent)

    elif intent.type == "detail":
        ctx["detail"] = _build_detail(intent, found)

    else:  # general
        ctx["system_info"] = _build_general()

    return ctx
