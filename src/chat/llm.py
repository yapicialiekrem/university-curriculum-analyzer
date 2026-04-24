"""
llm.py — OpenAI / OpenRouter LLM wrapper.

Stateless fonksiyon — hiçbir konuşma state'i tutmaz. Her çağrıyı
`logs/llm.jsonl`'e tek satır JSON olarak kaydeder (debug + maliyet
takibi için).

Sağlayıcı seçimi:
    primary   → OpenAI (gpt-4o-mini, varsayılan)
    fallback  → OpenRouter (qwen/qwen3-next-80b-a3b-instruct:free,
                varsayılan — ücretsiz)

Kullanım:
    from src.chat.llm import ask_llm, parse_json_response, LLMError

    text, meta = ask_llm(
        prompt="Merhaba, kendini tanıt.",
        system="Sen bir asistansın.",
        temperature=0.1,
        max_tokens=500,
    )
    if meta["status"] == "error":
        ...   # fallback zaten denenmiş — iki de düştü

    data = parse_json_response(text)   # JSON cevap için

Hata / retry politikası:
    - Rate / timeout / 5xx → exponential backoff, aynı tier'da 3 deneme
    - 4xx (auth, invalid request) → retry yok, sonraki tier'a atla
    - primary tüm denemeleri doldurursa → fallback tier'ı dener
    - Her iki tier da düşerse `text=""` + `meta["status"]="error"`
      döner; ÇAĞIRAN exception beklemez (schemalara uyum için).
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from openai import AzureOpenAI, OpenAI

load_dotenv()

# ─── Yol ve log ────────────────────────────────────────────────────────────
# repo_root = src/chat/llm.py → parents[2]
REPO_ROOT = Path(__file__).resolve().parents[2]
LOG_PATH = REPO_ROOT / "logs" / "llm.jsonl"
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)


# ─── Model konfigürasyonu ──────────────────────────────────────────────────
# Fiyatlar: USD / 1M token (gpt-4o-mini 2024-Q4 değerleri). OpenRouter
# free tier için 0.
ModelTier = Literal["primary", "fallback"]

MODELS: dict[str, dict[str, Any]] = {
    "primary": {
        "provider": "openai",
        "env_key": "OPENAI_API_KEY",
        "base_url": None,  # OpenAI default
        "default_model": "gpt-4o-mini",
        "model_env": "LLM_MODEL_PRIMARY",
        "cost_in_per_1m": 0.15,
        "cost_out_per_1m": 0.60,
    },
    "fallback": {
        "provider": "openrouter",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "qwen/qwen3-next-80b-a3b-instruct:free",
        "model_env": "LLM_MODEL_FALLBACK",
        "cost_in_per_1m": 0.0,
        "cost_out_per_1m": 0.0,
    },
}

MAX_RETRIES = 3
RETRY_BASE_DELAY_S = 1.0

# Prompt/response preview uzunluğu — log dosyasını makul tut
LOG_PREVIEW_LEN = 300


class LLMError(Exception):
    """ask_llm() kritik şekilde başarısız olursa (çağıran tuple yerine
    exception beklerse). Default akışta kullanılmaz."""


# ─── Log yardımcıları ──────────────────────────────────────────────────────

def _log_entry(entry: dict) -> None:
    """logs/llm.jsonl'e tek satır ekle. Asla exception fırlatmaz."""
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
    except Exception as e:  # pragma: no cover  (log failures slient)
        logger.warning("llm.jsonl yazılamadı: %s", e)


def _preview(s: Optional[str], n: int = LOG_PREVIEW_LEN) -> str:
    if not s:
        return ""
    return s[:n] + ("…" if len(s) > n else "")


# ─── Client / maliyet yardımcıları ─────────────────────────────────────────

def _get_client(tier: str) -> tuple[Any, dict, str]:
    """Tier için (client, cfg, model_name) döndür.

    primary tier için öncelik sırası:
        1. AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT varsa → Azure
        2. OPENAI_API_KEY varsa                             → OpenAI
        3. İkisi de yoksa → LLMError
    fallback tier → OpenRouter (tek seçenek).

    Azure'da `model` parametresi DEPLOYMENT adıdır (env: AZURE_OPENAI_DEPLOYMENT).
    """
    if tier not in MODELS:
        raise LLMError(f"Bilinmeyen tier: {tier}")
    cfg = dict(MODELS[tier])    # kopya — provider'ı override edebiliriz

    if tier == "primary":
        azure_key = os.getenv("AZURE_OPENAI_API_KEY")
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if azure_key and azure_endpoint:
            # Azure OpenAI
            deployment = (
                os.getenv("AZURE_OPENAI_DEPLOYMENT")
                or cfg["default_model"]
            )
            version = os.getenv("AZURE_OPENAI_API_VERSION",
                                "2024-12-01-preview")
            client = AzureOpenAI(
                api_key=azure_key,
                azure_endpoint=azure_endpoint,
                api_version=version,
            )
            cfg["provider"] = "azure_openai"
            return client, cfg, deployment

        # Standart OpenAI fallback
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise LLMError(
                "Ne AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT ne "
                "OPENAI_API_KEY tanımlı (primary tier)"
            )
        client = OpenAI(api_key=api_key)
        model_name = (
            os.getenv(cfg["model_env"]) or cfg["default_model"]
        )
        return client, cfg, model_name

    # fallback tier → OpenRouter (OpenAI-uyumlu REST)
    api_key = os.getenv(cfg["env_key"])
    if not api_key:
        raise LLMError(f"{cfg['env_key']} environment değişkeni tanımsız")
    client = OpenAI(api_key=api_key, base_url=cfg["base_url"])
    model_name = os.getenv(cfg["model_env"]) or cfg["default_model"]
    return client, cfg, model_name


def _estimate_cost(tokens_in: int, tokens_out: int, cfg: dict) -> float:
    return (
        tokens_in * cfg["cost_in_per_1m"] / 1_000_000
        + tokens_out * cfg["cost_out_per_1m"] / 1_000_000
    )


_RETRYABLE_TOKENS = ("rate", "429", "timeout", "503", "502", "504", "connection")


def _is_retryable(err: Exception) -> bool:
    s = str(err).lower()
    return any(t in s for t in _RETRYABLE_TOKENS)


# ─── Tek çağrı ─────────────────────────────────────────────────────────────

def _call_once(
    prompt: str,
    system: Optional[str],
    temperature: float,
    max_tokens: int,
    json_mode: bool,
    tier: str,
) -> tuple[str, dict]:
    """Tek bir LLM çağrısı — retry/log içermez."""
    client, cfg, model_name = _get_client(tier)

    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    # max_completion_tokens — modern OpenAI/Azure modelleri max_tokens'ı
    # 400 ile reddediyor (gpt-5-nano, o1/o3 ailesi). Yeni param her modelde
    # çalışıyor.
    create_kwargs: dict[str, Any] = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
    }
    if json_mode:
        create_kwargs["response_format"] = {"type": "json_object"}

    t0 = time.perf_counter()
    response = client.chat.completions.create(**create_kwargs)
    latency_ms = int((time.perf_counter() - t0) * 1000)

    text = response.choices[0].message.content or ""
    usage = getattr(response, "usage", None)
    tokens_in = getattr(usage, "prompt_tokens", 0) if usage else 0
    tokens_out = getattr(usage, "completion_tokens", 0) if usage else 0

    meta = {
        "provider": cfg["provider"],
        "model": model_name,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
        "cost_usd": round(_estimate_cost(tokens_in, tokens_out, cfg), 6),
    }
    return text, meta


# ─── Public API ────────────────────────────────────────────────────────────

def ask_llm(
    prompt: str,
    system: Optional[str] = None,
    temperature: float = 0.1,
    max_tokens: int = 2000,
    json_mode: bool = False,
    model_tier: ModelTier = "primary",
) -> tuple[str, dict]:
    """LLM'e sorgu at, (response_text, meta) döndür.

    Retry ve fallback otomatik:
        1. model_tier'da MAX_RETRIES kez retryable hata üzerine backoff
        2. primary tier'da başarısız olursa fallback tier dener
        3. Her iki de başarısızsa text="" + meta["status"]="error"

    Args:
        prompt:      Kullanıcı mesajı.
        system:      Opsiyonel system prompt.
        temperature: 0.0..2.0 (varsayılan 0.1 — deterministic).
        max_tokens:  Cevap için max token.
        json_mode:   True ise response_format=json_object (sadece
                     OpenAI-uyumlu modellerde).
        model_tier:  "primary" (OpenAI) veya "fallback" (OpenRouter).

    Returns:
        (text, meta) — meta daima şu alanları içerir:
            status       : "ok" | "error"
            provider     : "openai" | "openrouter" (son kullanılan)
            model        : modelin string adı
            tokens_in    : int (hata olursa 0)
            tokens_out   : int
            latency_ms   : int (son denemenin süresi)
            cost_usd     : float
            tier         : kullanılan tier
            attempts     : toplam deneme sayısı (tüm tier'lar)
            error        : (yalnızca status="error" ise) son hata str
    """
    total_attempts = 0
    last_error: Optional[Exception] = None
    last_meta: dict = {}

    # primary → fallback kaskadı. model_tier="fallback" verilirse
    # sadece fallback denenir.
    tiers_to_try: list[str] = [model_tier]
    if model_tier == "primary":
        tiers_to_try.append("fallback")

    for tier in tiers_to_try:
        for attempt in range(1, MAX_RETRIES + 1):
            total_attempts += 1
            try:
                text, meta = _call_once(
                    prompt=prompt,
                    system=system,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    json_mode=json_mode,
                    tier=tier,
                )
            except Exception as e:
                last_error = e
                _log_entry({
                    "ts": time.time(),
                    "tier": tier,
                    "attempt": attempt,
                    "status": "error",
                    "error_type": type(e).__name__,
                    "error": _preview(str(e)),
                    "system_preview": _preview(system),
                    "prompt_preview": _preview(prompt),
                })
                if _is_retryable(e) and attempt < MAX_RETRIES:
                    # aynı tier içinde backoff + tekrar
                    sleep_for = RETRY_BASE_DELAY_S * (2 ** (attempt - 1))
                    logger.warning(
                        "LLM [%s] retryable (%s); %.1fs bekleniyor (deneme %d/%d)",
                        tier, type(e).__name__, sleep_for, attempt, MAX_RETRIES,
                    )
                    time.sleep(sleep_for)
                    continue
                # non-retryable veya son deneme → bu tier bitti
                logger.warning(
                    "LLM [%s] başarısız (%s); sonraki tier'a geçiliyor",
                    tier, type(e).__name__,
                )
                break

            # başarılı
            _log_entry({
                "ts": time.time(),
                "tier": tier,
                "attempt": attempt,
                "status": "ok",
                **meta,
                "system_preview": _preview(system),
                "prompt_preview": _preview(prompt),
                "response_preview": _preview(text),
            })
            meta.update({
                "status": "ok",
                "tier": tier,
                "attempts": total_attempts,
            })
            return text, meta

    # iki tier da başarısız
    err_repr = f"{type(last_error).__name__}: {last_error}" if last_error else "unknown"
    last_meta = {
        "status": "error",
        "provider": None,
        "model": None,
        "tokens_in": 0,
        "tokens_out": 0,
        "latency_ms": 0,
        "cost_usd": 0.0,
        "tier": tiers_to_try[-1] if tiers_to_try else None,
        "attempts": total_attempts,
        "error": _preview(err_repr),
    }
    logger.error("LLM tüm tier'larda başarısız: %s", err_repr)
    return "", last_meta


# ─── JSON parse yardımcı ──────────────────────────────────────────────────

_CODE_FENCE_RX = re.compile(r"```(?:json)?\s*\n?(.*?)\n?```", re.DOTALL)


def parse_json_response(text: str) -> Optional[dict]:
    """LLM cevabından JSON objesi çıkar.

    Tolere eder:
        - düz JSON: `{"a": 1}`
        - markdown fence: ` ```json\n{"a": 1}\n``` `
        - önünde/arkasında açıklama: `İşte cevap: {"a": 1}. Umarım ...`

    Args:
        text: LLM'den gelen ham string.

    Returns:
        Parse edilen dict, bulunamazsa None. (List gelirse None — tipik
        chat response'ları obje bekliyor.)
    """
    if not text or not text.strip():
        return None

    candidates: list[str] = []

    # 1) markdown fence içindeki içerik
    fm = _CODE_FENCE_RX.search(text)
    if fm:
        candidates.append(fm.group(1).strip())

    # 2) düz metnin kendisi (trim'li)
    candidates.append(text.strip())

    # 3) en dıştaki { ... } bloğu
    s = text.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        candidates.append(s[start:end + 1])

    for cand in candidates:
        try:
            parsed = json.loads(cand)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed

    return None
