"""LLM-based curriculum enrichment subpackage.

Modüller:
    prompts     — SYSTEM_PROMPT + COURSE_PROMPT_TEMPLATE + sabitler
                   (kategori tanımları, modern/legacy teknoloji listeleri).
    llm_client  — Azure OpenAI wrapper (gpt-5.x-mini için
                   max_completion_tokens, retry, rate limit, maliyet
                   takibi).
    aggregator  — Üniversite seviyesi özet hesaplamaları (LLM'siz).
    enrich      — Ana CLI: --dry-run / --max / --file / --force / --budget.
                   Canlı progress: tqdm postfix'inde anlık $, ort. latency,
                   başarı/hata, kalan ders.
"""
