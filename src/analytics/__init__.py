"""Dashboard için enrichment-bazlı analiz katmanı.

Modüller:
    loader   — EnrichmentStore singleton: data/**/*.json'u belleğe yükler.
    radar    — 10 eksen kapsam radar grafiği (Dashboard Bileşen 1.1).
    bloom    — Bloom taksonomisi donut'ları (Bileşen 2.3).
    coverage — Kategori bazlı ortak konu haritası (Bileşen 2.2).
    heatmap  — Dönem × kategori ECTS heatmap'i (Bileşen 2.1).

Bu modüller LLM kullanmaz — saf agregasyon. Veri kaynağı:
    data/**/*.json'da `_summary` ve her dersin `_enriched` alanı.
"""
