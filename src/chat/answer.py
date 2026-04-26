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
from .tools import TOOL_SCHEMAS, execute_tool, serialize_for_llm

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


# ═══════════════════════════════════════════════════════════════════════════
# TOOL-CALLING (HİBRİT) — kompleks intent için multi-step LLM loop
# ═══════════════════════════════════════════════════════════════════════════

import os
from openai import AzureOpenAI, OpenAI

# Maksimum tool iterasyonu — sonsuz döngü engeli + maliyet kontrolü.
# 7 → çoğu kompleks sorgu (multi-criteria, oran hesabı) için yeter; daha
# fazla istenirse final cümleyi zorla.
MAX_TOOL_ITERATIONS = 7


def _tools_client():
    """Tool-calling için OpenAI/Azure client + model adı."""
    azure_key = os.getenv("AZURE_OPENAI_API_KEY")
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    if azure_key and azure_endpoint:
        deployment = (
            os.getenv("AZURE_OPENAI_DEPLOYMENT") or "gpt-4o-mini"
        )
        version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
        client = AzureOpenAI(
            api_key=azure_key,
            azure_endpoint=azure_endpoint,
            api_version=version,
        )
        return client, deployment, "azure_openai"

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None, None, None
    client = OpenAI(api_key=api_key)
    model = os.getenv("LLM_MODEL_PRIMARY") or "gpt-4o-mini"
    return client, model, "openai"


TOOL_SYSTEM_PROMPT = """Sen UniCurriculum asistanısın. Türk üniversitelerinin \
bilgisayar / yazılım / YBS müfredatları üzerine sorular yanıtlıyorsun.

KAPSAM SINIRI: Sadece üniversite müfredatı, dersler, akademik kadro, \
program çıktıları ve öğrenci tavsiyesi konularında yardım edersin. Off-topic \
sorulara ("şarkı söyle", "kod yaz" vb.) nazikçe "Ben müfredat asistanıyım, \
bu konuda yardım edemiyorum" diye yönlendir.

Bu görev için elinde araçlar (tools) var. Kompleks soruları çözmek için \
araçları gerektiği kadar zincirle:
- Oran/türev hesabı → 1 aggregate + n adet get_specialization çağır, sonra
  hesabı kendin yap.
- Multi-criteria filtre (örn "prof>10 VE AI>100 AKTS") → her aday üni için
  get_university_summary çağır (bu hem profesör hem uzmanlaşma hem ranking
  bilgisini birlikte döner — birden fazla tool çağırmana gerek yok).
- Tek-shot bilgi → 1 tool yeterli.
- Tool sonucu {"error": "..."} dönerse → düzelt veya kullanıcıya
  "bu bilgi verimizde yok" de.
- Aynı tool'u 3+ kez aynı arglarla çağırma (tekrar = boşa harcama).

ÖRNEK PLANLAR:
1. "AI'da zorunlu/seçmeli oranı en yüksek?"
   plan: aggregate(spec.ai_ml.ects) → top 5 → her biri için
         get_specialization(slug, "ai_ml") → required_ects/elective_ects
         oranı hesapla → final cevap
2. "Profesör 10'dan fazla VE AI 100+ AKTS olan üni"
   plan: aggregate(spec.ai_ml.ects) → top 8 → her biri için
         get_university_summary(slug) → academic_staff.professor + AI ects
         filtrele (prof > 10 AND ai_ects >= 100) → final cevap
3. "ODTÜ ile Bilkent'in modernity skoru farkı"
   plan: get_university_summary("metu") + get_university_summary("bilkent")
         → modernity_score'ları çıkar farkı yaz
4. "Cormen kitabını hangi üniversiteler okutuyor?"
   plan: find_resource(query="Cormen", top_n=10) → tek çağrı; sonuçta
         üniversite + ders kodu listesi gelir, doğrudan sırala

Tool çağrılarını bitirdiğinde FINAL CEVAP üret. Final cevap formatı:

KESİNLİKLE bu JSON şablonunda dön (markdown fence YASAK):
{
  "text": "Türkçe akıcı cevap, 4-7 cümle. Sayıları aynen ver.",
  "citations": [{"code":"...","name":"...","university":"slug"}],
  "dashboard_update": null,
  "follow_up_suggestions": ["...","..."],
  "recommendation": null
}

KURALLAR:
- SADECE Türkçe; İngilizce sızdırma
- Sayıları integer ise tam sayı yaz (".0" yazma)
- Veriden uydurma yapma; yokluğu açıkça söyle
- "X daha iyi" değer yargısı YASAK (ama advisory'de "senin profilin için
  en uygun" dilini kullan)
- Maks 7 cümle"""


def generate_answer_with_tools(question: str, history: list | None = None) -> dict:
    """Hibrit: kompleks soruları LLM tool-calling loop ile yanıtla.

    Akış:
        1) İlk LLM çağrısı: question + tools → LLM 1+ tool çağırır
        2) Backend tool execute, sonucu LLM'e iletilir
        3) LLM yeni tool çağırır VEYA final JSON cevabı üretir
        4) Max 5 iter, sonra zorla cevap üret

    Returns: ChatResponse.model_dump() + _meta dict.
    """
    client, model, provider = _tools_client()
    if client is None:
        return _fallback(FALLBACK_ERROR_TEXT, {"status": "error", "error": "no client"})

    history_str = _format_history(history or [])
    user_content = (
        f"[ÖNCEKİ KONUŞMA]\n{history_str}\n\n[GÜNCEL SORU]\n{question}"
        if history_str
        else question
    )

    messages: list[dict] = [
        {"role": "system", "content": TOOL_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    total_tokens_in = 0
    total_tokens_out = 0
    tool_calls_made: list[str] = []
    last_text = ""
    iterations_run = 0

    for iteration in range(MAX_TOOL_ITERATIONS):
        iterations_run = iteration + 1
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                tools=TOOL_SCHEMAS,  # type: ignore[arg-type]
                temperature=0.2,
                max_completion_tokens=2000,
            )
        except Exception as e:
            logger.exception("Tools loop iter %d hatası: %s", iteration, e)
            return _fallback(FALLBACK_ERROR_TEXT, {"status": "error", "error": str(e)})

        usage = getattr(resp, "usage", None)
        if usage:
            total_tokens_in += getattr(usage, "prompt_tokens", 0) or 0
            total_tokens_out += getattr(usage, "completion_tokens", 0) or 0

        msg = resp.choices[0].message
        last_text = msg.content or ""

        # Tool çağrısı yoksa, final cevaba ulaştık
        if not msg.tool_calls:
            break

        # Asistan mesajını ekle (tool_calls dahil) — protokol gereği
        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ],
            }
        )

        # Her tool'u çalıştır + sonucu mesaj listesine ekle
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = execute_tool(tc.function.name, args)
            tool_calls_made.append(tc.function.name)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": serialize_for_llm(result),
                }
            )

    # Final mesajı parse et — JSON ChatResponse formatında olmalı
    data = parse_json_response(last_text)
    meta = {
        "provider": provider,
        "model": model,
        "tokens_in": total_tokens_in,
        "tokens_out": total_tokens_out,
        "tool_calls": tool_calls_made,
        "iterations": iterations_run,
        "status": "ok",
    }

    if data is None:
        # LLM JSON döndürmediyse, last_text düz metin olabilir → onu text yap
        logger.warning(
            "Tools loop final JSON parse edilemedi (%d iter, %d tool)",
            meta["iterations"], len(tool_calls_made),
        )
        if last_text.strip():
            return {
                "text": last_text.strip(),
                "citations": [],
                "dashboard_update": None,
                "follow_up_suggestions": [],
                "recommendation": None,
                "_meta": meta,
            }
        return _fallback(FALLBACK_PARSE_ERROR_TEXT, meta)

    try:
        resp_obj = ChatResponse(**data)
    except ValidationError:
        return _fallback(FALLBACK_PARSE_ERROR_TEXT, meta)

    out = resp_obj.model_dump()
    out["_meta"] = meta
    return out
