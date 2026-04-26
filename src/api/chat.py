"""
chat.py — POST /api/chat endpoint (ADIM 8).

Request:
    { "question": "ODTÜ ve İEÜ'nün AI derslerini karşılaştır" }

Response:
    {
      "text": "...",
      "citations": [{"code":"CE 315", "name":"...", "url":"...", "university":"..."}, ...],
      "dashboard_update": {"highlight_courses": [...], "show_chart": null,
                           "filter": {...}, "universities_focus": [...]}
                           | null,
      "follow_up_suggestions": ["...", "..."],
      "meta": {
        "intent_type": "semantic",
        "latency_ms": 2134,
        "llm": {
          "status": "ok",
          "tier": "primary",
          "provider": "openai",
          "model": "gpt-4o-mini",
          "tokens_in": 820,
          "tokens_out": 310,
          "cost_usd": 0.000309,
          "attempts": 1
        }
      }
    }

Pipeline:
    classify(question)           →  Intent           (1 LLM çağrısı)
    build_context(intent)        →  dict             (LLM yok; Neo4j + FAISS)
    generate_answer(q, context)  →  ChatResponse     (1 LLM çağrısı)

Toplam genelde 2 LLM çağrısı.

TODO (MD #3): SlowAPI ile kullanıcı başına dakikada 10 istek limiti.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, status

# Mevcut kod flat-import (src/ sys.path'te iken çalışıyor — main.py
# `from comparison import ...` örüntüsüyle aynı).
from chat.answer import generate_answer
from chat.context import build_context
from chat.router import classify
from chat.schemas import ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["Chat"])


@router.post(
    "",
    summary="AI chat — Intent → Context → Cevap",
    description=(
        "Kullanıcı sorusunu sınıflandırır, ilgili veriyi (Neo4j / FAISS) "
        "toplar ve LLM ile Türkçe, yapısal bir cevap üretir. "
        "Validation: question 3-500 karakter."
    ),
)
async def chat(req: ChatRequest) -> dict:
    """POST /api/chat ana işleyicisi."""
    question = req.question.strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Soru boş olamaz.",
        )

    t0 = time.perf_counter()

    # 1) Intent
    intent = classify(question)

    # ChatRequest'ten gelen kullanıcı bağlamı router'ın çıkarımını ezer:
    #   - selected_slugs varsa intent.universities boşsa onu kullan
    #   - user_rank request'te verilmişse, router çıkartmasaydı bile ekle
    #   - rank/goal varsa ve intent.type=general ise advisory'ye yükselt
    if req.selected_slugs and not intent.universities:
        intent.universities = list(req.selected_slugs)
    if req.user_rank and not intent.user_rank:
        intent.user_rank = req.user_rank
    if (req.user_rank or req.goal) and intent.type == "general":
        intent.type = "advisory"

    # 2) Context (LLM'siz)
    try:
        context = build_context(intent)
    except Exception as e:
        logger.exception("Context builder patladı: %s", e)
        # Exception beklemiyoruz ama güvence: 500 dön.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Veri toplama başarısız: {type(e).__name__}",
        )

    # 3) Cevap (LLM)
    answer = generate_answer(question, context)

    latency_ms = int((time.perf_counter() - t0) * 1000)

    return {
        "text": answer["text"],
        "citations": answer["citations"],
        "dashboard_update": answer["dashboard_update"],
        "follow_up_suggestions": answer["follow_up_suggestions"],
        "recommendation": answer.get("recommendation"),
        "meta": {
            "intent_type": intent.type,
            "universities_found": getattr(intent, "universities", []),
            "needs_embedding": getattr(intent, "needs_embedding", False),
            "latency_ms": latency_ms,
            "llm": answer.get("_meta", {}),
        },
    }
