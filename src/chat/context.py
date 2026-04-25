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
    """data/**/*.json → {slug_lower: university_name}. Cached.

    v2: rglob — data/{bilgisayar,yazilim,ybs}/<slug>.json yapısı için.
    Field fallback: university_name → uni_name (eski şema).
    """
    mapping: dict[str, str] = {}
    if not DATA_DIR.exists():
        logger.warning("Data dir yok: %s", DATA_DIR)
        return mapping
    for path in DATA_DIR.rglob("*.json"):
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                d = json.load(f)
        except Exception as e:
            logger.warning("%s okunamadı: %s", path.name, e)
            continue
        name = d.get("university_name") or d.get("uni_name")
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
    """FAISS searcher lazy init. Index yoksa None.

    Mevcut main.py `from comparison import ...` flat-import örüntüsünü
    kullanıyor → `src/` sys.path'te. Aynı örüntüye uyuyoruz (önce flat,
    fallback olarak `src.*`).
    """
    try:
        from embeddings.search import get_searcher, IndexNotFoundError
    except ImportError:
        try:
            from src.embeddings.search import get_searcher, IndexNotFoundError
        except Exception as e:
            logger.warning("search modülü import hatası: %s", e)
            return None
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
    """Karşılaştırma context'i — analytics + comparison.py birleşik.

    Strateji:
      1. Analytics modülleri (radar/bloom/coverage/heatmap) — enrichment
         tabanlı zengin veri. Her durumda overall radar dahil edilir
         (LLM'in nereye bakacağına dair fikri olsun).
      2. intent.metric Neo4j-tabanlı bir metrikse (workload, prerequisites,
         vb.) ek olarak ComparisonEngine'den çek.
      3. needs_embedding + semantic_query varsa related_courses ekle.

    Geriye dönük uyum: intent.metric ister yeni isim ('radar', 'bloom',
    'coverage', 'heatmap') ister eski Neo4j ismi ('workload',
    'mandatory-elective', vb.) — ikisini de doğru yöne yönlendiriyoruz.
    """
    if len(resolved) < 2:
        return {
            "error": "Karşılaştırma için en az iki üniversite gerekli",
            "resolved": resolved,
        }
    slugs = [r["slug"] for r in resolved]

    # ── Lazy analytics import (FAZ 1 modülleri) ────────────────────────
    try:
        from analytics import bloom as bloom_mod
        from analytics import coverage as coverage_mod
        from analytics import heatmap as heatmap_mod
        from analytics import radar as radar_mod
    except ImportError:
        # Geriye uyumluluk — paket yoksa
        try:
            from src.analytics import bloom as bloom_mod
            from src.analytics import coverage as coverage_mod
            from src.analytics import heatmap as heatmap_mod
            from src.analytics import radar as radar_mod
        except ImportError:
            radar_mod = bloom_mod = coverage_mod = heatmap_mod = None

    out: dict[str, Any] = {"slugs": slugs}

    # 1) Her zaman radar — LLM "konu kapsamı" hakkında konuşabilsin
    if radar_mod is not None:
        try:
            out["radar"] = radar_mod.compute_radar(slugs)
        except Exception as e:
            out["radar_error"] = str(e)

    # 2) Metrik bazlı ek veri
    metric = intent.metric
    new_metrics = {"radar", "bloom", "coverage", "heatmap"}

    if metric in new_metrics and bloom_mod is not None:
        try:
            if metric == "bloom":
                out["bloom"] = bloom_mod.compute_bloom(slugs)
            elif metric == "coverage":
                out["coverage"] = coverage_mod.compute_coverage(
                    slugs, categories=intent.filters.category and [intent.filters.category]
                )
            elif metric == "heatmap":
                out["heatmap"] = heatmap_mod.compute_semester_heatmap(slugs)
            # radar zaten yukarıda eklendi
        except Exception as e:
            out[f"{metric}_error"] = str(e)

    # 3) Neo4j-bazlı eski metrikler (workload, staff, vs.)
    engine = _get_engine()
    if engine is not None and metric and metric not in new_metrics:
        if metric == "learning-outcomes":
            out["comparison_warning"] = (
                "learning-outcomes iki spesifik ders kodu ister; "
                "router bunu çıkaramadı."
            )
        else:
            uni1_name = resolved[0]["name"]
            uni2_name = resolved[1]["name"]
            top_n = intent.top_k
            metric_map = {
                "courses":
                    lambda: engine.find_similar_courses(uni1_name, uni2_name, top_n=top_n),
                "staff":
                    lambda: engine.compare_staff(uni1_name, uni2_name),
                "workload":
                    lambda: engine.compare_workload(uni1_name, uni2_name),
                "program-outcomes":
                    lambda: engine.compare_program_outcomes(uni1_name, uni2_name, top_n=top_n),
                "curriculum-coverage":
                    lambda: engine.compare_curriculum_coverage(uni1_name, uni2_name, top_n=top_n),
                "prerequisites":
                    lambda: engine.compare_prerequisites(uni1_name, uni2_name),
                "semester-distribution":
                    lambda: engine.compare_semester_distribution(uni1_name, uni2_name),
                "mandatory-elective":
                    lambda: engine.compare_mandatory_elective(uni1_name, uni2_name),
                "language-distribution":
                    lambda: engine.compare_language_distribution(uni1_name, uni2_name),
                "resources":
                    lambda: engine.compare_resources(uni1_name, uni2_name),
            }
            if metric in metric_map:
                try:
                    out["graph_metric"] = {
                        "name": metric, "result": metric_map[metric]()
                    }
                except Exception as e:
                    logger.exception("Comparison '%s' başarısız", metric)
                    out["graph_metric_error"] = str(e)

    # 4) Semantik arama (LLM ders detayı isteyebilir)
    if intent.needs_embedding and intent.semantic_query:
        sem = _build_semantic(intent)
        if sem.get("results"):
            out["related_courses"] = sem["results"][:5]  # context'i şişirme

    return out


def _build_semantic(intent: Intent) -> dict:
    """FAISS semantik arama. v2: kategori + departman filtreleri dahil."""
    searcher = _get_searcher()
    if searcher is None:
        return {"error": "Semantik index yok; builder ile önce oluştur"}
    query = (intent.semantic_query or "").strip()
    if not query:
        return {"error": "semantic_query boş"}

    # Intent filter'larını searcher'a köprüle
    cat_filter = None
    if intent.filters.category:
        cat_filter = [intent.filters.category]

    hits = searcher.search(
        query=query,
        top_k=intent.top_k,
        university_filter=intent.universities or None,
        category_filter=cat_filter,
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
