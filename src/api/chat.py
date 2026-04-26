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
from chat.answer import generate_answer, generate_answer_with_tools
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

    # 1) Intent — history varsa anaforik referansları çözmek için ilet
    history_dicts = [t.model_dump() for t in (req.history or [])]
    intent = classify(question, history=history_dicts)

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

    # 2) "complex" intent → tool-calling loop (hibrit kompleks dal); diğerleri
    # context-based klasik akış.
    if intent.type == "complex":
        # context build edilmez; LLM tool çağrılarıyla veriyi kendi toplar
        context = {"intent_type": "complex"}
        answer = generate_answer_with_tools(question, history=history_dicts)
    else:
        try:
            context = build_context(intent, question=question)
        except Exception as e:
            logger.exception("Context builder patladı: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Veri toplama başarısız: {type(e).__name__}",
            )
        # 3) Cevap (LLM) — history zaten yukarıda hazırlandı
        answer = generate_answer(question, context, history=history_dicts)

    latency_ms = int((time.perf_counter() - t0) * 1000)

    # Aggregate ranked list'i frontend mini-chart için ham veriyle döndür
    aggregate_data = None
    if intent.type == "aggregate":
        agg_ctx = (context or {}).get("aggregate") or {}
        if agg_ctx.get("ranked"):
            aggregate_data = {
                "metric": agg_ctx.get("metric"),
                "metric_label": agg_ctx.get("metric_label"),
                "order": agg_ctx.get("order"),
                "ranked": agg_ctx.get("ranked"),
            }

    return {
        "text": answer["text"],
        "citations": answer["citations"],
        "dashboard_update": answer["dashboard_update"],
        "follow_up_suggestions": answer["follow_up_suggestions"],
        "recommendation": answer.get("recommendation"),
        "aggregate": aggregate_data,
        "meta": {
            "intent_type": intent.type,
            "universities_found": getattr(intent, "universities", []),
            "needs_embedding": getattr(intent, "needs_embedding", False),
            "latency_ms": latency_ms,
            "llm": answer.get("_meta", {}),
        },
    }
