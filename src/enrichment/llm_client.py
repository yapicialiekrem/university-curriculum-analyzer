"""
Azure OpenAI wrapper — enrichment'a özel.

Genel `src/chat/llm.py` wrapper'ından ayrı tutuldu çünkü:
    - Bu wrapper **tek deployment**'a kilitli (enrichment için tek model).
    - Fiyatlandırma sabiti farklı (gpt-5.x-mini enrichment ücretleri).
    - Retry mantığı daha sessiz (tqdm'i bozmasın diye print yerine callback).
    - max_completion_tokens zorunlu (gpt-5 ailesi max_tokens'ı reddediyor).

ENRICHMENT_PROMPT.md fiyatlandırması:
    input  $0.75 / 1M token
    output $4.50 / 1M token

Rate limit: 150 req/dk = 0.4s/req. Script ana döngüde sleep(0.5) veriyor;
bu wrapper içinde ek gecikme YOK (döngü yöneticisi koordine etsin).
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable, Optional

from openai import APIError, AzureOpenAI, RateLimitError


# ─── gpt-5.x-mini fiyatlandırması (USD / 1M token) ───────────────────────
PRICE_INPUT_PER_1M: float = 0.75
PRICE_OUTPUT_PER_1M: float = 4.50


class AzureLLMClient:
    """Azure OpenAI client with retry, rate-limit-aware backoff, cost tracking.

    Attributes:
        total_cost      — Başlangıçtan itibaren toplam harcama (USD).
        total_requests  — Başarılı istek sayısı.
        total_tokens_in — Toplam input token.
        total_tokens_out— Toplam output token.
    """

    def __init__(
        self,
        *,
        on_warning: Optional[Callable[[str], None]] = None,
    ) -> None:
        """
        Args:
            on_warning: Retry / rate-limit uyarılarında çağrılan callback.
                None ise sessiz. tqdm ile uyumlu kullanım için
                `tqdm.write` geçilebilir.
        """
        endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
        api_key = os.environ.get("AZURE_OPENAI_API_KEY")
        if not endpoint or not api_key:
            raise RuntimeError(
                "AZURE_OPENAI_ENDPOINT ve AZURE_OPENAI_API_KEY "
                ".env'de tanımlı olmalı."
            )
        version = os.environ.get(
            "AZURE_OPENAI_API_VERSION", "2025-03-01-preview"
        )
        self.client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=version,
        )
        self.deployment = os.environ.get(
            "AZURE_OPENAI_DEPLOYMENT", "unicurriculum"
        )
        self._warn = on_warning or (lambda _msg: None)

        self.total_cost: float = 0.0
        self.total_requests: int = 0
        self.total_tokens_in: int = 0
        self.total_tokens_out: int = 0

    # ─── Public ──────────────────────────────────────────────────────

    def ask(
        self,
        prompt: str,
        system: Optional[str] = None,
        response_format: Optional[dict] = None,
        max_tokens: int = 2000,
        temperature: float = 0.1,
        retries: int = 3,
    ) -> tuple[str, dict]:
        """LLM çağrısı yap; (text, meta) döndür.

        meta: {tokens_in, tokens_out, cost_usd, latency_ms, total_cost_usd}

        Raises:
            RuntimeError: retries sayısı aşılırsa.
        """
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        kwargs: dict[str, Any] = {
            "model": self.deployment,
            "messages": messages,
            # gpt-5 ailesi max_tokens'ı 400 ile reddediyor — yeni param.
            "max_completion_tokens": max_tokens,
            "temperature": temperature,
        }
        if response_format:
            kwargs["response_format"] = response_format

        last_err: Optional[Exception] = None
        for attempt in range(1, retries + 1):
            try:
                t0 = time.perf_counter()
                response = self.client.chat.completions.create(**kwargs)
                latency_ms = int((time.perf_counter() - t0) * 1000)

                content = response.choices[0].message.content or ""
                usage = getattr(response, "usage", None)
                tokens_in = getattr(usage, "prompt_tokens", 0) if usage else 0
                tokens_out = (
                    getattr(usage, "completion_tokens", 0) if usage else 0
                )

                cost = (
                    tokens_in * PRICE_INPUT_PER_1M
                    + tokens_out * PRICE_OUTPUT_PER_1M
                ) / 1_000_000

                self.total_cost += cost
                self.total_requests += 1
                self.total_tokens_in += tokens_in
                self.total_tokens_out += tokens_out

                return content, {
                    "tokens_in": tokens_in,
                    "tokens_out": tokens_out,
                    "cost_usd": round(cost, 6),
                    "latency_ms": latency_ms,
                    "total_cost_usd": round(self.total_cost, 4),
                }

            except RateLimitError as e:
                last_err = e
                wait = attempt * 30
                self._warn(
                    f"⏳ Rate limit (deneme {attempt}/{retries}); "
                    f"{wait}s bekleniyor"
                )
                time.sleep(wait)

            except APIError as e:
                last_err = e
                if attempt == retries:
                    break
                wait = attempt * 5
                self._warn(
                    f"⚠ API hata ({type(e).__name__}) deneme "
                    f"{attempt}/{retries}; {wait}s sonra tekrar"
                )
                time.sleep(wait)

            except Exception as e:  # networking, json, etc.
                last_err = e
                if attempt == retries:
                    break
                wait = attempt * 3
                self._warn(
                    f"⚠ {type(e).__name__}: {e} deneme "
                    f"{attempt}/{retries}; {wait}s sonra tekrar"
                )
                time.sleep(wait)

        raise RuntimeError(
            f"Tüm {retries} deneme başarısız: {type(last_err).__name__}: "
            f"{last_err}"
        )
