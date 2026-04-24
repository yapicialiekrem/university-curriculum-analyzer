"""Chat / LLM subpackage.

Modüller:
    llm       — OpenAI / OpenRouter wrapper (stateless). Her çağrıyı
                logs/llm.jsonl'e kaydeder, primary başarısızsa fallback'e
                düşer.
    prompts   — (ADIM 4) Tüm LLM system/user prompt template'leri.
    router    — (ADIM 5) Intent sınıflandırıcı.
    context   — (ADIM 6) Intent'e göre veri toplayıcı (LLM'siz).
    answer    — (ADIM 7) Son kullanıcı cevabı üretici.
    schemas   — Pydantic modelleri.
"""
