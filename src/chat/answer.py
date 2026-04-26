"""
answer.py — Context + question → ChatResponse.

ANSWER_PROMPT ile LLM'e gönderip Pydantic ChatResponse'a parse eder.
Context JSON'ı 8000 karakter üstünde ise kesilir (LLM token baskısı
yok ama ANSWER_PROMPT'un cevabını kısa tutmak önemli).

Graceful failure:
    - LLM her iki tier'da da düşerse → sabit FALLBACK_ERROR_TEXT.
    - JSON parse edilemezse → FALLBACK_PARSE_ERROR_TEXT.
    - Pydantic validation başarısızsa → FALLBACK_PARSE_ERROR_TEXT.
    - İki durumda da dashboard_update=None, citations=[].

Dönen dict `_meta` alanında LLM meta bilgisini içerir — endpoint
(ADIM 8) bunu `response.meta`'ya koyar.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import ValidationError

from .llm import ask_llm, parse_json_response
from .prompts import (
    ANSWER_PROMPT,
    ANSWER_SYSTEM,
    FALLBACK_ERROR_TEXT,
    FALLBACK_PARSE_ERROR_TEXT,
)
from .schemas import ChatResponse

logger = logging.getLogger(__name__)

# Context'i LLM'e yollarken üst sınır (karakter). ANSWER_PROMPT'un kendisi
# ~1300 char; toplam 10k altında kalmalı.
MAX_CONTEXT_CHARS = 8000

# Cevap için max token — ChatResponse genelde kısa tutulsun diye
# prompt'ta max 5 cümle; JSON toplam ~1500 token yeterli.
ANSWER_MAX_TOKENS = 1500


def _serialize_context(context: dict) -> str:
    """Context'i LLM'e gidecek okunabilir JSON'a çevir, gerekirse kes."""
    try:
        s = json.dumps(context, ensure_ascii=False, indent=2, default=str)
    except Exception as e:
        logger.warning("Context serialize hatası: %s", e)
        s = str(context)
    if len(s) > MAX_CONTEXT_CHARS:
        s = s[:MAX_CONTEXT_CHARS] + "\n... (veri kısaltıldı)"
    return s


def _fallback(text: str, meta: dict) -> dict:
    """Sabit metinli başarısız cevap. dict olarak döner (meta dahil)."""
    resp = ChatResponse(
        text=text,
        citations=[],
        dashboard_update=None,
        follow_up_suggestions=[],
    )
    out = resp.model_dump()
    out["_meta"] = meta
    return out


def _format_history(history: list) -> str:
    """Konuşma geçmişini LLM'e iletilebilir kompakt metne çevir.

    Format: "Kullanıcı: ...\nAsistan: ..." şeklinde son 3-6 turn.
    history boşsa boş string döner (prompt template kontrol eder).
    """
    if not history:
        return ""
    lines = []
    for turn in history[-6:]:
        role = "Kullanıcı" if turn.get("role") == "user" else "Asistan"
        text = (turn.get("text") or "").strip()
        if not text:
            continue
        # Asistan mesajlarını kısalt (uzun ders açıklamaları context'i şişirmesin)
        if role == "Asistan" and len(text) > 280:
            text = text[:280] + "..."
        lines.append(f"{role}: {text}")
    return "\n".join(lines)


def generate_answer(question: str, context: dict, history: list | None = None) -> dict:
    """Kullanıcı cevabı üret.

    Args:
        question: Orijinal soru metni.
        context: build_context() çıktısı.
        history: opsiyonel önceki konuşma turları
            (list of {"role": "user|assistant", "text": str}).

    Returns:
        ChatResponse.model_dump() + "_meta" alanı. Endpoint bunu
        client'a düzleyerek döndürür.
    """
    context_str = _serialize_context(context)
    history_str = _format_history(history or [])
    # Geçmiş varsa kullanıcı mesajının başına "ÖNCEKİ KONUŞMA" bloğu ekle.
    # Prompt template'i değiştirmiyoruz; question alanına önek ekliyoruz.
    if history_str:
        framed_question = (
            f"[ÖNCEKİ KONUŞMA — anaforik referansları bu bağlamla yorumla:]\n"
            f"{history_str}\n\n"
            f"[GÜNCEL SORU:]\n{question}"
        )
    else:
        framed_question = question
    prompt = ANSWER_PROMPT.format(question=framed_question, context_json=context_str)

    text, meta = ask_llm(
        prompt=prompt,
        system=ANSWER_SYSTEM,
        temperature=0.3,     # hafif yaratıcı — cümle akıcılığı
        max_tokens=ANSWER_MAX_TOKENS,
        json_mode=True,
    )

    # Tier'lar düştü
    if meta.get("status") != "ok":
        logger.warning(
            "Answer LLM başarısız (tier=%s, err=%s)",
            meta.get("tier"), (meta.get("error") or "")[:120],
        )
        return _fallback(FALLBACK_ERROR_TEXT, meta)

    # JSON parse
    data = parse_json_response(text)
    if data is None:
        logger.warning("Answer cevabı JSON parse edilemedi (%d char)", len(text))
        return _fallback(FALLBACK_PARSE_ERROR_TEXT, meta)

    # Pydantic validation
    try:
        resp = ChatResponse(**data)
    except ValidationError as e:
        logger.warning(
            "Answer şema uyumsuz (%d hata); ilk: %s",
            len(e.errors()), e.errors()[0] if e.errors() else None,
        )
        return _fallback(FALLBACK_PARSE_ERROR_TEXT, meta)

    out: dict[str, Any] = resp.model_dump()
    out["_meta"] = meta
    return out
