# university-curriculum-analyzer

AI-destekli üniversite müfredat karşılaştırma sistemi. Türkiye'deki bilgisayar mühendisliği bölümlerinin müfredatlarını Neo4j Knowledge Graph ve NLP gömme vektörleri kullanarak 11 farklı metrikle karşılaştırır.

## Proje Yapısı

```
university-curriculum-analyzer/
├── src/                       # Backend kaynak kodu
│   ├── config.py              # Neo4j bağlantı ayarları
│   ├── ingest.py              # JSON → Neo4j veri yükleme
│   ├── comparison.py          # 11 karşılaştırma metriği
│   └── main.py                # FastAPI REST sunucu
├── static/
│   └── index.html             # Web arayüzü
├── data/                      # Üniversite müfredat verileri (JSON)
│   └── *.json
├── docs/
│   └── UniCurriculum_Veri_Toplama_Rehberi.pdf
├── requirements.txt           # Python bağımlılıkları
├── docker-compose.yml         # Neo4j için Docker kurulumu
├── .env.example               # Ortam değişkeni şablonu
└── CLAUDE.md                  # Veri toplama rehberi
```

## Kurulum

### 1. Bağımlılıkları yükle

```bash
pip install -r requirements.txt
```

### 2. Neo4j'yi başlat

```bash
docker-compose up -d
```

Veya manuel Docker komutu ile:

```bash
docker run -d --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password_here \
  neo4j:latest
```

### 3. Ortam değişkenlerini ayarla

```bash
cp .env.example .env
# .env dosyasını Neo4j şifrenizle düzenleyin
```

### 4. Verileri yükle

```bash
python -m src.ingest
```

`data/` klasöründeki tüm JSON dosyalarını Neo4j'ye yükler.

### 5. Sunucuyu başlat

```bash
uvicorn src.main:app --reload
```

- Web arayüzü: http://localhost:8000
- API dokümantasyonu: http://localhost:8000/docs

## Karşılaştırma Metrikleri

| # | Endpoint | Açıklama |
|---|----------|----------|
| 1 | `/api/compare/courses` | Semantik ders benzerliği (NLP) |
| 2 | `/api/compare/staff` | Akademik kadro karşılaştırması |
| 3 | `/api/compare/workload` | ECTS ve teori/pratik saatleri |
| 4 | `/api/compare/program-outcomes` | Program çıktıları benzerliği |
| 5 | `/api/compare/learning-outcomes` | Ders öğrenme çıktıları |
| 6 | `/api/compare/curriculum-coverage` | Haftalık konu örtüşmesi |
| 7 | `/api/compare/prerequisites` | Ön koşul ağacı karmaşıklığı |
| 8 | `/api/compare/semester-distribution` | Dönem/yıl bazlı dağılım |
| 9 | `/api/compare/mandatory-elective` | Zorunlu/seçmeli ders oranı |
| 10 | `/api/compare/language-distribution` | Türkçe/İngilizce dağılımı |
| 11 | `/api/compare/resources` | Ortak ders kaynakları |

## AI Chat Endpoint (`/api/chat`)

Doğal dilde sorulan sorular, yapısal bir JSON cevaba dönüştürülür:

```
Soru → classify() → build_context() → generate_answer() → JSON
       (1 LLM)     (Neo4j + FAISS)   (1 LLM)
```

### Kurulum

```bash
# .env dosyasına:
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-v1-...   # fallback (opsiyonel)

# FAISS semantic index'i oluştur (tek seferlik)
python -m src.embeddings.builder
```

### Kullanım

```bash
curl -X POST http://localhost:8000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"question":"Makine öğrenmesiyle ilgili dersler hangi üniversitede var?"}'
```

Cevap formatı:

```json
{
  "text": "<ref>CENG499</ref> dersi ODTÜ'de, ...",
  "citations": [
    {"code": "CENG499", "name": "Intro. to Machine Learning",
     "url": "...", "university": "Orta Doğu Teknik Üniversitesi"}
  ],
  "dashboard_update": {
    "highlight_courses": ["CENG499"],
    "show_chart": null,
    "filter": {"category": "ai"},
    "universities_focus": ["metu"]
  },
  "follow_up_suggestions": ["Derin öğrenme dersleri?", "AKTS dağılımı?"],
  "meta": {
    "intent_type": "semantic",
    "latency_ms": 2134,
    "llm": {"status":"ok","tier":"primary","tokens_in":820,"tokens_out":310,"cost_usd":0.000309}
  }
}
```

### Intent tipleri

| Tip | Açıklama | Örnek |
|---|---|---|
| `deterministic` | Sayısal / filtrelenebilir | "ODTÜ'de kaç zorunlu ders var?" |
| `comparison` | İki+ üniversite kıyası | "ODTÜ ve İEÜ'nün matematik yükünü karşılaştır" |
| `semantic` | Konu bazlı arama | "Görüntü işleme dersleri" |
| `detail` | Spesifik ders/üni | "CE 315 nedir?" |
| `general` | Sistem hakkında | "Bu veriler nasıl toplandı?" |

Her LLM çağrısı `logs/llm.jsonl`'e kaydedilir (tokens, latency, cost).

Legacy Groq endpoint: `POST /api/chat-legacy` (deprecated).

## Yeni Üniversite Eklemek

1. `CLAUDE.md` dosyasındaki formata uygun bir JSON dosyası oluştur
2. Dosyayı `data/` klasörüne koy
3. `python -m src.ingest` ile Neo4j'ye yükle
4. `python -m src.embeddings.builder` ile FAISS index'i yenile

## Teknolojiler

- **Neo4j** — Bilgi grafiği veritabanı
- **sentence-transformers** — Çok dilli NLP gömme vektörleri (`paraphrase-multilingual-MiniLM-L12-v2`)
- **FAISS** — Semantik ders arama index'i (`IndexFlatIP`, 384D)
- **OpenAI gpt-4o-mini** (primary) / **OpenRouter Qwen** (fallback) — chat LLM
- **FastAPI** — REST API sunucusu
- **scikit-learn** — Kosinüs benzerlik hesabı
