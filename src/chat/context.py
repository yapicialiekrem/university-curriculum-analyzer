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
    """data/**/*.json → {slug_canonical: university_name}. Cached.

    v2: rglob — data/{bilgisayar,yazilim,ybs}/<slug>.json yapısı için.
    v3: Türkçe karakterli slug'lar (sabancı, fırat, ytü) ASCII fold ile
        canonical key'e mapleniyor + orijinal lower slug da alias olarak
        eklenir, böylece her iki form da resolve eder.
    Field fallback: university_name → uni_name (eski şema).
    """
    # Geç import — analytics modülü ile karşılıklı bağımlılık olmasın
    from analytics.loader import ascii_fold

    mapping: dict[str, str] = {}
    if not DATA_DIR.exists():
        logger.warning("Data dir yok: %s", DATA_DIR)
        return mapping
    # data/ranking/*.json gibi yardımcı dosyalar list-of-objects formatı —
    # üniversite şeması değil, atla.
    valid_folders = {"bilgisayar", "yazilim", "ybs"}
    for path in DATA_DIR.rglob("*.json"):
        if not path.is_file():
            continue
        if path.parent.name not in valid_folders:
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                d = json.load(f)
        except Exception as e:
            logger.warning("%s okunamadı: %s", path.name, e)
            continue
        if not isinstance(d, dict):
            continue
        name = d.get("university_name") or d.get("uni_name")
        if not name:
            continue
        original = path.stem.lower()
        canonical = ascii_fold(path.stem)
        mapping[canonical] = name
        if original != canonical:
            mapping[original] = name
    return mapping


def _resolve_uni(slug: str) -> Optional[str]:
    """Slug'ı resmi üniversite adına çevir (ASCII fold dahil)."""
    from analytics.loader import ascii_fold
    s = (slug or "").strip()
    if not s:
        return None
    m = _slug_to_name_map()
    return m.get(ascii_fold(s)) or m.get(s.lower())


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

    # Store erişimi — program_outcomes JSON'dan çekilir (deterministic
    # tek-uni soruları "X'in PO'larını listele" gibi sorguları kapsasın)
    try:
        from analytics.loader import get_store
    except ImportError:
        from src.analytics.loader import get_store  # type: ignore
    store = get_store()
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

        uni_doc = store.get(r["slug"]) or {}
        program_outcomes = uni_doc.get("program_outcomes") or []
        if not isinstance(program_outcomes, list):
            program_outcomes = []
        # Akademik kadro (staff) — "X üni'sinin prof sayısı" gibi sorularda
        # gerekli; deterministic intent şu ana dek staff'ı pass etmiyordu
        # ve LLM "verimizde yok" yalan cevap üretiyordu.
        staff = uni_doc.get("academic_staff") or {}
        if not isinstance(staff, dict):
            staff = {}
        # Modernity / dil / ranking — özet bilgiler
        summary = uni_doc.get("_summary") or {}
        try:
            from api.ranking import get_ranking
        except ImportError:
            try:
                from src.api.ranking import get_ranking  # type: ignore
            except Exception:
                get_ranking = None  # type: ignore
        ranking = None
        if get_ranking is not None:
            try:
                ranking = get_ranking(
                    slug=r["slug"],
                    department=uni_doc.get("_department"),
                    university_name=uni_doc.get("university_name") or uni_doc.get("uni_name"),
                )
            except Exception:
                ranking = None

        per_uni.append({
            "university": r["name"],
            "slug": r["slug"],
            "total_courses": len(courses),
            "filtered_count": len(filtered),
            "language": uni_doc.get("language"),
            "modernity_score": summary.get("modernity_score"),
            "english_resources_ratio": summary.get("english_resources_ratio"),
            "academic_staff": staff,
            "ranking_sira": (ranking or {}).get("basari_sirasi"),
            "ranking_kontenjan": (ranking or {}).get("yerlesen_sayisi"),
            "program_outcomes": program_outcomes,
            "sample_filtered": filtered[:10],
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

    # 0) Her üni için temsili ders örnekleri — LLM citation üretebilsin diye.
    # Kategori filter'ı varsa o kategorideki dersleri öne çıkar; yoksa AKTS
    # ağırlıklı top 5 zorunlu ders (her uni başına).
    engine = _get_engine()
    if engine is not None:
        cat_filter = intent.filters.category
        sample_per_uni: list[dict] = []
        for r in resolved:
            try:
                courses = engine.list_courses(r["name"]) or []
            except Exception:
                continue
            if not courses:
                continue
            # Kategori filter varsa onunla, yoksa zorunlu AKTS yüksek dersler
            picked = []
            if cat_filter:
                picked = [
                    c for c in courses
                    if cat_filter in (c.get("categories") or [])
                ]
            if not picked:
                picked = [c for c in courses if c.get("type") == "zorunlu"]
            picked.sort(key=lambda c: -float(c.get("ects") or 0))
            sample_per_uni.append({
                "university": r["name"],
                "slug": r["slug"],
                "courses": [
                    {
                        "code": c.get("code"),
                        "name": c.get("name"),
                        "ects": c.get("ects"),
                        "categories": c.get("categories", []),
                    }
                    for c in picked[:5]
                ],
            })
        if sample_per_uni:
            out["sample_courses"] = sample_per_uni

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


def _find_course_in_store(course_code: str, prefer_uni_slug: Optional[str] = None) -> Optional[dict]:
    """Verilen ders kodunu tüm üniversitelerin courses[] listesinde ara.

    Eşleşme: kod normalize edilir (boşluk + büyük/küçük). prefer_uni_slug
    verilirse ÖNCE oradan ara (kullanıcı "ODTÜ CENG 213" derse ODTÜ'nün
    DATA STRUCTURES'ını döndür, İYTE'nin Theory of Computation'ını değil).
    Aynı kod iki uni'de farklı isimlerle olabiliyor.
    """
    try:
        from analytics.loader import get_store
    except ImportError:
        try:
            from src.analytics.loader import get_store  # type: ignore
        except Exception:
            return None
    store = get_store()
    target = course_code.replace(" ", "").upper().strip()
    # Tercih edilen üni'yi sona koymaktan önce; ilk olarak onu kontrol et
    all_slugs = store.list_slugs(department=None)
    ordered_slugs = []
    if prefer_uni_slug:
        pref = prefer_uni_slug.strip().lower()
        if pref in all_slugs:
            ordered_slugs.append(pref)
    ordered_slugs.extend(s for s in all_slugs if s not in ordered_slugs)
    for slug in ordered_slugs:
        uni = store.get(slug)
        if not uni:
            continue
        for c in uni.get("courses") or []:
            code = (c.get("code") or "").replace(" ", "").upper()
            if code == target:
                return {
                    "code": c.get("code"),
                    "name": c.get("name"),
                    "ects": c.get("ects"),
                    "semester": c.get("semester"),
                    "type": c.get("type"),
                    "language": c.get("language"),
                    "description": c.get("description"),
                    "purpose": c.get("purpose"),
                    "weekly_topics": c.get("weekly_topics") or [],
                    "learning_outcomes": c.get("learning_outcomes") or [],
                    "prerequisites": c.get("prerequisites") or [],
                    "resources": c.get("resources") or [],
                    "categories": (c.get("_enriched") or {}).get("categories") or [],
                    "bloom_level": (c.get("_enriched") or {}).get("bloom_level"),
                    "modernity_score": (c.get("_enriched") or {}).get("modernity_score"),
                    "university": uni.get("university_name") or uni.get("uni_name"),
                    "university_slug": slug,
                }
    return None


def _extract_course_code(text: str) -> Optional[str]:
    """Soru metninde tipik ders kodu pattern'lerini ara.
    "CENG 483", "cs101", "BIL 372", "MATH-260" hepsini yakalar.
    """
    import re
    m = re.search(r"\b([A-Za-zĞğÜüŞşİıÖöÇç]{2,5})[\s\-]?(\d{3,4})\b", text)
    if not m:
        return None
    return f"{m.group(1).upper()} {m.group(2)}"


def _build_detail(intent: Intent, resolved: list[dict], question: Optional[str] = None) -> dict:
    """Spesifik ders/üniversite detayı.

    Strateji:
        1. Sorudan ders kodu çıkarsa: tam ders detayı (haftalık konular,
           öğrenim çıktıları, önkoşullar, kaynak, Bloom seviyesi).
        2. Üniversite verildiyse: o bölümün özeti + örnek dersler.
        3. Üniversite yok ama semantic_query varsa: top-5 semantik arama.
        4. Hiçbiri yoksa: açık hata.
    """
    # 1) Ders kodu detect — orijinal soru, semantic_query, ya da semantic search
    code_hint = None
    for source in (question, intent.semantic_query):
        if source:
            code_hint = _extract_course_code(source)
            if code_hint:
                break
    if code_hint:
        # Eğer kullanıcı üni belirttiyse onu öncele (örn "ODTÜ CENG 213"
        # → ODTÜ'nün DATA STRUCTURES'ı, İYTE'nin Theory'i değil)
        prefer = resolved[0]["slug"] if resolved else None
        course = _find_course_in_store(code_hint, prefer_uni_slug=prefer)
        if course:
            return {"course": course}

    if resolved:
        engine = _get_engine()
        if engine is None:
            return {"error": "Veritabanına bağlanılamadı"}
        # Store erişimi — program_outcomes JSON'dan çekilir
        try:
            from analytics.loader import get_store
        except ImportError:
            from src.analytics.loader import get_store  # type: ignore
        store = get_store()
        out: list[dict] = []
        for r in resolved:
            try:
                courses = engine.list_courses(r["name"]) or []
                uni_doc = store.get(r["slug"]) or {}
                program_outcomes = uni_doc.get("program_outcomes") or []
                if not isinstance(program_outcomes, list):
                    program_outcomes = []
                staff = uni_doc.get("academic_staff") or {}
                if not isinstance(staff, dict):
                    staff = {}
                summary = uni_doc.get("_summary") or {}
                # Önemli alanlar (staff/PO/özet) ÖNCE — sample_courses uzun
                # ve context truncate (8000 char) durumunda alta düşse bile
                # ana bilgi LLM'e ulaşır.
                out.append({
                    "university": r["name"],
                    "slug": r["slug"],
                    "course_count": len(courses),
                    "language": uni_doc.get("language"),
                    "modernity_score": summary.get("modernity_score"),
                    "academic_staff": staff,
                    "program_outcomes": program_outcomes,
                    "sample_courses": courses[:10],
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

# ═══════════════════════════════════════════════════════════════════════════
# ADVISORY — Tavsiye / yönlendirme kolu
# ═══════════════════════════════════════════════════════════════════════════

def _build_advisory(intent: Intent) -> dict:
    """Tavsiye intent'i için cross-üniversite veri toplar.

    Pipeline:
      1) Tüm üniversiteleri yükle (analytics store)
      2) Hedef kategoriler için specialization_depth (ders + AKTS)
      3) data/ranking/ → YKS başarı sırası
      4) Skorla:
           specialization_score (0-60): hedef kategorilerdeki AKTS toplamı
                                          mevcut max'a normalize edildi
           rank_match_score (0-40): user_rank verilmişse, üni sıralaması
                                      ile mesafe inverse (≤ %50 fark = full)
                                      verilmemişse 0 (skor 60'lık olur)
      5) Top 5 aday + her biri için 2-4 kısa "reason" döner

    Bu fonksiyon LLM kullanmaz; serbest metni üretmek answer prompt'unun işi.
    """
    # Geç importlar — circular dependency önle
    try:
        from analytics.loader import get_store
    except ImportError:
        try:
            from src.analytics.loader import get_store
        except Exception as e:
            return {"error": f"analytics store yüklenemedi: {e}"}

    try:
        from api.ranking import get_ranking
    except ImportError:
        try:
            from src.api.ranking import get_ranking  # type: ignore
        except Exception:
            get_ranking = None  # ranking yoksa skip edilir

    store = get_store()
    goal_keys = list(intent.goal_categories) or []
    # Hiç goal yoksa heuristik: semantic_query varsa onu kullan, yoksa
    # tüm teknik kategoriler eşit ağırlıkta
    if not goal_keys and intent.filters.category:
        goal_keys = [_router_to_enrichment(intent.filters.category)]

    candidates: list[dict] = []
    for slug in store.list_slugs(department=None):
        uni = store.get(slug)
        if not uni:
            continue
        summary = uni.get("_summary") or {}
        spec = summary.get("specialization_depth") or {}

        # Hedef kategorilerin AKTS + ders toplamı (advisory ratings)
        goal_courses = 0
        goal_ects = 0
        per_goal: list[dict] = []
        cats_for_score = goal_keys if goal_keys else list(spec.keys())
        for cat in cats_for_score:
            entry = spec.get(cat) or {}
            req_n = int(entry.get("required") or 0)
            el_n = int(entry.get("elective") or 0)
            n = req_n + el_n
            # AKTS — _summary'de yoksa courses üzerinden hesapla
            ects = _compute_category_ects(uni, cat)
            goal_courses += n
            goal_ects += ects
            per_goal.append({
                "category": cat,
                "courses": n,
                "ects": ects,
                "required": req_n,
                "elective": el_n,
            })

        ranking = None
        if get_ranking is not None:
            try:
                ranking = get_ranking(
                    slug=slug,
                    department=uni.get("_department"),
                    university_name=uni.get("university_name") or uni.get("uni_name"),
                )
            except Exception:
                ranking = None

        candidates.append({
            "slug": slug,
            "name": uni.get("university_name") or uni.get("uni_name") or slug,
            "department": uni.get("department"),
            "department_code": uni.get("_department"),
            "language": uni.get("language"),
            "ranking_sira": (ranking or {}).get("basari_sirasi"),
            "ranking_kontenjan": (ranking or {}).get("yerlesen_sayisi"),
            "goal_courses": goal_courses,
            "goal_ects": goal_ects,
            "per_goal": per_goal,
            "modernity_score": summary.get("modernity_score"),
            "english_resources_ratio": summary.get("english_resources_ratio"),
            "academic_staff_total": _count_staff(uni),
        })

    # Skorla
    max_ects = max((c["goal_ects"] for c in candidates), default=1) or 1
    user_rank = intent.user_rank
    for c in candidates:
        spec_score = round(60 * (c["goal_ects"] / max_ects))
        if user_rank and c["ranking_sira"]:
            # %50 mesafe içinde tam puan; %200 dışı → 0
            ratio = abs(c["ranking_sira"] - user_rank) / max(user_rank, 1)
            if ratio <= 0.5:
                rank_score = 40
            elif ratio <= 1.0:
                rank_score = 25
            elif ratio <= 2.0:
                rank_score = 10
            else:
                rank_score = 0
        elif user_rank and not c["ranking_sira"]:
            rank_score = 0  # bilinmeyen → skip
        else:
            rank_score = 0  # rank yok → spec ağırlıklı
        c["fit_score"] = min(100, spec_score + rank_score)

        # Reasons üret — frontend ve LLM için makinece-okunabilir 2-4 not
        reasons: list[str] = []
        if goal_keys:
            tops = sorted(c["per_goal"], key=lambda x: -x["ects"])[:2]
            for t in tops:
                if t["ects"] > 0:
                    cat_label = _category_label(t["category"])
                    reasons.append(
                        f"{cat_label} alanında {t['courses']} ders, {t['ects']} AKTS"
                    )
        if c["ranking_sira"] is not None:
            r_str = f"YKS başarı sırası ~{c['ranking_sira']:,}".replace(",", ".")
            if user_rank:
                diff = c["ranking_sira"] - user_rank
                if abs(diff) / max(user_rank, 1) <= 0.5:
                    r_str += " (sizin sıralamanıza uygun)"
                elif diff > 0:
                    r_str += " (sizin sıralamanızdan daha düşük puan ister)"
                else:
                    r_str += " (sizin sıralamanızdan daha yüksek puan ister)"
            reasons.append(r_str)
        if c.get("academic_staff_total"):
            reasons.append(f"Akademik kadro toplam {c['academic_staff_total']} kişi")
        c["reasons"] = reasons[:4]

    candidates.sort(key=lambda c: -c["fit_score"])
    top = candidates[:5]

    return {
        "user_rank": user_rank,
        "goal_categories": goal_keys,
        "candidates": top,
        "total_universities_evaluated": len(candidates),
    }


_ENRICHMENT_CAT_LABELS = {
    "ai_ml": "Yapay Zeka",
    "programming": "Programlama",
    "math": "Matematik",
    "systems": "Sistem",
    "theory": "Hesaplama Kuramı",
    "data_science": "Veri Bilimi",
    "security": "Güvenlik",
    "web_mobile": "Web/Mobil",
    "software_eng": "Yazılım Geliştirme",
    "graphics_vision": "Grafik/Görüntü",
    "distributed": "Dağıtık Sistemler",
    "info_systems": "Bilgi Sistemleri",
}


def _category_label(key: str) -> str:
    return _ENRICHMENT_CAT_LABELS.get(key, key)


def _router_to_enrichment(cat: str) -> str:
    """Router'ın kısa CategoryFilter ('ai') → enrichment key ('ai_ml')."""
    return {
        "ai": "ai_ml",
        "programming": "programming",
        "math": "math",
        "systems": "systems",
        "theory": "theory",
    }.get(cat, cat)


def _compute_category_ects(uni: dict, cat: str) -> int:
    """Verilen üniversite için bir kategorinin (AKTS) toplamı. _enriched kullan."""
    total = 0
    for c in uni.get("courses") or []:
        enr = c.get("_enriched") or {}
        if cat in (enr.get("categories") or []):
            try:
                total += int(c.get("ects") or 0)
            except (TypeError, ValueError):
                pass
    return total


def _count_staff(uni: dict) -> int:
    s = uni.get("academic_staff") or {}
    if isinstance(s, dict):
        try:
            return int(s.get("total") or 0)
        except (TypeError, ValueError):
            return 0
    return 0


# ═══════════════════════════════════════════════════════════════════════════
# AGGREGATE — Cross-üniversite sıralama (en çok / en az / top N)
# ═══════════════════════════════════════════════════════════════════════════

def _extract_metric(uni: dict, metric: str) -> Optional[float]:
    """Bir üniversite + metrik anahtarı → tek sayı (yoksa None).

    Anahtar formatı:
        staff.professor / staff.total / ...
        summary.modernity_score / summary.total_courses / ...
        spec.<category>.ects / spec.<category>.courses
        ranking.basari_sirasi / ranking.yerlesen_sayisi
        courses_with_prereqs
    """
    summary = uni.get("_summary") or {}
    if metric.startswith("staff."):
        s = uni.get("academic_staff") or {}
        if not isinstance(s, dict):
            return None
        key = metric.split(".", 1)[1]
        try:
            return float(s.get(key) or 0)
        except (TypeError, ValueError):
            return None

    if metric.startswith("summary."):
        key = metric.split(".", 1)[1]
        v = summary.get(key)
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    if metric.startswith("spec."):
        # spec.<category>.<ects|courses>
        parts = metric.split(".", 2)
        if len(parts) < 3:
            return None
        cat, kind = parts[1], parts[2]
        spec = (summary.get("specialization_depth") or {}).get(cat) or {}
        if kind == "courses":
            req = int(spec.get("required") or 0)
            el = int(spec.get("elective") or 0)
            return float(req + el)
        if kind == "ects":
            # AKTS doğrudan _summary'de yok — courses'tan hesapla
            return float(_compute_category_ects(uni, cat))
        return None

    if metric.startswith("ranking."):
        # ranking.json'lardan oku
        try:
            from api.ranking import get_ranking
        except ImportError:
            try:
                from src.api.ranking import get_ranking  # type: ignore
            except Exception:
                return None
        r = get_ranking(
            slug=uni.get("_slug") or "",
            department=uni.get("_department"),
            university_name=uni.get("university_name") or uni.get("uni_name"),
        )
        if not r:
            return None
        key = metric.split(".", 1)[1]
        v = r.get("basari_sirasi") if key == "basari_sirasi" else r.get("yerlesen_sayisi")
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    if metric == "courses_with_prereqs":
        # Önkoşulu olan ders sayısı
        n = 0
        for c in uni.get("courses") or []:
            prereqs = c.get("prerequisites") or []
            if isinstance(prereqs, list) and len(prereqs) > 0:
                n += 1
        return float(n)

    if metric.startswith("bloom."):
        # bloom.remember.pct → %değer (0-100). Her ders _enriched.bloom_distribution
        # alanından AKTS-ağırlıklı toplam.
        parts = metric.split(".")
        if len(parts) < 3:
            return None
        level = parts[1]  # remember/understand/apply/analyze/evaluate/create
        total_weight = 0.0
        weighted_sum = 0.0
        for c in uni.get("courses") or []:
            enr = c.get("_enriched") or {}
            dist = enr.get("bloom_distribution") or {}
            try:
                ects = float(c.get("ects") or 0)
                pct = float(dist.get(level) or 0)
                total_weight += ects
                weighted_sum += ects * pct
            except (TypeError, ValueError):
                continue
        if total_weight <= 0:
            return None
        return round(weighted_sum / total_weight * 100, 1)

    if metric == "resources.unique_count":
        # Tüm derslerde geçen unique kaynak sayısı (kitap/makale)
        seen: set[str] = set()
        for c in uni.get("courses") or []:
            for r in c.get("resources") or []:
                if isinstance(r, str) and r.strip():
                    seen.add(r.strip().lower())
        return float(len(seen))

    if metric == "language.english_courses":
        return float(_count_courses_by_lang(uni, "english"))
    if metric == "language.turkish_courses":
        return float(_count_courses_by_lang(uni, "turkish"))

    return None


def _count_courses_by_lang(uni: dict, target: str) -> int:
    """Hedef dile göre ders sayısı. target = "english" | "turkish"."""
    en_set = {"i̇ngilizce", "ingilizce", "english", "en"}
    tr_set = {"türkçe", "turkce", "turkish", "tr"}
    target_set = en_set if target == "english" else tr_set
    n = 0
    for c in uni.get("courses") or []:
        lang = (c.get("language") or "").strip().lower()
        if lang in target_set:
            n += 1
    return n


_METRIC_LABELS: dict[str, str] = {
    "staff.professor": "Profesör sayısı",
    "staff.associate_professor": "Doçent sayısı",
    "staff.assistant_professor": "Dr. öğretim üyesi sayısı",
    "staff.lecturer": "Öğretim görevlisi sayısı",
    "staff.research_assistant": "Araştırma görevlisi sayısı",
    "staff.total": "Toplam akademik kadro",
    "summary.total_courses": "Toplam ders sayısı",
    "summary.modernity_score": "Güncellik skoru",
    "summary.english_resources_ratio": "İngilizce kaynak oranı",
    "summary.project_heavy_course_count": "Proje ağırlıklı ders sayısı",
    "summary.total_project_ects": "Proje toplam AKTS",
    "ranking.basari_sirasi": "YKS başarı sırası (düşük = seçici)",
    "ranking.yerlesen_sayisi": "Yerleşen kişi sayısı (kontenjan)",
    "courses_with_prereqs": "Önkoşulu olan ders sayısı",
    "bloom.remember.pct": "Hatırla seviyesi yoğunluğu (%)",
    "bloom.understand.pct": "Anla seviyesi yoğunluğu (%)",
    "bloom.apply.pct": "Uygula seviyesi yoğunluğu (%)",
    "bloom.analyze.pct": "Analiz et seviyesi yoğunluğu (%)",
    "bloom.evaluate.pct": "Değerlendir seviyesi yoğunluğu (%)",
    "bloom.create.pct": "Yarat seviyesi yoğunluğu (%)",
    "resources.unique_count": "Farklı kaynak (kitap/makale) sayısı",
    "language.english_courses": "İngilizce ders sayısı",
    "language.turkish_courses": "Türkçe ders sayısı",
}


def _metric_label(metric: str) -> str:
    if metric in _METRIC_LABELS:
        return _METRIC_LABELS[metric]
    if metric.startswith("spec."):
        parts = metric.split(".", 2)
        if len(parts) == 3:
            cat = _category_label(parts[1])
            kind = "AKTS" if parts[2] == "ects" else "ders sayısı"
            return f"{cat} {kind}"
    return metric


# Integer (whole-number) tabanlı metrikler — LLM'e ".0" değil tam sayı
# göndermek için. Bloom % ve ratio dışı her şey count.
_INT_METRICS: set[str] = {
    "staff.professor", "staff.associate_professor", "staff.assistant_professor",
    "staff.lecturer", "staff.research_assistant", "staff.total",
    "summary.total_courses", "summary.modernity_score",
    "summary.project_heavy_course_count", "summary.total_project_ects",
    "ranking.basari_sirasi", "ranking.yerlesen_sayisi",
    "courses_with_prereqs",
    "resources.unique_count",
    "language.english_courses", "language.turkish_courses",
}


def _build_aggregate(intent: Intent) -> dict:
    """Tüm üniversiteleri verilen metrik üzerinden sıralar.

    Pipeline:
      1) Enrichment store'dan üniversiteleri yükle (department filter ops.)
      2) Her üni için _extract_metric → tek sayı
      3) None değerleri at; integer metrikler için round
      4) order'a göre sırala, top_n al
      5) Dönüş: {metric, label, ranked: [{slug,name,value}], total_evaluated}
    """
    metric = intent.aggregate_metric
    if not metric:
        return {"error": "Hangi metrik üzerinden sıralanacağı belirtilmedi."}

    try:
        from analytics.loader import get_store
    except ImportError:
        try:
            from src.analytics.loader import get_store  # type: ignore
        except Exception as e:
            return {"error": f"analytics store yüklenemedi: {e}"}

    store = get_store()
    rows: list[dict] = []
    for slug in store.list_slugs(department=intent.aggregate_department):
        uni = store.get(slug)
        if not uni:
            continue
        v = _extract_metric(uni, metric)
        if v is None:
            continue
        # Integer metriklerde değeri tam sayı olarak ilet → LLM ".0" yazmasın
        if metric in _INT_METRICS:
            v = int(round(v))
        rows.append({
            "slug": slug,
            "name": uni.get("university_name") or uni.get("uni_name") or slug,
            "department": uni.get("department"),
            "department_code": uni.get("_department"),
            "value": v,
        })

    reverse = intent.aggregate_order == "desc"
    rows.sort(key=lambda r: (r["value"] is None, -r["value"] if reverse else r["value"]))
    ranked = rows[: intent.aggregate_top_n]

    return {
        "metric": metric,
        "metric_label": _metric_label(metric),
        "order": intent.aggregate_order,
        "department_filter": intent.aggregate_department,
        "ranked": ranked,
        "total_evaluated": len(rows),
    }


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC
# ═══════════════════════════════════════════════════════════════════════════

def build_context(intent: Intent, question: Optional[str] = None) -> dict:
    """Intent → yapısal veri dict (LLM girdisi).

    `question` parametresi opsiyoneldir; geçilirse detail builder'da ders kodu
    extraction için orijinal metni de tarar (router semantic_query alanını
    bazen boş bırakır).

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
          "advisory": {...}                # advisory
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
        ctx["detail"] = _build_detail(intent, found, question=question)

    elif intent.type == "advisory":
        ctx["advisory"] = _build_advisory(intent)

    elif intent.type == "aggregate":
        ctx["aggregate"] = _build_aggregate(intent)

    else:  # general
        ctx["system_info"] = _build_general()

    return ctx
