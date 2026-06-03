# UniCurriculum — University Curriculum Analyzer

> An editorial dashboard for reading the **Computer Engineering**, **Software
> Engineering** and **Management Information Systems** curricula of Turkish
> universities side by side. Includes LLM-powered chat, semantic topic search,
> Bloom-taxonomy analysis and prerequisite-graph visualization.

**51 universities × 3 departments × 8721 courses.** Pipeline: JSON → LLM enrichment →
FAISS semantic index + Neo4j KG → FastAPI backend → Next.js 16 dashboard +
hybrid AI assistant (8 intents, 5 tools).

> **Detailed document for the presentation / jury:** [`SUNUM.md`](./SUNUM.md) — an
> end-to-end walkthrough of the pipeline, file structure, the AI assistant's
> internals, the demo flow, and dead-code detection.
>
> **New-university data-collection prompt:** [`CLAUDE.md`](./CLAUDE.md) — the schema
> rules used when collecting data with an LLM.

---

## Contents

1. [Architecture overview](#architecture-overview)
2. [Quick setup](#quick-setup-first-time)
3. [Running an existing setup](#running-an-existing-setup)
4. [Project structure](#project-structure)
5. [Knowledge Graph schema](#knowledge-graph-schema)
6. [Frontend — 3 layers + Chat](#frontend--3-layers--chat)
7. [API endpoints](#api-endpoints)
8. [Development & testing](#development--testing)
9. [Adding a new university](#adding-a-new-university)

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   data/{bilgisayar,yazilim,ybs}/<slug>.json                              │
│   (51 universities, scraped + LLM-enriched JSON)                         │
│                            │                                             │
│                            │  python src/ingest.py                       │
│                            ▼                                             │
│   ┌────────────────────────────────┐    ┌──────────────────────────┐     │
│   │  Neo4j Knowledge Graph         │    │  FAISS Index             │     │
│   │  9 node types, 10 relations    │    │  8721 course embeddings  │     │
│   │  (University → Course)         │    │  (paraphrase-mLaBSE)     │     │
│   └─────────────┬──────────────────┘    └────────┬─────────────────┘     │
│                 │                                │                       │
│                 └────────────────┬───────────────┘                       │
│                                  │                                       │
│                    ┌─────────────▼─────────────┐                         │
│                    │  FastAPI Backend          │                         │
│                    │  src/main.py + src/api/   │                         │
│                    │  Port 8000                │                         │
│                    │  - 11 compare endpoints   │                         │
│                    │  - /api/chat (LLM)        │                         │
│                    │  - /api/search (FAISS)    │                         │
│                    └─────────────┬─────────────┘                         │
│                                  │ JSON                                  │
│                                  ▼                                       │
│                    ┌──────────────────────────┐                          │
│                    │  Next.js 16 Frontend     │                          │
│                    │  frontend/  (Port 3000)  │                          │
│                    │  - 3-layer dashboard     │                          │
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

## Quick setup (first time)

> If you've just cloned the repo or never run it on your machine, follow these
> steps in order. **Total time: ~30 minutes** (depending on network speed).

### Prerequisites

- **Node.js 20+** — https://nodejs.org/
- **Python 3.11+** — `python3 --version`
- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- **An LLM API key** (at least one of):
  - Azure OpenAI (primary, recommended)
  - OpenAI
  - OpenRouter (has a free fallback model)

### 1. Clone the repo

```bash
git clone https://github.com/yapicialiekrem/university-curriculum-analyzer.git
cd university-curriculum-analyzer
```

`data/{bilgisayar,yazilim,ybs}/*.json` (51 files, already enriched) is included —
no extra data download needed.

### 2. Create the `.env` file

```bash
cp .env.example .env
# Then open .env in an editor and fill it in:
```

**Minimum settings:**
```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=secret123        # the password you set on Neo4j's first launch

# AT LEAST ONE of the following:
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2025-03-01-preview
# or
OPENAI_API_KEY=sk-...
# or
OPENROUTER_API_KEY=sk-or-...
```

### 3. Start Neo4j

```bash
docker compose up -d neo4j
```

On first launch:
- http://localhost:7474 — Neo4j browser
- Default: log in with `neo4j` / `neo4j` → set a new password
- Write this password into `NEO4J_PASSWORD` in `.env`

### 4. Python backend setup

```bash
python3 -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt        # ~3-5 minutes
```

### 5. Load data into Neo4j (ingest)

```bash
python src/ingest.py
```

This step:
- Reads the 51 JSON files
- Generates an embedding for each course with sentence-transformers
- Writes the University → Faculty → Department → Course hierarchy into Neo4j
- **Time: 10-15 minutes** (RAM: ~2 GB, the model downloads ~80 MB on first run)

### 6. Build the FAISS index (for chat semantic search)

```bash
python -m src.embeddings.builder
```

Time: ~5-10 minutes. Writes under `src/embeddings/index/` (~15 MB).

### 7. Start the backend server

```bash
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

http://127.0.0.1:8000/docs — test the endpoints with Swagger UI.

### 8. Frontend setup (new terminal)

```bash
cd frontend
npm install                            # ~2 minutes, ~700 MB
npm run dev
```

### 9. Open in the browser

**http://localhost:3000**

On first load the dashboard compares `metu` (METU) and `bilkent` by default.

---

## Running an existing setup

> You've set it up before; you're just reopening it.

```bash
# Terminal 1 — Neo4j (skip if already running)
docker compose up -d neo4j

# Terminal 2 — Backend
cd university-curriculum-analyzer
source .venv/bin/activate
uvicorn src.main:app --reload --port 8000

# Terminal 3 — Frontend
cd university-curriculum-analyzer/frontend
npm run dev
```

http://localhost:3000

---

## Project structure

```
university-curriculum-analyzer/
│
├── README.md                    This file
├── CLAUDE.md                    Repo notes for Claude Code
├── Interim_Report.md            Interim report (markdown)
├── docker-compose.yml           Starts the Neo4j service
├── requirements.txt             Python dependencies
├── .env.example                 .env template (copy, fill in)
│
├── data/                        Enriched JSON curricula of 51 universities
│   ├── bilgisayar/              31 Computer Engineering programs
│   ├── yazilim/                 10 Software Engineering programs
│   └── ybs/                     10 Management Information Systems programs
│
├── docs/                        Data-collection guide (PDF)
│
├── src/                         Python BACKEND
│   ├── main.py                  FastAPI entry point + router include
│   ├── config.py                Reads .env, exports settings
│   ├── ingest.py                JSON → Neo4j data loader
│   ├── comparison.py            ComparisonEngine — Cypher queries for 11 metrics
│   │
│   ├── api/                     HTTP endpoints
│   │   ├── universities.py      /api/v2/universities — list, detail
│   │   ├── compare_enriched.py  /api/v2/compare/* — radar, heatmap, coverage, bloom
│   │   ├── chat.py              POST /api/chat — LLM-powered Q&A
│   │   └── search.py            POST /api/search — FAISS semantic search
│   │
│   ├── analytics/               JSON-based analytics layer (no Neo4j required)
│   │   ├── loader.py            JSON cache loader
│   │   ├── radar.py             10-axis category coverage
│   │   ├── heatmap.py           Semester × category ECTS matrix
│   │   ├── coverage.py          Shared/different topic extraction
│   │   └── bloom.py             Bloom taxonomy distribution
│   │
│   ├── chat/                    LLM chat pipeline
│   │   ├── router.py            Question → Intent (LLM #1, classify)
│   │   ├── context.py           Intent → Neo4j/FAISS data (no LLM)
│   │   ├── answer.py            Context → ChatResponse (LLM #2, generate)
│   │   ├── prompts.py           ROUTER_PROMPT + ANSWER_PROMPT
│   │   ├── llm.py               OpenAI/Azure/OpenRouter wrapper
│   │   └── schemas.py           Pydantic: Intent, ChatResponse, Citation
│   │
│   ├── embeddings/              FAISS semantic search
│   │   ├── builder.py           Compute embeddings → write to FAISS index
│   │   ├── search.py            Query → top-k similar courses
│   │   └── index/               git ignored (created after build)
│   │
│   └── enrichment/              JSON enricher (LLM-powered)
│       ├── enrich.py            Raw scraped → +bloom_levels, +categories
│       ├── aggregator.py        University summary: modernity_score, specialization_depth
│       ├── prompts.py           Enrichment LLM prompts
│       └── llm_client.py        LLM wrapper
│
└── frontend/                    Next.js FRONTEND
    ├── package.json             npm dependencies
    ├── playwright.config.ts     E2E test config
    ├── tailwind.config (none)   Tailwind 4 — config via @theme directive in globals.css
    │
    └── src/
        ├── app/                 Next.js App Router
        │   ├── layout.tsx       Root: fonts, TopBar, ThemeProvider, OverlayProvider
        │   ├── page.tsx         "/" → LayerOne + LayerTwo + ChatPanel
        │   ├── deep-analysis/   "/deep-analysis" → LayerThree
        │   └── globals.css      Design system: tokens, .card, dark mode
        │
        ├── components/
        │   ├── TopBar.tsx               Sticky nav + theme toggle
        │   ├── Section.tsx              Layer 2/3 card wrapper (fade-up scroll)
        │   │
        │   ├── selectors/
        │   │   ├── UniversityPicker.tsx   Chip + replace mode + dept auto-fix
        │   │   └── DepartmentTabs.tsx     CompEng / SoftEng / MIS tabs
        │   │
        │   ├── cards/
        │   │   └── UniversityCard.tsx    4px accent + 80px recency + mini bar
        │   │
        │   ├── chat/
        │   │   └── ChatPanel.tsx         Pill → modal + typewriter + overlay
        │   │
        │   ├── layers/
        │   │   ├── LayerOne.tsx          1.x — Radar + 2 university cards
        │   │   ├── LayerTwo.tsx          2.x — 6 detail components
        │   │   └── LayerThree.tsx        3.x — Deep analysis (academic)
        │   │
        │   └── charts/                   All visualizations
        │       ├── CategoryRadar.tsx              1.1 — 10-axis coverage
        │       ├── SemesterHeatmap.tsx            2.1 — Semester × category
        │       ├── CoverageTable.tsx              2.2 — Shared/unique topics
        │       ├── BloomDonut.tsx                 2.3 — Bloom distribution
        │       ├── OutcomesHeatmap.tsx            2.4 — Program outcome NLP
        │       ├── StaffBars.tsx                  2.5 — Academic staff
        │       ├── ResourcesDonut.tsx             2.6 — Resource language
        │       ├── CurriculumCoverageHeatmap.tsx  3.1 — Weekly topics
        │       ├── PrereqGraph.tsx                3.2 — Prerequisite graph (ReactFlow)
        │       ├── ResourcesTable.tsx             3.3 — Shared resources
        │       └── CourseSimilarity.tsx           3.4 — Embedding search
        │
        └── lib/
            ├── api.ts                Backend fetch wrapper
            ├── types.ts              TypeScript ↔ Pydantic mappings
            ├── use-selection.ts      URL state (a, b, c, dept)
            ├── use-overlay.tsx       Chat → dashboard glow (30s TTL)
            └── use-theme.tsx         Light/dark/system theme
```

### Not in git (regenerated)

| Folder/file | Size | How to regenerate |
|---|---|---|
| `frontend/node_modules/` | ~570 MB | `npm install` |
| `frontend/.next/` | ~240 MB | `npm run dev/build` |
| `.venv/` | ~500 MB | `python -m venv .venv && pip install -r requirements.txt` |
| `src/embeddings/index/` | ~15 MB | `python -m src.embeddings.builder` |
| `Neo4j Docker volume` | ~500 MB | `python src/ingest.py` |
| `.env` | <1 KB | `cp .env.example .env` (fill in manually) |
| `logs/` | variable | Automatic (runtime) |

---

## Knowledge Graph schema

### 9 node types

| Node | Key field(s) | Extra fields |
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

### 10 relation types

```
University ─[:HAS_FACULTY]──────→ Faculty
Faculty    ─[:HAS_DEPARTMENT]───→ Department
Department ─[:HAS_STAFF]────────→ AcademicStaff
Department ─[:HAS_PROGRAM_OUTCOME]→ ProgramOutcome
Department ─[:OFFERS]───────────→ Course
Course     ─[:HAS_TYPE]─────────→ CourseType
Course     ─[:HAS_OUTCOME]──────→ LearningOutcome
Course     ─[:BELONGS_TO]───────→ Category
Course     ─[:REQUIRES]─────────→ Course      (prerequisite, transitive)
```

For Cypher examples: [`src/comparison.py`](src/comparison.py)

---

## Frontend — 3 layers + Chat

### Layer 1 — At a glance (`/`)
- **CategoryRadar** — category coverage across 10 axes (Recharts polish)
- **UniversityCard** ×2 — 4px accent + 80px recency score + specialization mini bar

### Layer 2 — A closer look (scroll, `/`)
- **2.1 SemesterHeatmap** — 8 semesters × 10 categories ECTS heatmap
- **2.2 CoverageTable** — category-level shared/different topic summary
- **2.3 BloomDonut** — Bloom taxonomy distribution (a separate donut per university)
- **2.4 OutcomesHeatmap** — semantic similarity of program outcomes
- **2.5 StaffBars** — academic staff dot-cluster
- **2.6 ResourcesDonut** — share of English resources

### Layer 3 — Deep analysis (`/deep-analysis`)
- **3.1 CurriculumCoverageHeatmap** — weekly topic mapping
- **3.2 PrereqGraph** — prerequisite graph with ReactFlow
- **3.3 ResourcesTable** — shared course resources
- **3.4 CourseSimilarity** — embedding-based search UI

### Chat Panel
- Bottom-right **pill** (closed) → on click, a **420×600 modal** (desktop) / **bottom sheet** (mobile)
- Focus with the `/` shortcut
- **Typewriter streaming**, citation chips, follow-up suggestions
- If the LLM returns `dashboard_update`, the relevant dashboard component **glows** for 30 seconds

### Design system
- **Color palette:** ink + paper (warm NYT/Pudding-style palette) + 3 university colors
- **Typography:** Fraunces (serif headings) + Inter Tight (UI) + JetBrains Mono (numbers/code)
- **Editorial scale:** text-3xl=40px, text-4xl=56px, text-5xl=80px
- **Light/dark mode** + automatic system preference

Shareable via URL state: `/?a=metu&b=bilkent&c=bogazici&dept=bilmuh`

---

## API endpoints

### Comparison metrics (Neo4j → JSON)

| Endpoint | Description |
|---|---|
| `GET /api/v2/universities?department=bilmuh` | Department-level university list |
| `GET /api/v2/universities/{slug}` | University summary (modernity_score, specialization_depth) |
| `GET /api/v2/compare/radar?a=metu&b=bilkent&c=...` | 10-axis category coverage |
| `GET /api/v2/compare/heatmap?a=&b=` | Semester × category ECTS matrix |
| `GET /api/v2/compare/coverage?a=&b=` | Shared/different topic extraction |
| `GET /api/v2/compare/bloom?a=&b=` | Bloom taxonomy distribution |
| `GET /api/compare/staff?u1=&u2=` | Academic staff comparison |
| `GET /api/compare/program-outcomes?u1=&u2=` | Program outcome NLP matching |
| `GET /api/compare/curriculum-coverage?u1=&u2=` | Weekly topic mapping |
| `GET /api/compare/prerequisites?u1=&u2=` | Prerequisite graph |
| `GET /api/compare/resources?u1=&u2=` | Shared resources |

### Chat & search

| Endpoint | Method | Description |
|---|---|---|
| `/api/chat` | POST | LLM-powered Q&A (intent → context → answer) |
| `/api/search` | POST | FAISS embedding-based semantic course search |

### Chat flow

```
Question → router.py (LLM #1, classify intent)
              ↓
         context.py (Neo4j or FAISS, no LLM)
              ↓
         answer.py (LLM #2, ChatResponse)
              ↓
         Frontend (text + citations + dashboard_update)
```

#### Intent types

| Type | Description | Example |
|---|---|---|
| `deterministic` | Numeric / filterable | "How many required courses does METU have?" |
| `comparison` | Comparison of 2+ universities | "Compare the math load of Bilkent and METU" |
| `semantic` | Topic-based search | "Image processing courses" |
| `detail` | Specific course/university | "What is CENG 483?" |
| `general` | About the system | "How was this data collected?" |

Every LLM call is logged to `logs/llm.jsonl` (tokens, latency, cost).

#### Curl example

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"Which university is more intensive in AI courses?"}'
```

Full Swagger documentation: http://localhost:8000/docs

---

## Development & testing

### Frontend dev

```bash
cd frontend
npm run dev        # http://localhost:3000
npm run lint       # ESLint
npm run build      # Production build (.next/)
```

### E2E tests (Playwright)

```bash
cd frontend
npm run test:e2e         # CI mode
npm run test:e2e:ui      # With browser UI
```

Tests are in `frontend/tests/e2e/`.

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
docker exec -it unicurriculum-neo4j cypher-shell -u neo4j -p <password>

> MATCH (u:University) RETURN count(u) AS unis;
> MATCH (c:Course) RETURN count(c) AS courses;
> MATCH ()-[r:REQUIRES]->() RETURN count(r) AS prereqs;
```

Expected values:
- `unis` ≥ 51
- `courses` ≥ 8000
- `prereqs` > 0 (for courses with a prerequisite defined)

### Branch / PR flow

```bash
git checkout main
git pull
git checkout -b feat/new-feature
# ... code ...
git add -A
git commit -m "feat(scope): description"
git push -u origin feat/new-feature
gh pr create        # or manually from the GitHub web UI
```

---

## Adding a new university

1. **Create JSON:** following the schema in `CLAUDE.md`,
   `data/<dept>/<slug>.json` (e.g. `data/bilgisayar/yeniuni.json`)

2. **Enrichment (optional but recommended):**
   ```bash
   python -m src.enrichment.enrich data/bilgisayar/yeniuni.json
   ```
   Adds bloom_levels, categories, weekly_topics via LLM.

3. **Load into Neo4j:**
   ```bash
   python src/ingest.py
   ```

4. **Rebuild the FAISS index:**
   ```bash
   python -m src.embeddings.builder
   ```

5. **Clear the frontend cache:** Hard refresh in the browser (Cmd+Shift+R) — SWR
   dedupes for 60s, so either wait or refresh.

---

## License & Citation

Developed as a graduation (capstone) project.

- **Data source:** universities' official curriculum web pages
- **Embedding model:** [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
- **LLM:** Azure OpenAI / OpenAI / OpenRouter

---

## External links

- **GitHub:** https://github.com/yapicialiekrem/university-curriculum-analyzer
- **Neo4j docs:** https://neo4j.com/docs/
- **FastAPI docs:** https://fastapi.tiangolo.com/
- **Next.js docs:** https://nextjs.org/docs
