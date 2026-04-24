"""
prompts.py — Tüm LLM prompt template'leri.

Kural: Jinja2 KULLANMA, f-string / str.format yeterli. Her prompt'un
system ve user kısımları ayrı sabitler olarak tanımlı; kullanan modül
(router.py, answer.py, vb.) `PROMPT.format(...)` ile placeholder doldurur.

Placeholder'lar:
    ROUTER_PROMPT  → {question}
    ANSWER_PROMPT  → {question}, {context_json}

f-string brace'leri escape için `{{` ve `}}` kullanılır.

Türkçe sızıntıyı azaltmak için her prompt'ta "SADECE Türkçe cevap ver"
uyarısı tekrarlanır (özellikle Qwen fallback için kritik).
"""

from __future__ import annotations


# ═══════════════════════════════════════════════════════════════════════════
# ROUTER — Intent sınıflandırıcı
# ═══════════════════════════════════════════════════════════════════════════

ROUTER_SYSTEM = """Sen bir niyet sınıflandırıcısısın. Kullanıcının \
sorusunu analiz edip yapısal JSON çıktı üretirsin. SADECE JSON döndür, \
başka hiçbir şey yazma. Markdown fence, yorum veya açıklama ekleme."""


ROUTER_PROMPT = """Kullanıcı sorusu: "{question}"

Bu soruyu aşağıdaki kategorilerden BİRİNE ata:

TYPE SEÇENEKLERİ:
- "deterministic"  → Sayısal / filtrelenebilir soru
                     ("kaç ders", "hangi üniversitede", "en yüksek AKTS")
- "comparison"     → İki veya daha fazla üniversite karşılaştırma
                     ("ODTÜ ile İEÜ'yü kıyasla", "hangisi daha çok ...")
- "semantic"       → Konu / kategori bazlı arama
                     ("AI dersleri", "görüntü işleme", "web geliştirme")
- "detail"         → Spesifik tek ders veya üniversite detayı
                     ("CE 315 nedir", "ODTÜ bilgisayar bölümü hakkında")
- "general"        → Sistem / proje hakkında genel soru
                     ("nasıl çalışıyor", "hangi veriler var")

UNIVERSITIES: Sorunun doğrudan ilgilendirdiği üniversitelerin **slug**
listesi. Mevcut slug'lar veri klasöründeki JSON dosya adlarıyla eşleşir
(örn: "metu", "ege", "ozyegin", "selcuk", "tobb", "odtu" gibi). Emin
değilsen boş bırak: [].

METRIC: Eğer type="comparison" ise aşağıdaki metriklerden uygun olanı
seç; başka durumda null:
  "courses"                — benzer ders bulma (semantik)
  "staff"                  — akademik kadro sayıları
  "workload"               — AKTS / teori / uygulama dengesi
  "program-outcomes"       — program çıktısı benzerliği
  "learning-outcomes"      — iki dersin kazanım karşılaştırması
  "curriculum-coverage"    — haftalık konu örtüşmesi
  "prerequisites"          — önkoşul ağaç derinliği
  "semester-distribution"  — dönemsel ders dağılımı
  "mandatory-elective"     — zorunlu / seçmeli oranı
  "language-distribution"  — Türkçe / İngilizce dağılımı
  "resources"              — ortak kaynak / kitap

FILTERS (hepsi opsiyonel, yoksa null):
  category     : "ai" | "programming" | "math" | "systems" | "theory"
  semester     : 1..8 tamsayı
  course_type  : "zorunlu" | "secmeli"
  language     : "tr" | "en"

NEEDS_EMBEDDING: Semantik arama gerekli mi (bool)?
  - type="semantic" ise genelde true
  - type="detail" + spesifik ders ismi geçiyorsa genelde false
  - type="comparison" + metric="courses" ise true
TOP_K: needs_embedding=true ise kaç sonuç istiyorsun (varsayılan 10,
       1..50 arası).
SEMANTIC_QUERY: needs_embedding=true ise FAISS'a gidecek metin. Genelde
       kullanıcı sorusunun özü; çeviri yapma. needs_embedding=false ise
       null.

ÇIKTI — SADECE bu şablonda JSON:
{{
  "type": "...",
  "universities": [],
  "metric": null,
  "filters": {{
    "category": null,
    "semester": null,
    "course_type": null,
    "language": null
  }},
  "needs_embedding": false,
  "top_k": 10,
  "semantic_query": null
}}

ÖRNEKLER:

Soru: "ODTÜ'de kaç zorunlu ders var?"
→ {{"type":"deterministic","universities":["metu"],"metric":null,
    "filters":{{"category":null,"semester":null,"course_type":"zorunlu",
                "language":null}},
    "needs_embedding":false,"top_k":10,"semantic_query":null}}

Soru: "Makine öğrenmesiyle ilgili dersler hangi üniversitede var?"
→ {{"type":"semantic","universities":[],"metric":null,
    "filters":{{"category":"ai","semester":null,"course_type":null,
                "language":null}},
    "needs_embedding":true,"top_k":10,
    "semantic_query":"makine öğrenmesi"}}

Soru: "ODTÜ ve İEÜ'nün matematik yükünü karşılaştır"
→ {{"type":"comparison","universities":["metu","ieu"],
    "metric":"workload",
    "filters":{{"category":"math","semester":null,"course_type":null,
                "language":null}},
    "needs_embedding":false,"top_k":10,"semantic_query":null}}

Soru: "CE 315 nedir?"
→ {{"type":"detail","universities":[],"metric":null,
    "filters":{{"category":null,"semester":null,"course_type":null,
                "language":null}},
    "needs_embedding":false,"top_k":10,"semantic_query":null}}

Şimdi yukarıdaki soruyu sınıflandır ve SADECE JSON döndür."""


# ═══════════════════════════════════════════════════════════════════════════
# ANSWER — Final cevap üretici
# ═══════════════════════════════════════════════════════════════════════════

ANSWER_SYSTEM = """Sen UniCurriculum asistanısın. Türk üniversitelerinin \
bilgisayar ve yazılım mühendisliği müfredatları hakkında soruları \
cevaplıyorsun.

KURALLAR:
- SADECE sana verilen veriye dayalı cevap ver. Veriden emin olmadığın \
bir şeyi UYDURMA.
- Verilerde yoksa açıkça söyle: "Bu bilgi verimizde yok."
- Sayısal karşılaştırmalarda net ol (örn: "ODTÜ 45, İEÜ 38 ders").
- Maksimum 4-5 cümle. Kısa, akıcı, Türkçe.
- SADECE Türkçe cevap ver; İngilizce sızdırma. Ders adlarını orijinal \
dilinde bırak (çevirme).
- Ders kodlarını <ref> etiketi ile sar: örn. <ref>CE 315</ref>.
- Cevabı her zaman JSON formatında döndür — markdown fence, yorum \
VEYA açıklama YAZMA."""


ANSWER_PROMPT = """Kullanıcı sorusu: "{question}"

İlgili veri (yapısal JSON):
{context_json}

Bu veriye dayanarak kullanıcıya Türkçe, akıcı, maksimum 5 cümle cevap \
üret. Ders kodlarını <ref>...</ref> ile sar. Dashboard güncellemesi \
ve 2-3 takip önerisi ekle.

ÇIKTI — SADECE bu şablonda JSON:
{{
  "text": "Türkçe, akıcı cevap (4-5 cümle). Ders kodları <ref>CE 315</ref> gibi.",
  "citations": [
    {{"code": "CE 315", "name": "Ders Adı", "url": "https://...", "university": "ODTÜ"}}
  ],
  "dashboard_update": {{
    "highlight_courses": ["CE 315"],
    "show_chart": null,
    "filter": {{"category": "ai"}},
    "universities_focus": ["metu", "ieu"]
  }},
  "follow_up_suggestions": [
    "Takip sorusu önerisi 1",
    "Takip sorusu önerisi 2"
  ]
}}

ÖNEMLİ:
- "text" alanı 4-5 cümleyi geçmesin.
- "citations" listesindeki dersler TEK TEK obje olmalı (code, name, url,
  university), düz string DEĞİL.
- "dashboard_update.show_chart" şu değerlerden BİRİ veya null:
  "category_distribution", "semester_distribution", "workload_comparison",
  "staff_comparison", "language_distribution"
- Veri yetersizse: text="Bu bilgi verimizde yok." + citations=[],
  dashboard_update=null, follow_up_suggestions alakalı ise doldurulabilir.
- SADECE JSON döndür."""


# ═══════════════════════════════════════════════════════════════════════════
# HATA CEVABI — İki tier da düşerse veya parse başarısızsa kullanılır
# ═══════════════════════════════════════════════════════════════════════════

FALLBACK_ERROR_TEXT = (
    "Sistem şu an yoğun, lütfen biraz sonra tekrar deneyin."
)

FALLBACK_PARSE_ERROR_TEXT = (
    "Üzgünüm, sorunu işlerken bir hata oluştu. Sorunuzu farklı "
    "şekilde ifade etmeyi deneyebilir misiniz?"
)
