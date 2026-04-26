# UniCurriculum — University Curriculum Analyzer

> Türkiye üniversitelerinin **Bilgisayar Mühendisliği**, **Yazılım Mühendisliği**
> ve **Yönetim Bilişim Sistemleri** programlarının müfredatlarını yan yana
> okumayı sağlayan editorial dashboard. LLM destekli sohbet, semantik konu
> arama, Bloom taksonomisi analizi ve önkoşul ağı görselleştirmesi içerir.

**51 üniversite × 3 bölüm × 8721 ders.** Pipeline: JSON → LLM enrichment →
FAISS semantic index + Neo4j KG → FastAPI backend → Next.js 16 dashboard +
hibrit AI asistan (8 intent, 5 tool).

> 📊 **Sunum / juri için detaylı doküman:** [`SUNUM.md`](./SUNUM.md) — pipeline'ın
> baştan sona anlatımı, dosya yapısı, AI asistan iç işleyişi, demo akışı,
> ölü kod tespiti.
>
> 📚 **Akademik ara rapor:** [`Interim_Report.md`](./Interim_Report.md) — literatür,
> metodoloji, mimari kararlar.
>
> 📋 **Yeni üni veri toplama prompt'u:** [`CLAUDE.md`](./CLAUDE.md) — LLM ile veri
> toplarken kullanılan şema kuralları.

---

## 📑 İçindekiler

1. [Mimari özet](#-mimari-özet)
2. [Hızlı kurulum](#-hızlı-kurulum-i̇lk-defa)
3. [Mevcut kurulumda çalıştırma](#-mevcut-kurulumda-çalıştırma)
4. [Proje yapısı](#-proje-yapısı)
5. [Knowledge Graph şeması](#-knowledge-graph-şeması)
6. [Frontend — 3 katman + Chat](#-frontend--3-katman--chat)
7. [API endpoint'leri](#-api-endpointleri)
8. [Geliştirme & test](#-geliştirme--test)
9. [Sık karşılaşılan sorunlar](#-sık-karşılaşılan-sorunlar)
10. [Yeni üniversite ekleme](#-yeni-üniversite-ekleme)

---

## 🏗 Mimari özet

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   data/{bilgisayar,yazilim,ybs}/<slug>.json                              │
│   (51 üniversite, scraped + LLM-enriched JSON)                          │
│                            │                                             │
│                            │  python src/ingest.py                       │
│                            ▼                                             │
│   ┌────────────────────────────────┐    ┌──────────────────────────┐    │
│   │  Neo4j Knowledge Graph         │    │  FAISS Index             │    │
│   │  9 düğüm tipi, 10 ilişki       │    │  8721 ders embedding     │    │
│   │  (University → Course)         │    │  (paraphrase-mLaBSE)     │    │
│   └─────────────┬──────────────────┘    └────────┬─────────────────┘    │
│                 │                                │                       │
│                 └────────────────┬───────────────┘                       │
│                                  │                                       │
│                    ┌─────────────▼─────────────┐                         │
│                    │  FastAPI Backend          │                         │
│                    │  src/main.py + src/api/   │                         │
│                    │  Port 8000                │                         │
│                    │  - 11 compare endpoint    │                         │
│                    │  - /api/chat (LLM)        │                         │
│                    │  - /api/search (FAISS)    │                         │
│                    └─────────────┬─────────────┘                         │
│                                  │ JSON                                  │
│                                  ▼                                       │
│                    ┌──────────────────────────┐                          │
│                    │  Next.js 16 Frontend     │                          │
│                    │  frontend/  (Port 3000)  │                          │
│                    │  - 3 katmanlı dashboard  │                          │
│                    │  - LLM chat panel        │                          │
│                    │  - Editorial design      │                          │
│                    └──────────────────────────┘                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Stack:**
- **Backend:** Python 3.11+, FastAPI, Neo4j Python Driver, sentence-transformers, FAISS
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind 4, Recharts, Framer Motion, ReactFlow
- **DB:** Neo4j 5 (Docker)
- **LLM:** Azure OpenAI (primary) → OpenAI → OpenRouter (fallback chain)
- **Embedding model:** `paraphrase-multilingual-MiniLM-L12-v2` (384D)

---

## 🚀 Hızlı kurulum (ilk defa)

> Repo'yu yeni klonladıysan veya makinende hiç çalıştırmadıysan bu adımları
> sırayla yap. **Toplam süre: ~30 dakika** (network hızına bağlı).

### Önkoşullar

- **Node.js 20+** — https://nodejs.org/
- **Python 3.11+** — `python3 --version`
- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- **Bir LLM API anahtarı** (en az birinden):
  - Azure OpenAI (primary, önerilen)
  - OpenAI
  - OpenRouter (ücretsiz fallback model'i var)

### 1. Repo'yu klonla

```bash
git clone https://github.com/yapicialiekrem/university-curriculum-analyzer.git
cd university-curriculum-analyzer
```

✅ `data/{bilgisayar,yazilim,ybs}/*.json` (51 dosya, enrichment ile zenginleştirilmiş)
zaten içinde — ayrıca veri indirmen gerekmez.

### 2. `.env` dosyasını oluştur

```bash
cp .env.example .env
# Sonra .env'i editör ile aç ve doldur:
```

**Minimum ayarlar:**
```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=secret123        # Neo4j ilk açılışta belirlediğin şifre

# Aşağıdakilerden EN AZ BİRİ:
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2025-03-01-preview
# veya
OPENAI_API_KEY=sk-...
# veya
OPENROUTER_API_KEY=sk-or-...
```

### 3. Neo4j'i başlat

```bash
docker compose up -d neo4j
```

İlk açılışta:
- http://localhost:7474 — Neo4j browser
- Default: `neo4j` / `neo4j` ile login → yeni şifre belirle
- Bu şifreyi `.env` içindeki `NEO4J_PASSWORD`'a yaz

### 4. Python backend kurulumu

```bash
python3 -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt        # ~3-5 dakika
```

### 5. Veriyi Neo4j'e yükle (ingest)

```bash
python src/ingest.py
```

Bu adım:
- 51 JSON dosyasını okur
- Her ders için sentence-transformers ile embedding üretir
- Neo4j'e University → Faculty → Department → Course hiyerarşisini yazar
- ⏱ **Süre: 10-15 dakika** (RAM: ~2 GB, model ilk seferde ~80 MB inecek)

### 6. FAISS index'i build et (chat semantic arama için)

```bash
python -m src.embeddings.builder
```

⏱ Süre: ~5-10 dakika. `src/embeddings/index/` altına yazar (~15 MB).

### 7. Backend server'ı başlat

```bash
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

✅ http://127.0.0.1:8000/docs — Swagger UI ile endpoint'leri test edebilirsin.

### 8. Frontend kurulumu (yeni terminal)

```bash
cd frontend
npm install                            # ~2 dakika, ~700 MB
npm run dev
```

### 9. Tarayıcıda aç

🌐 **http://localhost:3000**

İlk yüklemede dashboard `metu` (ODTÜ) ve `bilkent` üniversitelerini default
karşılaştırır.

---

## ⚡ Mevcut kurulumda çalıştırma

> Daha önce kurmuştun, sadece tekrar açıyorsun.

```bash
# Terminal 1 — Neo4j (zaten çalışıyorsa atla)
docker compose up -d neo4j

# Terminal 2 — Backend
cd university-curriculum-analyzer
source .venv/bin/activate
uvicorn src.main:app --reload --port 8000

# Terminal 3 — Frontend
cd university-curriculum-analyzer/frontend
npm run dev
```

🌐 http://localhost:3000

---

## 📁 Proje yapısı

```
university-curriculum-analyzer/
│
├── README.md                    Bu dosya
├── CLAUDE.md                    Claude Code için repo notları
├── Interim_Report.md            Ara rapor (markdown)
├── docker-compose.yml           Neo4j servisini başlatır
├── requirements.txt             Python bağımlılıkları
├── .env.example                 .env şablonu (kopyala, doldur)
│
├── data/                        51 üniversitenin enriched JSON müfredatı
│   ├── bilgisayar/              31 Bilgisayar Müh. programı
│   ├── yazilim/                 10 Yazılım Müh. programı
│   └── ybs/                     10 Yönetim Bilişim Sistemleri programı
│
├── docs/                        Veri toplama rehberi (PDF)
│
├── src/                         Python BACKEND
│   ├── main.py                  FastAPI entry point + router include
│   ├── config.py                .env okur, settings export
│   ├── ingest.py                JSON → Neo4j veri yükleyici
│   ├── comparison.py            ⭐ ComparisonEngine — 11 metrik için Cypher sorguları
│   │
│   ├── api/                     HTTP endpoint'leri
│   │   ├── universities.py      /api/v2/universities — liste, detay
│   │   ├── compare_enriched.py  /api/v2/compare/* — radar, heatmap, coverage, bloom
│   │   ├── chat.py              POST /api/chat — LLM destekli soru-cevap
│   │   └── search.py            POST /api/search — FAISS semantik arama
│   │
│   ├── analytics/               JSON-bazlı analiz katmanı (Neo4j gerektirmez)
│   │   ├── loader.py            JSON cache loader
│   │   ├── radar.py             10 eksen kategori kapsamı
│   │   ├── heatmap.py           Dönem × kategori AKTS matrisi
│   │   ├── coverage.py          Ortak/farklı konu çıkarımı
│   │   └── bloom.py             Bloom taksonomisi dağılımı
│   │
│   ├── chat/                    ⭐ LLM chat pipeline
│   │   ├── router.py            Soru → Intent (LLM #1, classify)
│   │   ├── context.py           Intent → Neo4j/FAISS data (no LLM)
│   │   ├── answer.py            Context → ChatResponse (LLM #2, generate)
│   │   ├── prompts.py           ROUTER_PROMPT + ANSWER_PROMPT
│   │   ├── llm.py               OpenAI/Azure/OpenRouter wrapper
│   │   └── schemas.py           Pydantic: Intent, ChatResponse, Citation
│   │
│   ├── embeddings/              FAISS semantik arama
│   │   ├── builder.py           Embedding hesapla → FAISS index'e yaz
│   │   ├── search.py            Query → top-k benzer ders
│   │   └── index/               🚫 git ignored (build sonrası oluşur)
│   │
│   └── enrichment/              JSON zenginleştirici (LLM ile çalışır)
│       ├── enrich.py            Ham scraped → +bloom_levels, +categories
│       ├── aggregator.py        Üni özeti: modernity_score, specialization_depth
│       ├── prompts.py           Enrichment LLM prompt'ları
│       └── llm_client.py        LLM wrapper
│
└── frontend/                    Next.js FRONTEND
    ├── package.json             npm bağımlılıkları
    ├── playwright.config.ts     E2E test ayarları
    ├── tailwind.config (yok)    Tailwind 4 — config @theme directive ile globals.css'de
    │
    └── src/
        ├── app/                 Next.js App Router
        │   ├── layout.tsx       Root: fontlar, TopBar, ThemeProvider, OverlayProvider
        │   ├── page.tsx         "/" → LayerOne + LayerTwo + ChatPanel
        │   ├── deep-analysis/   "/deep-analysis" → LayerThree
        │   └── globals.css      ⭐ Tasarım sistemi: tokens, .card, dark mode
        │
        ├── components/
        │   ├── TopBar.tsx               Sticky nav + tema toggle
        │   ├── Section.tsx              Layer 2/3 kart wrapper (fade-up scroll)
        │   │
        │   ├── selectors/
        │   │   ├── UniversityPicker.tsx   ⭐ Chip + replace mode + dept auto-fix
        │   │   └── DepartmentTabs.tsx     BilMüh / YazMüh / YBS sekmeleri
        │   │
        │   ├── cards/
        │   │   └── UniversityCard.tsx    4px accent + 80px güncellik + mini bar
        │   │
        │   ├── chat/
        │   │   └── ChatPanel.tsx         Pill → modal + typewriter + overlay
        │   │
        │   ├── layers/
        │   │   ├── LayerOne.tsx          1.x — Radar + 2 üni kartı
        │   │   ├── LayerTwo.tsx          2.x — 6 detay bileşeni
        │   │   └── LayerThree.tsx        3.x — Derin analiz (akademisyen)
        │   │
        │   └── charts/                   Tüm görselleştirmeler
        │       ├── CategoryRadar.tsx              1.1 — 10 eksen kapsam
        │       ├── SemesterHeatmap.tsx            2.1 — Dönem × kategori
        │       ├── CoverageTable.tsx              2.2 — Ortak/özel konu
        │       ├── BloomDonut.tsx                 2.3 — Bloom dağılımı
        │       ├── OutcomesHeatmap.tsx            2.4 — Program çıktı NLP
        │       ├── StaffBars.tsx                  2.5 — Akademik kadro
        │       ├── ResourcesDonut.tsx             2.6 — Kaynak dili
        │       ├── CurriculumCoverageHeatmap.tsx  3.1 — Haftalık konu
        │       ├── PrereqGraph.tsx                3.2 — Önkoşul ağı (ReactFlow)
        │       ├── ResourcesTable.tsx             3.3 — Ortak kaynaklar
        │       └── CourseSimilarity.tsx           3.4 — Embedding arama
        │
        └── lib/
            ├── api.ts                Backend fetch wrapper
            ├── types.ts              TypeScript ↔ Pydantic eşleşmeleri
            ├── use-selection.ts      ⭐ URL state (a, b, c, dept)
            ├── use-overlay.tsx       Chat → dashboard glow (30s TTL)
            └── use-theme.tsx         Light/dark/system tema
```

### 🚫 Git'te olmayanlar (yeniden üretilir)

| Klasör/dosya | Boyut | Nasıl üretilir |
|---|---|---|
| `frontend/node_modules/` | ~570 MB | `npm install` |
| `frontend/.next/` | ~240 MB | `npm run dev/build` |
| `.venv/` | ~500 MB | `python -m venv .venv && pip install -r requirements.txt` |
| `src/embeddings/index/` | ~15 MB | `python -m src.embeddings.builder` |
| `Neo4j Docker volume` | ~500 MB | `python src/ingest.py` |
| `.env` | <1 KB | `cp .env.example .env` (manuel doldur) |
| `logs/` | değişken | Otomatik (runtime) |

---

## 🕸 Knowledge Graph şeması

### 9 düğüm tipi

| Düğüm | Anahtar alan(lar) | Ek alanlar |
|---|---|---|
| **University** | `name` | type, language, department_url |
| **Faculty** | `name + university` | — |
| **Department** | `name + university` | — |
| **Course** | `code + university` | name, ects, semester, language, description, embedding |
| **CourseType** | `name` ("zorunlu" / "secmeli") | — |
| **Category** | `name` ("ai_ml", "math", "web_mobile" …) | — |
| **LearningOutcome** | `text + course_code` | bloom_level, embedding |
| **ProgramOutcome** | `text + department + university` | embedding |
| **AcademicStaff** | `department + university` | title, name |

### 10 ilişki tipi

```
University ─[:HAS_FACULTY]──────→ Faculty
Faculty    ─[:HAS_DEPARTMENT]───→ Department
Department ─[:HAS_STAFF]────────→ AcademicStaff
Department ─[:HAS_PROGRAM_OUTCOME]→ ProgramOutcome
Department ─[:OFFERS]───────────→ Course
Course     ─[:HAS_TYPE]─────────→ CourseType
Course     ─[:HAS_OUTCOME]──────→ LearningOutcome
Course     ─[:BELONGS_TO]───────→ Category
Course     ─[:REQUIRES]─────────→ Course      (önkoşul, transitif)
```

Cypher örnekleri için: [`src/comparison.py`](src/comparison.py)

---

## 🎨 Frontend — 3 katman + Chat

### Katman 1 — İlk bakışta (`/`)
- **CategoryRadar** — 10 eksende kategori bazlı kapsam (Recharts polish)
- **UniversityCard** ×2 — 4px accent + 80px güncellik skoru + uzmanlaşma mini bar

### Katman 2 — Daha yakından (scroll, `/`)
- **2.1 SemesterHeatmap** — 8 dönem × 10 kategori AKTS ısı haritası
- **2.2 CoverageTable** — Kategori bazlı ortak/farklı konu özeti
- **2.3 BloomDonut** — Bloom taksonomisi dağılımı (her üni ayrı donut)
- **2.4 OutcomesHeatmap** — Program çıktıları semantik benzerliği
- **2.5 StaffBars** — Akademik kadro nokta-cluster'ı
- **2.6 ResourcesDonut** — İngilizce kaynak oranı

### Katman 3 — Derin analiz (`/deep-analysis`)
- **3.1 CurriculumCoverageHeatmap** — Haftalık konu eşlemesi
- **3.2 PrereqGraph** — ReactFlow ile önkoşul ağı
- **3.3 ResourcesTable** — Ortak ders kaynakları
- **3.4 CourseSimilarity** — Embedding tabanlı arama UI

### Chat Panel
- Sağ alt **pill** (kapalı) → tıklayınca **420×600 modal** (desktop) / **bottom sheet** (mobile)
- `/` kısayolu ile odakla
- **Typewriter streaming**, citations chip'leri, follow-up önerileri
- LLM `dashboard_update` dönerse ilgili dashboard bileşeni 30 saniye **glow** olur

### Tasarım sistemi
- **Renk paleti:** ink + paper (NYT/Pudding tarzı sıcak palet) + 3 üniversite rengi
- **Tipografi:** Fraunces (serif başlık) + Inter Tight (UI) + JetBrains Mono (sayı/kod)
- **Editorial scale:** text-3xl=40px, text-4xl=56px, text-5xl=80px
- **Light/dark mode** + sistem tercihi otomatik

URL state ile paylaşılabilir: `/?a=metu&b=bilkent&c=bogazici&dept=bilmuh`

---

## 🔌 API endpoint'leri

### Karşılaştırma metrikleri (Neo4j → JSON)

| Endpoint | Açıklama |
|---|---|
| `GET /api/v2/universities?department=bilmuh` | Bölüm bazlı üniversite listesi |
| `GET /api/v2/universities/{slug}` | Üniversite özeti (modernity_score, specialization_depth) |
| `GET /api/v2/compare/radar?a=metu&b=bilkent&c=...` | 10 eksen kategori kapsamı |
| `GET /api/v2/compare/heatmap?a=&b=` | Dönem × kategori AKTS matrisi |
| `GET /api/v2/compare/coverage?a=&b=` | Ortak/farklı konu çıkarımı |
| `GET /api/v2/compare/bloom?a=&b=` | Bloom taksonomisi dağılımı |
| `GET /api/compare/staff?u1=&u2=` | Akademik kadro karşılaştırma |
| `GET /api/compare/program-outcomes?u1=&u2=` | Program çıktısı NLP eşleşmesi |
| `GET /api/compare/curriculum-coverage?u1=&u2=` | Haftalık konu eşlemesi |
| `GET /api/compare/prerequisites?u1=&u2=` | Önkoşul ağı |
| `GET /api/compare/resources?u1=&u2=` | Ortak kaynaklar |

### Sohbet & arama

| Endpoint | Method | Açıklama |
|---|---|---|
| `/api/chat` | POST | LLM destekli soru-cevap (intent → context → answer) |
| `/api/search` | POST | FAISS embedding tabanlı semantik ders arama |

### Chat akışı

```
Soru → router.py (LLM #1, classify intent)
              ↓
         context.py (Neo4j veya FAISS, no LLM)
              ↓
         answer.py (LLM #2, ChatResponse)
              ↓
         Frontend (text + citations + dashboard_update)
```

#### Intent tipleri

| Tip | Açıklama | Örnek |
|---|---|---|
| `deterministic` | Sayısal / filtrelenebilir | "ODTÜ'de kaç zorunlu ders var?" |
| `comparison` | İki+ üniversite kıyası | "Bilkent ve ODTÜ'nün matematik yükünü karşılaştır" |
| `semantic` | Konu bazlı arama | "Görüntü işleme dersleri" |
| `detail` | Spesifik ders/üni | "CENG 483 nedir?" |
| `general` | Sistem hakkında | "Bu veriler nasıl toplandı?" |

Her LLM çağrısı `logs/llm.jsonl`'e kaydedilir (tokens, latency, cost).

#### Curl örneği

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"Yapay zeka derslerinde hangi üniversite daha yoğun?"}'
```

Tam Swagger dokümantasyonu: http://localhost:8000/docs

---

## 🛠 Geliştirme & test

### Frontend dev

```bash
cd frontend
npm run dev        # http://localhost:3000
npm run lint       # ESLint
npm run build      # Production build (.next/)
```

### E2E testler (Playwright)

```bash
cd frontend
npm run test:e2e         # CI mode
npm run test:e2e:ui      # Browser UI'ı ile
```

Test'ler `frontend/tests/e2e/`'de.

### Backend dev

```bash
source .venv/bin/activate

# Hot reload
uvicorn src.main:app --reload --port 8000

# Logs
tail -f logs/llm.jsonl
```

### Neo4j Cypher

```bash
docker exec -it unicurriculum-neo4j cypher-shell -u neo4j -p <şifre>

> MATCH (u:University) RETURN count(u) AS unis;
> MATCH (c:Course) RETURN count(c) AS courses;
> MATCH ()-[r:REQUIRES]->() RETURN count(r) AS prereqs;
```

Beklenen değerler:
- `unis` ≥ 51
- `courses` ≥ 8000
- `prereqs` > 0 (önkoşul tanımı olan dersler için)

### Branch / PR akışı

```bash
git checkout main
git pull
git checkout -b feat/yeni-ozellik
# ... kodla ...
git add -A
git commit -m "feat(scope): açıklama"
git push -u origin feat/yeni-ozellik
gh pr create        # veya GitHub web'den manuel
```

---

## ⚠️ Sık karşılaşılan sorunlar

### Site açılıyor ama tüm kartlar boş / "yüklenemedi"
**Neden:** Backend (port 8000) ayakta değil veya Neo4j boş.

**Çözüm:**
```bash
# Backend ayakta mı?
curl -s http://127.0.0.1:8000/docs > /dev/null && echo "✓" || echo "✗ Başlat"

# Neo4j dolu mu?
docker exec unicurriculum-neo4j cypher-shell -u neo4j -p <şifre> \
  "MATCH (u:University) RETURN count(u);"
# 51'den az ise: python src/ingest.py
```

### `Connection refused` Neo4j'e
**Çözüm:**
```bash
docker compose up -d neo4j
docker compose logs neo4j | tail -20
```

### Dropdown'da çoğu üniversite yok
**Neden:** Neo4j'e tüm 51 üniversite yüklenmemiş (ingest yarıda kalmış).

**Çözüm:**
```bash
# Neo4j'i temizle
docker exec -it unicurriculum-neo4j cypher-shell -u neo4j -p <şifre> \
  "MATCH (n) DETACH DELETE n;"
# Yeniden ingest
python src/ingest.py
```

### Chat hata veriyor / generic cevap
**Neden:** `.env`'de geçerli LLM key yok, veya quota dolmuş.

**Çözüm:**
- `.env`'deki `AZURE_OPENAI_*` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY`'den
  en az birini geçerli yap
- `tail -f logs/llm.jsonl` ile hatayı görüntüle

### `prereq` graph'ta hep "0 ders, 0 bağ"
**Neden:** Neo4j'de REQUIRES ilişkisi yok (ingest tam çalışmamış olabilir).

**Çözüm:**
```bash
# Cypher kontrolü
MATCH ()-[r:REQUIRES]->() RETURN count(r);
# 0 ise: ingest'i tekrar çalıştır
```

### Port 3000 / 8000 dolu
```bash
# Frontend için farklı port
npm run dev -- -p 3001

# Backend için farklı port
uvicorn src.main:app --port 8001
# Frontend'in api.ts'inde NEXT_PUBLIC_API_BASE'i güncelle
```

### `npm install` veya `pip install` çok yavaş
- npm: `npm install --prefer-offline --no-audit`
- pip: `pip install -r requirements.txt --prefer-binary`

---

## ➕ Yeni üniversite ekleme

1. **JSON oluştur:** `CLAUDE.md`'deki şemaya uygun
   `data/<bolum>/<slug>.json` (örn. `data/bilgisayar/yeniuni.json`)

2. **Enrichment (opsiyonel ama önerilir):**
   ```bash
   python -m src.enrichment.enrich data/bilgisayar/yeniuni.json
   ```
   LLM ile bloom_levels, categories, weekly_topics ekler.

3. **Neo4j'e yükle:**
   ```bash
   python src/ingest.py
   ```

4. **FAISS index'i yenile:**
   ```bash
   python -m src.embeddings.builder
   ```

5. **Frontend cache temizle:** Tarayıcıda hard refresh (Cmd+Shift+R) — SWR
   60s dedupe yapıyor, ya bekle ya yenile.

---

## 📜 Lisans & Atıf

Bitirme projesi olarak geliştirilmiştir.

- **Veri kaynağı:** Üniversitelerin resmi müfredat web sayfaları
- **Embedding modeli:** [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
- **LLM:** Azure OpenAI / OpenAI / OpenRouter

---

## 🔗 Dış bağlantılar

- **GitHub:** https://github.com/yapicialiekrem/university-curriculum-analyzer
- **Neo4j docs:** https://neo4j.com/docs/
- **FastAPI docs:** https://fastapi.tiangolo.com/
- **Next.js docs:** https://nextjs.org/docs

---

> Proje hakkında: bkz. `Interim_Report.md` — ara raporda tasarım kararları,
> veri toplama metodolojisi, mimari değerlendirme ve geleceğe yönelik
> planlar yer alır.
