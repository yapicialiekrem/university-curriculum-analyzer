"""
router.py — Intent sınıflandırıcı.

Kullanıcı sorusunu alır, ROUTER_PROMPT ile LLM'e gönderir, dönen JSON'ı
`Intent` Pydantic modeline parse eder. Tek LLM çağrısı, ~200 input token.

Başarısızlık davranışı:
    - LLM düşerse (her iki tier de) → Intent(type="general", ...)
    - JSON parse edilemezse → Intent(type="general", ...)
    - Pydantic validation başarısızsa → Intent(type="general", ...)
Bu davranış context builder'ın her zaman çalışabilir bir Intent
almasını garanti eder — ChatResponse downstream'inde ekstra error
handling gerekmez.

Kullanım:
    from src.chat.router import classify
    intent = classify("ODTÜ'de kaç zorunlu ders var?")
    # intent.type == "deterministic"
    # intent.universities == ["metu"]
"""

from __future__ import annotations

import logging

from pydantic import ValidationError

from .llm import ask_llm, parse_json_response
from .prompts import ROUTER_PROMPT, ROUTER_SYSTEM
from .schemas import Intent

logger = logging.getLogger(__name__)


# Router çağrısı için max token — ROUTER_PROMPT formatı çok küçük bir
# JSON döndüğü için 400 yeterli (yaklaşık 10-20 alanlı kısa obje).
ROUTER_MAX_TOKENS = 400


def classify(question: str, history: list | None = None) -> Intent:
    """Kullanıcı sorusunu sınıflandır.

    Args:
        question: Türkçe veya İngilizce doğal dil soru. 3+ karakter
            beklenir — endpoint tarafında zaten doğrulanıyor, burada
            tekrar kontrol yok.
        history: opsiyonel önceki konuşma turları
            (list of {"role": "user|assistant", "text": str}).
            Anaforik referansları ("peki en azı?", "onlardan hangisi?")
            doğru sınıflandırmak için kullanılır.

    Returns:
        Intent objesi. Herhangi bir adım başarısız olursa
        `Intent(type="general")` döner — asla exception fırlatmaz.
    """
    # History varsa son 2-3 turn'ü router'a iletilebilir bağlam olarak
    # question alanının başına ekle. Router prompt template'i değişmiyor.
    framed_question = question
    if history:
        recent = history[-4:]
        lines = []
        for turn in recent:
            role = "Kullanıcı" if turn.get("role") == "user" else "Asistan"
            text = (turn.get("text") or "").strip()
            if not text:
                continue
            if role == "Asistan" and len(text) > 200:
                text = text[:200] + "..."
            lines.append(f"  {role}: {text}")
        if lines:
            framed_question = (
                "[Önceki konuşma]\n" + "\n".join(lines) +
                "\n[Güncel soru]\n" + question
            )
    prompt = ROUTER_PROMPT.format(question=framed_question)

    text, meta = ask_llm(
        prompt=prompt,
        system=ROUTER_SYSTEM,
        temperature=0.1,
        max_tokens=ROUTER_MAX_TOKENS,
        json_mode=True,
    )

    if meta.get("status") != "ok":
        logger.warning(
            "Router LLM çağrısı başarısız (tier=%s, err=%s) → type=general",
            meta.get("tier"), (meta.get("error") or "")[:120],
        )
        return _default_general()

    data = parse_json_response(text)
    if data is None:
        logger.warning(
            "Router cevabı JSON parse edilemedi (len=%d) → type=general",
            len(text or ""),
        )
        return _default_general()

    try:
        intent = Intent(**data)
    except ValidationError as e:
        logger.warning(
            "Router JSON şema uyumsuz (%d hata) → type=general. İlk: %s",
            len(e.errors()), e.errors()[0] if e.errors() else None,
        )
        return _default_general()

    # Tutarlılık: needs_embedding=True ama semantic_query boşsa,
    # kullanıcı sorusunun kendisini query olarak al.
    if intent.needs_embedding and not (intent.semantic_query or "").strip():
        intent.semantic_query = question

    logger.debug(
        "Router: type=%s unis=%s metric=%s emb=%s",
        intent.type, intent.universities, intent.metric, intent.needs_embedding,
    )
    return intent


def _default_general() -> Intent:
    """Hata durumlarında dönülen boş/general intent."""
    return Intent(type="general")
