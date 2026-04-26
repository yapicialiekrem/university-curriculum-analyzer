"""
main.py — FastAPI Backend for Curriculum Comparison System

Provides REST API endpoints for:
    - Listing universities and courses
    - 11 comparison metrics (3 original + 8 new)
    - AI-powered /api/chat (Intent → Context → ChatResponse)

Usage:
    uvicorn main:app --reload

API Docs:
    http://localhost:8000/docs  (Swagger UI)
"""

import logging
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from comparison import ComparisonEngine

# YENİ: AI chat router (ADIM 8)
from api import chat as chat_router
# FAZ 2: enrichment-bazlı endpoint'ler (BACKEND_PROMPT v2)
from api import compare_enriched as compare_enriched_router
from api import search as search_router
from api import universities as universities_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="UniCurriculum — Curriculum Comparison API",
    description=(
        "AI-supported comparison and evaluation system for informatics-based "
        "undergraduate curricula in Türkiye, powered by Neo4j Knowledge Graph "
        "and NLP embeddings. Provides 11 comparison metrics including semantic "
        "similarity, staff analysis, workload, prerequisites, and more."
    ),
    version="2.0.0",
)

# CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared comparison engine instance
engine = ComparisonEngine()


# Routers
app.include_router(chat_router.router)
app.include_router(universities_router.router)        # FAZ 2 — yeniler
app.include_router(compare_enriched_router.router)
app.include_router(search_router.router)


@app.on_event("startup")
async def startup():
    """Backend hazırlık:
      1. EnrichmentStore — 51 üni JSON'unu belleğe al (~21 MB).
      2. FAISS semantic searcher warm-up (model + index preload).
    Hata durumunda warning loglanır, sürec çalışmaya devam eder.
    """
    # 1) EnrichmentStore
    try:
        from analytics.loader import get_store
        store = get_store()
        s = store.stats()
        logger.info(
            "✓ EnrichmentStore: %d üni, %d ders (%d enriched), bilmuh=%d/yazmuh=%d/ybs=%d",
            s["universities"], s["total_courses"], s["enriched_courses"],
            s["by_department"].get("bilmuh", 0),
            s["by_department"].get("yazmuh", 0),
            s["by_department"].get("ybs", 0),
        )
    except Exception as e:
        logger.warning(
            "EnrichmentStore yüklenemedi (%s) — /api/compare/{radar,..} "
            "ve /api/universities başarısız olabilir.", e
        )

    # 2) FAISS searcher
    try:
        from embeddings.search import get_searcher
        get_searcher()
        logger.info("✓ Semantic searcher warm-up tamam")
    except Exception as e:
        logger.warning(
            "Semantic searcher warm-up başarısız (%s) — /api/chat ve "
            "/api/search yine çalışır ama ilk istek yavaş olur.", e
        )


@app.on_event("shutdown")
def shutdown():
    engine.close()


# ---------------------------------------------------------------------------
# Data Endpoints
# ---------------------------------------------------------------------------
# Not: GET /api/universities artık api/universities.py router'ından geliyor
#      (EnrichmentStore tabanlı, daha zengin format). Bu sürüm Neo4j sorgusu;
#      backward-compat için /api/universities-graph altında tuttum.

@app.get("/api/universities-graph", tags=["Data — Legacy"])
def list_universities_graph():
    """[Legacy] Neo4j Knowledge Graph üzerinden üniversite listesi."""
    return engine.list_universities()


@app.get("/api/courses/{university_name}", tags=["Data"])
def list_courses(university_name: str):
    """List all courses offered by a university department."""
    courses = engine.list_courses(university_name)
    if not courses:
        raise HTTPException(
            status_code=404,
            detail=f"No courses found for '{university_name}'.",
        )
    return courses


# ---------------------------------------------------------------------------
# Dashboard Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/dashboard/stats", tags=["Dashboard"])
def dashboard_stats():
    """Get aggregate statistics for the knowledge graph dashboard."""
    return engine.get_dashboard_stats()


@app.get("/api/dashboard/charts/{university_name}", tags=["Dashboard"])
def dashboard_charts(university_name: str):
    """Get chart-ready data for a specific university."""
    data = engine.get_university_chart_data(university_name)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data


@app.get("/api/dashboard/heatmap", tags=["Dashboard"])
def dashboard_heatmap():
    """Get university similarity heatmap matrix."""
    return engine.get_heatmap_data()


@app.get("/api/dashboard/radar", tags=["Dashboard"])
def dashboard_radar():
    """Get radar chart data for multi-axis university comparison."""
    return engine.get_radar_data()


@app.get("/api/dashboard/kg-stats", tags=["Dashboard"])
def dashboard_kg_stats():
    """Get knowledge graph meta-statistics (total nodes, relationships)."""
    return engine.get_kg_meta_stats()


# ---------------------------------------------------------------------------
# Chatbot — ESKİ Groq endpoint'i /api/chat-legacy'e taşındı.
# Yeni /api/chat için bkz. api/chat.py (ADIM 8: Intent → Context → Cevap).
# Eski endpoint backward-compat için hâlâ dönüyor; frontend yeni şemaya
# geçtiğinde kaldırılabilir.
# ---------------------------------------------------------------------------

class LegacyChatRequest(BaseModel):
    message: str


@app.post("/api/chat-legacy", tags=["Chatbot — Legacy"])
def chat_legacy(req: LegacyChatRequest):
    """DEPRECATED — Groq + Neo4j tabanlı eski chatbot. Yerine /api/chat
    (AI pipeline: Intent → Context → ChatResponse) kullan."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    answer = engine.answer_question(req.message)
    return {"question": req.message, "answer": answer}


# ---------------------------------------------------------------------------
# Original Comparison Endpoints (1-3)
# ---------------------------------------------------------------------------

@app.get("/api/compare/courses", tags=["Comparison — Original"])
def compare_courses(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
    top_n: int = Query(10, ge=1, le=100, description="Number of top similar pairs"),
):
    """1️⃣ Course Similarity — Find semantically similar courses via NLP embeddings."""
    results = engine.find_similar_courses(uni1, uni2, top_n=top_n)
    return {
        "university1": uni1,
        "university2": uni2,
        "top_n": top_n,
        "similar_courses": results,
    }


@app.get("/api/compare/staff", tags=["Comparison — Original"])
def compare_staff(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """2️⃣ Staff Comparison — Compare academic staff counts between departments."""
    return engine.compare_staff(uni1, uni2)


@app.get("/api/compare/workload", tags=["Comparison — Original"])
def compare_workload(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """3️⃣ Workload Comparison — Compare average ECTS and theory/practice ratios."""
    return engine.compare_workload(uni1, uni2)


# ---------------------------------------------------------------------------
# New Comparison Endpoints (4-11)
# ---------------------------------------------------------------------------

@app.get("/api/compare/program-outcomes", tags=["Comparison — New"])
def compare_program_outcomes(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
    top_n: int = Query(10, ge=1, le=50, description="Top matching outcome pairs"),
    department: Optional[str] = Query(
        None,
        description="Department code: bilmuh / yazmuh / ybs (aynı üni'de "
        "çoklu programdan karışım yaşanmaması için filter).",
    ),
):
    """4️⃣ Program Outcome Similarity — Semantically compare program (graduation) outcomes."""
    return engine.compare_program_outcomes(
        uni1, uni2, top_n=top_n, department=department
    )


@app.get("/api/compare/learning-outcomes", tags=["Comparison — New"])
def compare_learning_outcomes(
    uni1: str = Query(..., description="First university name"),
    code1: str = Query(..., description="Course code in first university"),
    uni2: str = Query(..., description="Second university name"),
    code2: str = Query(..., description="Course code in second university"),
):
    """5️⃣ Learning Outcome Similarity — Compare learning outcomes of two specific courses."""
    return engine.compare_learning_outcomes(uni1, code1, uni2, code2)


@app.get("/api/compare/curriculum-coverage", tags=["Comparison — New"])
def compare_curriculum_coverage(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
    top_n: int = Query(10, ge=1, le=50, description="Top similar topic pairs"),
):
    """6️⃣ Curriculum Coverage — Compare weekly topics to find covered vs. unique courses."""
    return engine.compare_curriculum_coverage(uni1, uni2, top_n=top_n)


@app.get("/api/compare/prerequisites", tags=["Comparison — New"])
def compare_prerequisites(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """7️⃣ Prerequisite Complexity — Compare prerequisite tree depth and structure."""
    return engine.compare_prerequisites(uni1, uni2)


@app.get("/api/compare/semester-distribution", tags=["Comparison — New"])
def compare_semester_distribution(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """8️⃣ Semester/Year Distribution — Compare ECTS and course distribution by semester."""
    return engine.compare_semester_distribution(uni1, uni2)


@app.get("/api/compare/mandatory-elective", tags=["Comparison — New"])
def compare_mandatory_elective(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """9️⃣ Mandatory vs Elective — Compare mandatory/elective course ratios."""
    return engine.compare_mandatory_elective(uni1, uni2)


@app.get("/api/compare/language-distribution", tags=["Comparison — New"])
def compare_language_distribution(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """🔟 Language Distribution — Compare the language (Turkish/English) mix of courses."""
    return engine.compare_language_distribution(uni1, uni2)


@app.get("/api/compare/resources", tags=["Comparison — New"])
def compare_resources(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """1️⃣1️⃣ Resource Overlap — Find shared textbooks/resources between departments."""
    return engine.compare_resources(uni1, uni2)


@app.get("/api/compare/composite", tags=["Comparison — New"])
def compare_composite(
    uni1: str = Query(..., description="First university name"),
    uni2: str = Query(..., description="Second university name"),
):
    """🏆 Composite Score — Weighted overall similarity from all metrics."""
    return engine.get_composite_score(uni1, uni2)


# ---------------------------------------------------------------------------
# Frontend (Static Files)
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def root():
    """Redirect root to the frontend UI."""
    return RedirectResponse(url="/ui/index.html")


# Mount static files AFTER all API routes
app.mount("/ui", StaticFiles(directory="static"), name="static")
