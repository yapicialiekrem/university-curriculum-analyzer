"""
search.py — POST /api/search semantic search endpoint.

Chat akışından bağımsız, frontend'in "ders ara" UI'sı için. FAISS
SemanticSearcher'ı doğrudan tüketir.

Not: `category_filter` parametresi şu an SemanticSearcher'da yok
(FAZ 3'te eklenecek). Bu PR'da basit haliyle: query + top_k +
university_filter + min_score.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# SemanticSearcher singleton — embeddings.search'ten direkt al (kendi
# global'i var, chat.context'in private wrapper'ına bağlı kalmayalım).
from embeddings.search import IndexNotFoundError, get_searcher


router = APIRouter(prefix="/api/search", tags=["Search"])


class SearchRequest(BaseModel):
    """POST body."""
    query: str = Field(..., min_length=2, max_length=500)
    top_k: int = Field(10, ge=1, le=50)
    universities: Optional[list[str]] = Field(
        None,
        description="Slug listesi — sadece bu üni'lerden ara"
    )
    min_score: float = Field(0.3, ge=0.0, le=1.0)


@router.post(
    "",
    summary="🔍 Semantic ders arama",
    description=(
        "FAISS index üzerinde cosine similarity ile arama. "
        "Örnek: query='derin öğrenme', top_k=10. "
        "Sonuçlar score'a göre azalan sıralı."
    ),
)
async def search(req: SearchRequest) -> dict:
    try:
        searcher = get_searcher()
    except IndexNotFoundError as e:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Semantic searcher kullanılamıyor — FAISS index yok ({e}). "
                "`python -m src.embeddings.builder` ile oluştur."
            ),
        )
    results = searcher.search(
        query=req.query,
        top_k=req.top_k,
        university_filter=req.universities,
        min_score=req.min_score,
    )
    return {
        "query": req.query,
        "count": len(results),
        "results": results,
    }
