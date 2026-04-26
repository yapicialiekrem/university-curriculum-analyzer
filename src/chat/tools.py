"""
tools.py — LLM function-calling araçları (Hibrit yaklaşım).

Mevcut intent pipeline (deterministic / aggregate / semantic / advisory /
detail) basit soruları hızlı yanıtlar (~5sn, tek LLM çağrısı). Karmaşık
soruları (oranlar, multi-step kompozisyon, mevcut metric'lerin türevleri)
LLM tools ile çözer.

Akış:
    user: "AI'da zorunlu/seçmeli AKTS oranı en yüksek üni?"
    router: type="complex"
    tools_loop:
        1) LLM → aggregate_universities(metric="spec.ai_ml.ects")
                  + aggregate_universities(metric="spec.ai_ml.elective_ects")
        2) backend → 2 sıralama listesi döner
        3) LLM → oranı hesaplar, en yüksek 5'i sıralar
        4) LLM → final cevap (Türkçe metin + citations + dashboard_update)

Maksimum 5 iterasyon; sonra zorla cevap üret.

Kullanım (answer.py'dan):
    from chat.tools import TOOL_SCHEMAS, execute_tool
    response = client.chat.completions.create(
        model=...,
        messages=[...],
        tools=TOOL_SCHEMAS,
    )
    if response.choices[0].message.tool_calls:
        for call in response.choices[0].message.tool_calls:
            result = execute_tool(call.function.name, json.loads(call.function.arguments))
            ...
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .schemas import Intent

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# TOOL SCHEMAS — OpenAI function-calling format
# ═══════════════════════════════════════════════════════════════════════════

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "aggregate_universities",
            "description": (
                "Tüm 51 üniversite arasında verilen metrik üzerinden sıralama "
                "yapar. 'En çok / en az / top N' tipi sorularda kullan. "
                "Birden fazla metric istersen ayrı ayrı çağrılabilir."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "metric": {
                        "type": "string",
                        "description": (
                            "Metric path. Örnekler: "
                            "staff.professor, staff.total, "
                            "summary.modernity_score, summary.project_heavy_course_count, "
                            "spec.ai_ml.ects, spec.ai_ml.courses, "
                            "spec.data_science.ects, spec.security.ects, "
                            "ranking.basari_sirasi (asc kullan), "
                            "courses_with_prereqs, "
                            "bloom.create.pct, language.english_courses"
                        ),
                    },
                    "order": {
                        "type": "string",
                        "enum": ["asc", "desc"],
                        "description": (
                            "asc → en az/düşük (YKS başarı sırası için kullan), "
                            "desc → en çok/yüksek (default)"
                        ),
                    },
                    "top_n": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20,
                        "description": "Kaç üni döndürülsün (default 5)",
                    },
                    "department": {
                        "type": "string",
                        "enum": ["bilmuh", "yazmuh", "ybs"],
                        "description": "Bölüm filtresi (opsiyonel)",
                    },
                },
                "required": ["metric"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_specialization",
            "description": (
                "Tek bir üniversitenin spesifik kategorideki uzmanlaşma "
                "ayrıntısını döndürür: zorunlu ve seçmeli ders sayısı + AKTS, "
                "ayrı ayrı. Oran/karşılaştırma hesapları için kullan."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {
                        "type": "string",
                        "description": "Üniversite slug (metu, bilkent, ege...)",
                    },
                    "category": {
                        "type": "string",
                        "description": (
                            "Enrichment kategorisi: ai_ml, programming, math, systems, "
                            "theory, data_science, security, web_mobile, software_eng, "
                            "graphics_vision, distributed, info_systems"
                        ),
                    },
                },
                "required": ["slug", "category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_courses_by_topic",
            "description": (
                "Doğal dil sorguyla en yakın dersleri bulur (FAISS embedding "
                "search). Üniversite filtresi opsiyonel."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Türkçe konu metni (örn 'derin öğrenme', 'kriptografi')",
                    },
                    "top_n": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 30,
                    },
                    "university_slugs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Sadece bu üni'lerden ara (opsiyonel)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_course_detail",
            "description": (
                "Spesifik bir ders kodunun tüm detayını döndürür: ad, AKTS, "
                "dönem, dil, amaç, haftalık konular, öğrenme çıktıları, "
                "önkoşullar, kaynaklar. Aynı kod iki üni'de olabileceği "
                "için kullanıcı belirttiyse `university_slug` da geçir."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "course_code": {
                        "type": "string",
                        "description": "Ders kodu (CENG 483, CS 101 gibi)",
                    },
                    "university_slug": {
                        "type": "string",
                        "description": (
                            "Opsiyonel — kullanıcı 'ODTÜ CENG 213' gibi "
                            "üni belirttiyse bu uni'nin slug'ı (metu, bilkent...)"
                        ),
                    },
                },
                "required": ["course_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_university_summary",
            "description": (
                "Tek üniversitenin tam özetini döndürür: dil, öğretim üyesi "
                "sayıları, YKS sıralaması, kategori bazlı uzmanlaşma derinliği, "
                "Bloom seviyesi dağılımı, modernity skoru. Karşılaştırmasız "
                "tek-uni soruları için."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {
                        "type": "string",
                        "description": "Üniversite slug",
                    },
                },
                "required": ["slug"],
            },
        },
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# EXECUTOR — Tool name → backend builder dispatch
# ═══════════════════════════════════════════════════════════════════════════

def execute_tool(name: str, args: dict[str, Any]) -> dict:
    """Tool adı + arg'ları → backend sonucu (dict).

    Hata durumunda {"error": "..."} döner — LLM bunu görüp kendi düzeltir.
    """
    try:
        if name == "aggregate_universities":
            return _exec_aggregate(args)
        if name == "get_specialization":
            return _exec_specialization(args)
        if name == "find_courses_by_topic":
            return _exec_topic_search(args)
        if name == "get_course_detail":
            return _exec_course_detail(args)
        if name == "get_university_summary":
            return _exec_university_summary(args)
        return {"error": f"Bilinmeyen tool: {name}"}
    except Exception as e:
        logger.exception("Tool '%s' patladı", name)
        return {"error": f"{type(e).__name__}: {e}"}


def _exec_aggregate(args: dict) -> dict:
    from .context import _build_aggregate
    intent = Intent(
        type="aggregate",
        aggregate_metric=args.get("metric"),
        aggregate_order=args.get("order", "desc"),
        aggregate_top_n=int(args.get("top_n", 5)),
        aggregate_department=args.get("department"),
    )
    result = _build_aggregate(intent)
    # Sadece LLM'in ihtiyacı olan compact alanları döndür
    return {
        "metric": result.get("metric"),
        "metric_label": result.get("metric_label"),
        "order": result.get("order"),
        "ranked": result.get("ranked", []),
        "total_evaluated": result.get("total_evaluated"),
    }


def _exec_specialization(args: dict) -> dict:
    """Bir üni × kategori için zorunlu/seçmeli ders sayısı + AKTS."""
    from .context import _compute_category_ects
    try:
        from analytics.loader import get_store
    except ImportError:
        from src.analytics.loader import get_store  # type: ignore

    slug = args.get("slug", "").strip().lower()
    cat = args.get("category", "").strip()
    store = get_store()
    uni = store.get(slug)
    if not uni:
        return {"error": f"Üniversite bulunamadı: {slug}"}

    summary = uni.get("_summary") or {}
    spec = (summary.get("specialization_depth") or {}).get(cat) or {}
    if not spec:
        return {
            "slug": slug,
            "name": uni.get("university_name") or slug,
            "category": cat,
            "required_courses": 0,
            "elective_courses": 0,
            "required_ects": 0,
            "elective_ects": 0,
            "note": "Bu üni'de bu kategoride ders yok.",
        }

    # Zorunlu/seçmeli AKTS ayrımı için _enriched üzerinden tarayalım
    req_ects = 0
    el_ects = 0
    for c in uni.get("courses") or []:
        enr = c.get("_enriched") or {}
        if cat not in (enr.get("categories") or []):
            continue
        try:
            ects = int(c.get("ects") or 0)
        except (TypeError, ValueError):
            ects = 0
        if c.get("type") == "zorunlu":
            req_ects += ects
        elif c.get("type") == "secmeli":
            el_ects += ects

    return {
        "slug": slug,
        "name": uni.get("university_name") or slug,
        "category": cat,
        "required_courses": int(spec.get("required") or 0),
        "elective_courses": int(spec.get("elective") or 0),
        "required_ects": req_ects,
        "elective_ects": el_ects,
    }


def _exec_topic_search(args: dict) -> dict:
    from .context import _get_searcher
    try:
        from analytics.loader import get_store
    except ImportError:
        from src.analytics.loader import get_store  # type: ignore

    searcher = _get_searcher()
    if not searcher:
        return {"error": "FAISS index hazır değil"}
    query = args.get("query", "")
    top_n = int(args.get("top_n", 10))
    uni_slugs = args.get("university_slugs") or None
    results = searcher.search(
        query=query,
        top_k=top_n,
        university_filter=uni_slugs,
        min_score=0.3,
    )
    # Search index'inde ects yok — LLM "AKTS bilgisi yok" yanılsamasına
    # düşmesin diye her sonuca store'dan ects + semester'ı zenginleştir.
    store = get_store()
    for r in results:
        slug = r.get("university_slug")
        code = r.get("code")
        if not slug or not code:
            continue
        uni = store.get(slug)
        if not uni:
            continue
        for c in uni.get("courses") or []:
            if (c.get("code") or "").strip() == code.strip():
                r["ects"] = c.get("ects")
                if r.get("semester") is None:
                    r["semester"] = c.get("semester")
                break
    return {"query": query, "count": len(results), "results": results}


def _exec_course_detail(args: dict) -> dict:
    from .context import _find_course_in_store
    code = args.get("course_code", "")
    prefer = args.get("university_slug") or None
    course = _find_course_in_store(code, prefer_uni_slug=prefer)
    if not course:
        return {"error": f"Ders bulunamadı: {code}"}
    return {"course": course}


def _exec_university_summary(args: dict) -> dict:
    try:
        from analytics.loader import get_store
    except ImportError:
        from src.analytics.loader import get_store  # type: ignore
    try:
        from api.ranking import get_ranking
    except ImportError:
        try:
            from src.api.ranking import get_ranking  # type: ignore
        except Exception:
            get_ranking = None  # type: ignore

    slug = args.get("slug", "").strip().lower()
    store = get_store()
    uni = store.get(slug)
    if not uni:
        return {"error": f"Üniversite bulunamadı: {slug}"}

    summary = uni.get("_summary") or {}
    staff = uni.get("academic_staff") or {}
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

    program_outcomes = uni.get("program_outcomes") or []
    if not isinstance(program_outcomes, list):
        program_outcomes = []
    return {
        "slug": slug,
        "name": uni.get("university_name") or slug,
        "department": uni.get("department"),
        "department_code": uni.get("_department"),
        "language": uni.get("language"),
        "total_courses": summary.get("total_courses"),
        "modernity_score": summary.get("modernity_score"),
        "english_resources_ratio": summary.get("english_resources_ratio"),
        "project_heavy_course_count": summary.get("project_heavy_course_count"),
        "academic_staff": {
            "professor": staff.get("professor", 0) if isinstance(staff, dict) else 0,
            "associate_professor": staff.get("associate_professor", 0) if isinstance(staff, dict) else 0,
            "assistant_professor": staff.get("assistant_professor", 0) if isinstance(staff, dict) else 0,
            "lecturer": staff.get("lecturer", 0) if isinstance(staff, dict) else 0,
            "research_assistant": staff.get("research_assistant", 0) if isinstance(staff, dict) else 0,
            "total": staff.get("total", 0) if isinstance(staff, dict) else 0,
        },
        "ranking_sira": (ranking or {}).get("basari_sirasi"),
        "ranking_kontenjan": (ranking or {}).get("yerlesen_sayisi"),
        "specialization_depth": summary.get("specialization_depth", {}),
        "program_outcomes": program_outcomes,
    }


def serialize_for_llm(result: dict) -> str:
    """Tool sonucunu LLM'e gidecek JSON metnine çevir, gerekirse kes."""
    s = json.dumps(result, ensure_ascii=False, default=str)
    # Tool output'u 4000 char ile sınırla — LLM context'i koruyalım
    if len(s) > 4000:
        s = s[:4000] + "\n... (kesildi)"
    return s
