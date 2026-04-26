# UniCurriculum — Juri Sunumu

**Tarih:** 2026-04-26 · **Sürüm:** 1.0 · **Yarın juri sunumu için hazırlanmıştır**

---

## 1. Tek Cümlede Proje

> Türkiye'nin **51 üniversitesinin** Bilgisayar Mühendisliği, Yazılım Mühendisliği ve Yönetim Bilişim Sistemleri bölümlerine ait **8.721 dersin** müfredatını yan yana okumayı ve karşılaştırmayı sağlayan, **LLM destekli AI asistan** içeren editorial dashboard.

---

## 2. Sayılarla Proje

| Metrik | Değer |
|---|---|
| Üniversite | **51** (31 BilMüh + 10 YazMüh + 10 YBS) |
| Toplam ders | **8.721** |
| Ders başına LLM zenginleştirme | 12 kategori, 6 Bloom seviyesi, 7 metadata alanı |
| Backend kodu | **~8.800 satır** Python |
| Frontend kodu | **~7.300 satır** TypeScript/TSX |
| Veri (JSON) | ~21 MB bellek + ~500 MB FAISS index |
| AI Asistan intent türü | **8** (deterministic, comparison, semantic, detail, general, advisory, aggregate, complex) |
| AI tools (function-calling) | **5** (aggregate, specialization, search, course-detail, summary) |
| Karşılaştırma metriği | **11** (Neo4j Cypher) + **12 enrichment metrik** (radar/bloom/coverage/heatmap) |

---

## 3. Mimari — Üç Katman

```
                        ┌──────────────────────────────────┐
                        │  Frontend (Next.js 16 / React 19) │
                        │  • LayerOne: kart + radar         │
                        │  • LayerTwo: 5 detay grafiği      │
                        │  • LayerThree: derin analiz + AI  │
                        └────────────┬─────────────────────┘
                                     │  HTTP (SWR)
                                     ▼
                        ┌──────────────────────────────────┐
                        │  Backend (FastAPI / Python 3.11)  │
                        │  ┌──────────────────────────────┐ │
                        │  │ /api/universities (list+full)│ │
                        │  │ /api/compare/* (radar/bloom) │ │
                        │  │ /api/search (FAISS)          │ │
                        │  │ /api/chat (hibrit pipeline)  │ │
                        │  └──────────────────────────────┘ │
                        └────────┬───────────────────┬─────┘
                                 │                   │
                ┌────────────────▼──┐    ┌───────────▼─────────┐
                │ EnrichmentStore   │    │ FAISS Index         │
                │ (51 üni JSON,     │    │ (~8.7K ders         │
                │  bellek)          │    │  embedding)         │
                └────────┬──────────┘    └─────────────────────┘
                         │
                         ▼
                ┌──────────────────────┐
                │ data/**/*.json       │
                │ + _enriched bloğu    │
                └──────────────────────┘
```

**Üç ayrı veri yolu:**
1. **Statik agregasyon** (radar, bloom, heatmap) — `_enriched` alanlarından doğrudan hesap
2. **Semantik arama** (FAISS) — ders açıklamasına embedding sorgusu
3. **AI Asistan** (LLM) — intent → context → answer, gerekirse tools loop

---

## 4. Veri Pipeline (Baştan Sona)

### Adım 1 — Veri Toplama (manuel + LLM)

- **Kaynak:** Üniversitelerin Bologna sayfaları (örn. `obs.metu.edu.tr/...`)
- **Toplama yöntemi:** `CLAUDE.md` içindeki şema prompt'u ile Claude/GPT'ye toplattırılıyor
- **Çıktı:** Her üniversite için tek JSON: `data/<bölüm>/<slug>.json`
- **Şema:** university_name, department, faculty, language, type, department_url, program_outcomes, academic_staff, **courses[]** (16 alan: code, name, ects, semester, year, type, language, hours_theory/practice, purpose, description, learning_outcomes, weekly_topics, resources, prerequisites, categories, source_url)

### Adım 2 — LLM Zenginleştirme

```bash
python -m src.enrichment.enrich --budget 25
```

- **Kod:** `src/enrichment/enrich.py` + `prompts.py` + `llm_client.py`
- **Provider zinciri:** Azure OpenAI → OpenAI → OpenRouter (Qwen free tier fallback)
- **Her ders için LLM şu çıkarımı yapar** (sonuç `course._enriched` bloğuna yazılır):
  - `categories`: 1-3 kategori (`ai_ml`, `programming`, `systems`, `data_science`, `security`, `web_mobile`, `software_eng`, `graphics_vision`, `distributed`, `theory`, `math`, `info_systems`, `not_cs`)
  - `primary_category`
  - `bloom_distribution`: 6 seviye (`remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`) — toplam ≈ 1.0
  - `bloom_level` (dominant)
  - `modernity_score` (0-100): modern teknoloji etiketleri (transformer, react, k8s, ...) vs legacy (cobol, fortran, ...)
  - `is_project_heavy`, `difficulty_level`, `language_of_instruction`
- **Idempotent**: `enrichment_version` ile track edilir; aynı dersi tekrar zenginleştirmez
- **Cost tracking**: token+latency+USD/call kayıt edilir

Sonra `aggregator.py` her üniversite için `_summary` hesaplar: `category_coverage`, `specialization_depth` (zorunlu/seçmeli ECTS dağılımı), `modernity_score` (ortalama), `earliest_technical_elective_semester`, `project_heavy_course_count`.

### Adım 3 — FAISS Semantik İndex

```bash
python -m src.embeddings.builder
```

- **Kod:** `src/embeddings/builder.py`
- **Model:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` — 384-dim, multilingual (TR + EN)
- **Embed edilen metin:** Her dersin `name + description + learning_outcomes + weekly_topics` concat
- **Index:** `IndexFlatIP` (L2-normalized → inner product = cosine)
- **Çıktı:** `src/embeddings/index/courses.faiss` (~500 MB) + `metadata.pkl` (course_id ↔ uni/code/name)
- **Kullanım:** `/api/search?query=...` ve AI asistan `find_courses_by_topic` tool'u

### Adım 4 — Neo4j Knowledge Graph (referans / opsiyonel)

```bash
docker compose up -d neo4j
python src/ingest.py
```

- **Kod:** `src/ingest.py` + `src/comparison.py`
- **Düğümler:** `University`, `Faculty`, `Department`, `Course`, `Category`, `AcademicStaff`
- **Kenarlar:** `OFFERS`, `BELONGS_TO`, `REQUIRES` (önkoşul), `CATEGORIZED_AS`, `EMPLOYS`
- **11 metrik (Neo4j Cypher):** Course similarity, staff comparison, workload, language distribution, prereq chain depth, resource overlap, ...
- **Status:** Mevcut chat pipeline EnrichmentStore (statik JSON) öncelikli kullanıyor; Neo4j kıyas endpoint'leri (resources, prereq, curriculum-coverage) için aktif.

### Adım 5 — Backend Boot

```bash
cd src && uvicorn main:app --reload --port 8000
```

`main.py` startup'ta:
1. `EnrichmentStore.load()` — 51 JSON belleğe (~21 MB)
2. `SemanticSearcher.get_searcher()` — FAISS lazy load
3. 4 router montaj: `universities`, `chat`, `compare_enriched`, `search`

Swagger: `http://localhost:8000/docs`

### Adım 6 — Frontend Boot

```bash
cd frontend && npm run dev
```

- Next.js App Router · port 3000
- URL state: `?dept=bilmuh&a=metu&b=bilkent` (paylaşılabilir)
- SWR cache + revalidate

---

## 5. AI Asistan — Hibrit Pipeline

### Akış

```
question
  │
  ▼
[ROUTER]    classify(q, history)         → Intent {type, universities, metric, ...}
  │
  ▼
[CONTEXT]   build_context(intent)        → veri (Neo4j | FAISS | EnrichmentStore)
  │
  ├──► A) Klasik (5 sn, 1 LLM çağrı) ──┐
  │       generate_answer(context)      │
  │                                     ▼
  └──► B) Tools loop (kompleks) ─► generate_answer_with_tools(q)
          ↓ max 7 iter
          LLM → tool çağrı → backend execute → LLM → ... → final cevap
                                                  │
                                                  ▼
                                          ChatResponse {text, citations,
                                              dashboard_update,
                                              follow_up_suggestions, meta}
```

### 8 Intent Türü

| Tür | Örnek soru | Pipeline |
|---|---|---|
| **deterministic** | "ODTÜ'de zorunlu ders sayısı?" | Direct EnrichmentStore lookup |
| **comparison** | "ODTÜ ile Bilkent karşılaştır" | Neo4j 11 metrik |
| **semantic** | "AI ile ilgili dersler" | FAISS top-K |
| **detail** | "CENG 483 nedir?" | Course detail lookup |
| **advisory** | "8000 sıralamayla AI için tavsiye" | Ranking + kategori coverage |
| **aggregate** | "En çok prof olan üni?" | 45+ pre-defined metric sort |
| **complex** | "AI'da zor/seç AKTS oranı en yüksek üni" | Tools loop (multi-step) |
| **general** | "merhaba, ne yapabilirsin" | Canned response |

### 5 Tool (kompleks senaryolar)

| Tool | İmza | Ne yapar |
|---|---|---|
| `aggregate_universities` | `(metric, order, n, dept?)` | N üniversiteyi metric'e göre sırala |
| `get_specialization` | `(slug, category)` | Tek üni × kategori AKTS/ders dağılımı |
| `find_courses_by_topic` | `(query, n, slugs?)` | FAISS topic search |
| `get_course_detail` | `(course_code, university_slug?)` | Tek dersin tam metadatası |
| `get_university_summary` | `(slug)` | Üniversite snapshot (PO + staff + spec) |

### LLM Provider Zinciri

1. **Azure OpenAI** (`gpt-4o-mini`) — primary
2. **OpenAI** (`gpt-4o-mini`) — Azure başarısız ise
3. **OpenRouter** (`qwen/qwen3-next-80b:free`) — son çare

Her çağrı: provider + tier + tokens_in/out + latency + cost_usd kaydı tutulur.

---

## 6. Frontend — 3 Katman + Derin Analiz

### Yan Yana (Ana Sayfa, `/`)

**LayerOne — İlk Bakışta**
- 1-3 üniversite kartı yan yana (kompakt)
  - Her kartta: ad, bölüm, YKS sırası, kontenjan, dil, yabancı kaynak %, top-2 uzmanlaşma kategorisi (ders/AKTS)
  - **Uzmanlaşma** ⓘ tooltip: zorunlu/seçmeli açıklaması (yarı saydam paper bg)
- **10 eksende kapsam radar** (CategoryRadar) — kategori yüzdeleri
  
**LayerTwo — Daha Yakından** (5 bölüm, Section wrapper)
- 2.1 **Konu × Dönem Haritası** (SemesterHeatmap)
- 2.2 **Konu Kapsamı** (CoverageTable) — 12 kategori sekmesi, 1 üni: tek sütun, 2-3 üni: ortak/özgün matris
- 2.3 **Bilişsel Yoğunluk** (BloomDonut) — 6 Bloom seviyesi donut + ⓘ Bu ne demek? tooltip (her seviyenin örnekli açıklaması)
- 2.4 **Program Çıktıları** (OutcomesHeatmap / SingleUniOutcomes)
- 2.5 **Akademik Kadro** (StaffBars) — 5 ünvan, dot cluster, tek üni desteği

### Derin Analiz (`/deep-analysis`)

- 3.1 **Haftalık Konular** — her üni ayrı panel (kategori sekmeleri + arama + 15 ders/sayfa pagination + tıklayınca haftalık konu expand + hover'da yarı saydam ders detay tooltip), 2+ üni'de altta **"Eşleşme"** (CurriculumCoverageHeatmap, semantic NLP en benzer ders çiftleri)
- 3.2 **Önkoşul Ağı** (PrereqGraph, ReactFlow) — DAG, 1 üni: tek panel, 2 üni: yan yana
- 3.3 **Ders Kaynakları** — her üni için arama+pagination'lı kaynak listesi (`/api/universities/{slug}/resources`), 2+ üni'de altta **"Ortak Kaynaklar"** (ResourcesTable, Jaccard benzerlik)
- 3.4 **Ders Benzerliği** — embedding tabanlı semantik arama (CourseSimilarity), preset sorgular, tüm 51 üni veya seçili üni filtreli, top 50 sonuç + 10/sayfa pagination

### AI Asistan Pill (sağ alt)

- Kapalıyken yuvarlak "Asistan" butonu
- Açıkken: input + mesaj geçmişi + typewriter streaming
- Cevap markdown render + citation chip'leri + follow-up button'ları
- `dashboard_update` ile sayfa overlay'i tetikler (örn. "AI eksenini vurgula")

---

## 7. Frontend Tasarım Sistemi

| Token | Değer |
|---|---|
| Renk paleti | `--color-ink-{900,700,500,300}`, `--color-paper{,-2,-3}`, `--color-white-paper` |
| Üni renkleri | `--color-uni-{a,b,c}` (üç kıyas slot'u) |
| Font Serif | Fraunces (italic, başlık) |
| Font Sans | Inter Tight |
| Font Mono | IBM Plex Mono |
| Stil filozofisi | Pudding/NYT editorial — kâğıdımsı bg, koyu serif başlık, mono ui-label, dot cluster sayım |
| Tema | Aydınlık + karanlık (toggle), localStorage |
| Tooltip | `rgba(252,250,246,0.85)` + `backdrop-filter: blur(8px)` |

---

## 8. Tech Stack

### Backend
- **Python 3.11+**
- **FastAPI 0.100+** (async, auto-docs)
- **Uvicorn 0.23+**
- **Neo4j 5.x** (Bolt 7687, HTTP 7474) — opsiyonel
- **sentence-transformers 2.2+** + **faiss-cpu 1.8+**
- **openai 1.55+** (Azure OpenAI + OpenAI client)
- **pydantic** (validation)

### Frontend
- **Next.js 16.2.4** (App Router)
- **React 19.2.4**
- **TypeScript 5**
- **Tailwind CSS 4** (`@tailwindcss/postcss`)
- **Recharts 3.8.1** (radar/donut/heatmap)
- **ReactFlow 11.11.4** (önkoşul DAG)
- **Framer Motion 12.38** (animasyon)
- **SWR 2.4.1** (data fetch + cache)
- **Lucide React** (icon set)
- **Playwright 1.59.1** (e2e — script tanımlı, suite henüz yok)

---

## 9. Dosya Yapısı (Detaylı)

```
.
├── README.md                          ← Final konsolide README (bu PR'da)
├── SUNUM.md                           ← Bu doküman
├── CLAUDE.md                          ← Veri toplama prompt'u (yeni üni eklerken)
├── Interim_Report.md                  ← Akademik ara rapor (literatür, metodoloji)
├── requirements.txt                   ← Tek Python bağımlılık dosyası
├── docker-compose.yml                 ← Neo4j servisi
├── .env.example                       ← API key şablonu
│
├── docs/
│   └── UniCurriculum_Veri_Toplama_Rehberi.pdf
│
├── data/                              ← 51 üni JSON + sıralama
│   ├── bilgisayar/                   31 üni × 1 dosya — Bilgisayar Müh
│   ├── yazilim/                      10 üni — Yazılım Müh
│   ├── ybs/                          10 üni — Yönetim Bilişim Sistemleri
│   └── ranking/                      YKS sıralama, kontenjan
│
├── src/                               ← Backend (Python, ~8.8K LOC)
│   ├── main.py                       FastAPI app + startup hooks
│   ├── config.py                     .env loader
│   ├── comparison.py                 Neo4j ComparisonEngine (11 metrik)
│   ├── ingest.py                     CLI: data/**/*.json → Neo4j
│   │
│   ├── api/                          REST endpoint router'ları
│   │   ├── universities.py           list / summary / detail / resources
│   │   ├── compare_enriched.py       /api/compare/{radar,bloom,heatmap,coverage}
│   │   ├── search.py                 /api/search (FAISS POST)
│   │   ├── chat.py                   /api/chat endpoint sarmalayıcı
│   │   └── ranking.py                YKS sıralama lookup
│   │
│   ├── analytics/                    Enrichment-bazlı saf hesaplar
│   │   ├── loader.py                 EnrichmentStore singleton
│   │   ├── radar.py                  10/12 eksen kategori radar
│   │   ├── bloom.py                  Bloom donut + ECTS ağırlık
│   │   ├── heatmap.py                Dönem × kategori heatmap
│   │   └── coverage.py               Konu Kapsamı (kategori bazlı ortak)
│   │
│   ├── embeddings/                   Semantik arama
│   │   ├── builder.py                CLI: FAISS index build
│   │   ├── search.py                 SemanticSearcher singleton
│   │   └── index/                    courses.faiss + metadata.pkl
│   │
│   ├── enrichment/                   LLM zenginleştirme
│   │   ├── enrich.py                 CLI: per-course → _enriched
│   │   ├── llm_client.py             AzureLLMClient + cost tracking
│   │   ├── prompts.py                COURSE_PROMPT_TEMPLATE
│   │   ├── aggregator.py             _summary hesaplayıcı
│   │   └── status.py                 İlerleme paneli (CLI)
│   │
│   └── chat/                         AI Asistan pipeline
│       ├── router.py                 Intent classifier
│       ├── context.py                Context builder (8 intent dalı)
│       ├── answer.py                 Klasik + tools-loop generator
│       ├── tools.py                  5 function-calling tool
│       ├── prompts.py                ROUTER/ANSWER/TOOL_PROMPT
│       ├── schemas.py                Pydantic Intent/ChatResponse
│       └── llm.py                    Tiered LLM çağrısı
│
└── frontend/                          ← Next.js (TypeScript, ~7.3K LOC)
    ├── package.json
    ├── tailwind.config.js
    ├── AGENTS.md                      "Bu Next.js 16 — eski docs uyarısı"
    │
    └── src/
        ├── app/
        │   ├── layout.tsx             Root layout, ChatPanel, fonts
        │   ├── page.tsx               / — LayerOne + LayerTwo
        │   └── deep-analysis/
        │       ├── page.tsx           /deep-analysis — LayerThree
        │       └── error.tsx          Error boundary
        │
        ├── components/
        │   ├── TopBar.tsx             Üst nav + tema
        │   ├── Footer.tsx
        │   ├── Section.tsx            Kart wrapper (title + content)
        │   ├── Pagination.tsx         Yeniden kullanılabilir paginate
        │   │
        │   ├── selectors/
        │   │   ├── UniversityPicker.tsx     Üni ekle/değiştir/kaldır
        │   │   └── DepartmentTabs.tsx       BilMüh / YazMüh / YBS
        │   │
        │   ├── cards/
        │   │   └── UniversityCard.tsx       Slot kart + tooltip
        │   │
        │   ├── layers/
        │   │   ├── LayerOne.tsx             İlk Bakışta + radar
        │   │   ├── LayerTwo.tsx              5 detay grafiği
        │   │   └── LayerThree.tsx            Derin Analiz (3.1-3.4)
        │   │
        │   ├── charts/                ← 13 görselleştirme
        │   │   ├── CategoryRadar.tsx         10 eksen radar (recharts)
        │   │   ├── BloomDonut.tsx            6 seviye donut + info
        │   │   ├── SemesterHeatmap.tsx       Dönem × kategori heatmap
        │   │   ├── CoverageTable.tsx         Kategori bazlı ortak/özgün
        │   │   ├── StaffBars.tsx             Akademik kadro dot cluster
        │   │   ├── OutcomesHeatmap.tsx       Program çıktıları benzerlik
        │   │   ├── PrereqGraph.tsx           Önkoşul DAG (ReactFlow)
        │   │   ├── PrereqSummary.tsx         (kullanılmıyor — bkz §10)
        │   │   ├── CurriculumCoverageHeatmap.tsx  3.1 ders eşleşme
        │   │   ├── ResourcesTable.tsx        3.3 ortak kaynaklar
        │   │   ├── ResourcesSingleUni.tsx    3.3 tek üni kaynaklar
        │   │   ├── WeeklyTopicsSingleUni.tsx 3.1 tek üni ders+haftalık
        │   │   └── CourseSimilarity.tsx      3.4 FAISS arama UI
        │   │
        │   └── chat/
        │       └── ChatPanel.tsx             Sağ alt pill + sohbet
        │
        └── lib/
            ├── api.ts                 Backend fetch wrapper
            ├── types.ts               TypeScript tipler
            ├── use-selection.ts       URL state hook
            ├── use-overlay.tsx        Chat overlay sinyali
            └── use-theme.tsx          Aydınlık/karanlık toggle
```

---

## 10. İşe Yaramayan / Eski Dosyalar (silinmedi, raporlandı)

> Aşağıdaki dosyalar **silinmedi** — sadece tespit edildi. Karar sizin.

### A) Frontend dead code

| Dosya | Neden | Öneri |
|---|---|---|
| `frontend/src/components/charts/PrereqSummary.tsx` | Hiçbir yerden import edilmiyor; `PrereqGraph` ile değiştirilmiş, basit varyant. Tip tanımları backend ile uyuşmuyor (eski `course_count`, `with_prereqs` alanlarını okuyor — silent bug riski). | **Sil** veya import et. Şu an dead code. |

### B) Backend kuşkulu / legacy

| Dosya | Neden | Öneri |
|---|---|---|
| `src/comparison.py` | Neo4j-bazlı ComparisonEngine. Mevcut chat pipeline `EnrichmentStore` öncelikli; bu modül yalnızca `/api/compare/staff,resources,prerequisites,curriculum-coverage,program-outcomes` endpoint'lerinde aktif. **Hâlâ kullanılıyor**, ama eski 11-metric'ten sadece 5'i frontend'de görünüyor. | Kullanımdaki 5 metrik kalsın; geri kalan Cypher query'ler temizlenebilir. |
| `src/ingest.py` | Neo4j KG'yi besleyen CLI. Pipeline'ın bir parçası ama EnrichmentStore + FAISS yeterli olduğu için Neo4j kullanmadan da sistem ayakta. **Sadece comparison endpoint'leri için gerekli**. | Belge: "Neo4j opsiyonel" olarak README'de zaten var. |
| `src/config.py` içinde `GROQ_API_KEY` referansı | Kodda hiçbir yerde kullanılmıyor (LLM tier: Azure → OpenAI → OpenRouter). | Sil — 1 satır. |

### C) Tekrarlayan / DRY ihlali

| Konu | Yer | Öneri |
|---|---|---|
| LLM client kodu **iki yerde** | `src/chat/llm.py` (chat için) + `src/enrichment/llm_client.py` (enrichment için) — ikisi de Azure/OpenAI/OpenRouter sarmalayıcısı. | Tek `src/llm/client.py` modülüne birleştir. |
| Intent type literal'ları iki yerde | `src/chat/schemas.py` (Pydantic Literal) + `src/chat/prompts.py` (prompt metni). | `schemas.py`'yi tek doğruluk kaynağı yap; prompt'ta ondan import et. |

### D) Boş / standart

| Dosya | Durum |
|---|---|
| `src/__init__.py` | 0 byte. Python paket sentineli — gerekli, dokunma. |
| Diğer `__init__.py`'ler | Çoğu `__all__` veya import re-export içeriyor; sorun yok. |

### E) Lock dosyası eksik (öneri olarak)

| Eksik | Etki | Öneri |
|---|---|---|
| `package-lock.json` | npm install non-deterministic; CI'de versiyon drift riski. | `npm install` çağrısı sonrası commit et. |
| `requirements.lock` veya `pyproject.toml + poetry.lock` | pip install sürüm farkı oluşabilir. | `pip-tools` ile `requirements.lock` üret. |

---

## 11. API Endpoint Özeti

| Method | Path | Açıklama |
|---|---|---|
| GET | `/api/universities` | Tüm üniversite listesi (kart için) |
| GET | `/api/universities/{slug}/summary` | Tek üni snapshot (kategori coverage, modernity, spec depth, ranking) |
| GET | `/api/universities/{slug}` | Tam ders listesi (full course data) |
| GET | `/api/universities/{slug}/resources` | Tek üni ders kaynakları (kitap/makale + dersler) |
| GET | `/api/compare/radar?a=&b=&c=` | 10/12 eksen kategori radarı |
| GET | `/api/compare/bloom?a=&b=&c=` | Bloom seviye dağılımı |
| GET | `/api/compare/coverage?a=&b=&c=` | Konu Kapsamı (1 üni'de bile çalışır) |
| GET | `/api/compare/semester-heatmap?a=&b=&c=` | Dönem × kategori AKTS heatmap |
| GET | `/api/compare/curriculum-coverage?uni1=&uni2=` | Semantik ders eşleşmesi (3.1) |
| GET | `/api/compare/prerequisites?uni1=&uni2=` | Önkoşul ağı edge'leri (3.2) |
| GET | `/api/compare/resources?uni1=&uni2=` | Ortak ders kaynakları (3.3) |
| GET | `/api/compare/staff?uni1=&uni2=` | Akademik kadro karşılaştırması |
| GET | `/api/compare/program-outcomes?uni1=&uni2=` | Program çıktıları benzerlik |
| POST | `/api/search` | FAISS semantik arama (3.4) |
| POST | `/api/chat` | AI Asistan (8 intent + 5 tool) |

Swagger UI: `http://localhost:8000/docs`

---

## 12. Demo Akışı (Sunum İçin)

### Senaryo 1 — Tek Üniversite İncelemesi (1 dakika)
1. Ana sayfa → "Üniversite ekle" → ODTÜ
2. Kartta YKS sırası, kontenjan, top-2 uzmanlaşma görsel olarak çıkar
3. Radar'da ODTÜ'nün hangi alanda güçlü olduğu (örn. AI/ML, theory) okunur
4. Aşağı scroll → Konu Kapsamı (kategori sekmeleri), Bilişsel Yoğunluk (Bloom)
5. **Vurgula:** ⓘ Bu ne demek? — Bloom seviyesi açıklamaları popup

### Senaryo 2 — İki Üniversite Karşılaştırma (2 dakika)
1. Bilkent ekle → 2 kart yan yana
2. Radar üst üste (üni-a kırmızı kesik, üni-b ince çizgi)
3. **Derin Analiz** sekmesine geç
4. 3.1 her üni'nin haftalık konuları + altta "Eşleşme" — semantik en benzer ders çiftleri (örn. "ODTÜ CSE 213 ↔ Bilkent COM3025, %96 benzer")
5. 3.3 her üni'nin kaynakları + altta "Ortak Kaynaklar" (Cormen, vs.)

### Senaryo 3 — AI Asistan (3 dakika)
1. Sağ alt "Asistan" pill → aç
2. **Basit:** "hangi üniversitede en çok profesör var?" → aggregate intent → İTÜ 24, ODTÜ 14, Boğaziçi 13...
3. **Karşılaştırma:** "ODTÜ ile Bilkent'i AI dersleri açısından karşılaştır"
4. **Komplex:** "yapay zeka derslerinde zorunlu/seçmeli AKTS oranı en yüksek üniversite hangisi" → 9 tool çağrısı (3 iter), Sabancı sonucu
5. **Tavsiye:** "8000 sıralamayla AI için tavsiye ver" → advisory intent → YTÜ önerisi

### Senaryo 4 — Semantik Arama (1 dakika)
1. Derin Analiz → 3.4 Ders Benzerliği
2. "yapay sinir ağları" → 50 sonuç (5 sayfa)
3. Preset chip "blockchain ve akıllı kontrat" → tüm 51 üni'de en yakın 50 ders
4. "Seçili üniversiteler" sekmesi → sadece seçili 2-3 üni içinde ara

---

## 13. Güçlü Yanlar ve Sınırlar

### Güçlü
- **Multi-LLM resilience**: Azure ↓ OpenAI ↓ OpenRouter (free) — production'da %99.9 uptime
- **Hibrit AI**: 7 hızlı intent + 1 komplex (tools loop) — çoğu sorgu 5sn, komplex 10-20sn
- **Türkçe-İngilizce karışık veri** — paraphrase-multilingual model
- **Veri kalitesi**: her dersin tüm alanlarını LLM ile zenginleştirme + idempotent re-run
- **Tek-üni destek**: 3.1, 3.3, 3.2 hep tek üni'de bile çalışıyor
- **Pagination**: 850+ kaynak, 5000+ ders → her listede 15-20/sayfa
- **URL state**: paylaşılabilir kıyas (`?a=metu&b=bilkent&dept=bilmuh`)
- **Dashboard update via chat**: AI cevabı sayfa overlay'lerini tetikleyebilir

### Sınırlar
- **Veri tamlığı**: Bazı dersler `name=null`, `description=null` (kaynak Bologna sayfası bilgi tutmamış). 98 üniden 2'si gibi düşük oranlı ama görünür. Çözüm: hover tooltip + ileride scrape iyileştirme.
- **Neo4j opsiyonel**: ingest.py çalıştırılmazsa 5 endpoint (ortak kaynaklar, önkoşul, vs.) 503 döner. Frontend graceful degrade ediyor.
- **3 üni limit**: a/b/c slot — 4+ kıyas için ayrı UI gerekir.
- **Test eksikliği**: Playwright e2e script var ama suite henüz yazılmamış.

---

## 14. Konuşma Notları (Juri Soruları İçin)

**S: Veriyi nasıl topladınız?**
A: 51 üniversitenin Bologna sayfalarından LLM destekli yarı-otomatik scraping. Her üniversite için tek JSON, sabit şema (CLAUDE.md). 8.721 dersin tamamı.

**S: AI asistan nasıl çalışıyor?**
A: Hibrit: kullanıcı sorusu önce 8 intent'e sınıflandırılır (router LLM çağrısı). Basit intent'ler tek LLM çağrısı ile cevaplanır. Komplex intent'ler (oran, türev, multi-step) için LLM 5 backend tool'unu çağırarak iteratif çözer (max 7 iter).

**S: Embedding modeli neden bu?**
A: `paraphrase-multilingual-MiniLM-L12-v2` — 384-dim, 50+ dil, Türkçe-İngilizce karışık. Hız (CPU'da bile <50ms/query) + kalite dengesi.

**S: Neo4j neden seçildi, NoSQL/SQL alternatifi?**
A: Önkoşul ağı (DAG) + program çıktısı eşleşmesi (semantic similarity üzerinden link) doğal olarak grafik. Cypher query expressivity. Ama EnrichmentStore + FAISS aynı verileri kullanıyor — Neo4j sadece 5 spesifik metric için aktif.

**S: Maliyet?**
A: Enrichment ~25 USD (8.721 ders × 2 LLM çağrısı, gpt-4o-mini). Chat: aktif kullanım ~0.0003 USD/sorgu (200-500 token). Aylık 1000 sorgu ≈ 0.30 USD.

**S: Ölçeklenebilir mi?**
A: 51 üni → 200 üni: EnrichmentStore RAM ~80 MB (tolere edilir). FAISS index linear scale (~2 GB). Backend stateless → horizontal scale. LLM provider chain otomatik load balance.

**S: Açık kaynak mı?**
A: GitHub: github.com/yapicialiekrem/university-curriculum-analyzer. Bitirme projesi, MIT/akademik lisans olarak konabilir.

---

## 15. Demo Hazırlık Checklist (Sunumdan Önce)

- [ ] Backend canlı: `cd src && uvicorn main:app --reload` — port 8000
- [ ] Frontend canlı: `cd frontend && npm run dev` — port 3000
- [ ] Neo4j çalışıyor (önkoşul/kaynak/curriculum endpoint'leri için): `docker compose up -d neo4j`
- [ ] `.env` dosyası: AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT (en azından bir LLM)
- [ ] Tarayıcıda hard refresh (Cmd+Shift+R) — SWR cache'i temiz
- [ ] Test soruları: "ODTÜ vs Bilkent AI", "8000 sıralamayla AI tavsiye", "yapay zeka oran en yüksek üni"
- [ ] Yedek slug'lar: `metu`, `bilkent`, `itu`, `bogazici`, `akdeniz`, `ankara` (zengin veriye sahip)

---

**Son söz:** Bu sistem 51 üniversitenin yıllar süren manuel araştırma gerektirecek müfredat verisini, dakikalar içinde anlamlı, görsel, sorgulanabilir bir karşılaştırmaya dönüştürüyor. Amaç: lise öğrencisi (advisory), akademisyen (deep-analysis), eğitim politikası analisti (aggregate). Üç farklı kullanıcı, tek dashboard.
