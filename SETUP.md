# UniCurriculum — Kurulum Rehberi

> Bu rehber projeyi **zip'ten** veya **GitHub main branch'ten** sıfırdan
> ayağa kaldırmak için. ~10-15 dakika sürer.

---

## A) Önkoşullar (her iki yöntem için ortak)

### Yazılım

| Araç | Sürüm | Kurulum |
|---|---|---|
| **Python** | 3.11+ | https://www.python.org/downloads/ |
| **Node.js** | 20+ | https://nodejs.org/ veya `nvm install 20` |
| **Docker Desktop** | son sürüm | https://www.docker.com/products/docker-desktop |
| **Git** | herhangi | `brew install git` (macOS), built-in (Linux) |

Doğrula:
```bash
python3 --version    # Python 3.11.x
node --version       # v20.x veya üstü
docker --version     # Docker version 24.x
```

### LLM API anahtarı (en az bir tanesi gerekli)

Chat ve enrichment için. Tier zinciri: Azure OpenAI → OpenAI → OpenRouter (free).

**Tavsiye edilen — Azure OpenAI** (ücretli, en stabil):
- https://portal.azure.com → "Azure OpenAI" servisi oluştur
- Bir deployment yarat (örn. `unicurriculum`, model: `gpt-4o-mini`)
- Endpoint URL + API Key + Deployment adı not al

**Alternatif — OpenAI** (ücretli):
- https://platform.openai.com/api-keys → API key yarat

**Ücretsiz fallback — OpenRouter**:
- https://openrouter.ai/keys → API key (Qwen 80B free tier)

Sadece bu sonuncu yeter ama yavaş ve daha az tutarlı.

---

## B) Yöntem 1: Zip'ten kurulum

```bash
# 1. Zip'i aç
unzip uca-portable.zip
cd uca/

# 2. Python sanal ortam (.venv yok zip'te, kuracağız)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# ~3 dakika; sentence-transformers ilk yüklemede model indirir (~500 MB)

# 3. Frontend bağımlılıkları (node_modules yok zip'te, kuracağız)
cd frontend
npm install
# ~2 dakika
cd ..

# 4. .env dosyası oluştur (LLM credentials için)
cp .env.example .env
# .env dosyasını editör ile aç, AZURE_OPENAI_* veya OPENAI_API_KEY doldur
nano .env

# 5. Neo4j başlat (Docker ile)
docker compose up -d neo4j
# Neo4j boot süresi: ~10 saniye
sleep 10

# 6. Neo4j'ye veriyi yükle (~2 dakika, 51 üni × 8.7K ders)
cd src
python ingest.py
cd ..

# 7. Backend başlat (Terminal 1)
cd src
uvicorn main:app --reload --host 127.0.0.1 --port 8000
# "Application startup complete." mesajını bekle (~10 saniye)

# 8. Frontend başlat (Terminal 2 — yeni terminal aç)
cd /path/to/uca/frontend
npm run dev
# "Ready" mesajını bekle (~5 saniye)

# 9. Browser'da aç:
# http://localhost:3000
```

---

## C) Yöntem 2: GitHub main branch'ten kurulum

```bash
# 1. Repo klonla
git clone https://github.com/yapicialiekrem/university-curriculum-analyzer.git
cd university-curriculum-analyzer

# 2-9. Yöntem 1'in 2-9 adımları aynı
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm install && cd ..
cp .env.example .env
nano .env  # credentials doldur
docker compose up -d neo4j
sleep 10
cd src && python ingest.py && cd ..

# Backend (Terminal 1)
cd src
uvicorn main:app --reload --port 8000

# Frontend (Terminal 2)
cd ../frontend
npm run dev
```

---

## D) FAISS index hakkında

**Zip içinde** `src/embeddings/index/` dahil — yeniden derleme **GEREK YOK**.

GitHub'tan klonladıysan veya zip'te yoksa:
```bash
cd src
python -m embeddings.builder
# 30+ dakika, sentence-transformers ile 8.7K ders embed eder
```

---

## E) Kontrol — Her şey çalışıyor mu?

```bash
# Backend
curl http://127.0.0.1:8000/api/universities | head -c 200
# JSON listesi gelmeli (51 üni)

# Frontend
curl -I http://localhost:3000
# HTTP/1.1 200 OK gelmeli

# Chat
curl -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"hangi üniversitede en çok profesör var?"}'
# Doğal Türkçe cevap gelmeli (İTÜ 24, ODTÜ 14, ...)
```

Browser:
- `http://localhost:3000` → ana dashboard
- `http://localhost:3000/deep-analysis` → derin analiz sayfası
- Sağ alt **Asistan** pill → chat aç

---

## F) Sık karşılaşılan sorunlar

| Sorun | Çözüm |
|---|---|
| `pip install faiss-cpu` hata veriyor | Python 3.13 kullanma; 3.11/3.12 kullan. macOS Apple Silicon: `pip install faiss-cpu==1.8.0` |
| `npm install` hata veriyor | Node sürümünü kontrol: `node --version` 20+ olmalı |
| Neo4j bağlanmıyor | Docker servisi çalışıyor mu: `docker ps`; password .env ile docker-compose.yml uyumlu mu |
| `/api/chat` 500 dönüyor | `.env`'de en az bir LLM API key dolu mu |
| Frontend "API error" | Backend port 8000'de çalışıyor mu; `NEXT_PUBLIC_API_BASE` env override edilmemiş mi |
| FAISS index yok hatası | `cd src && python -m embeddings.builder` çalıştır (30 dk) |
| Önkoşul/kaynak section'ları boş | Neo4j ingest çalışmamış: `cd src && python ingest.py` |

---

## G) Geliştirme akışı

```bash
# Yeni özellik için branch
git checkout -b feature/my-fix

# Backend dosyaları edit et — uvicorn --reload otomatik picked up
# Frontend dosyaları edit et — Next dev hot-reload otomatik

# Tip kontrolü (frontend)
cd frontend && npx tsc --noEmit

# Commit + push
git add -A
git commit -m "feat: ..."
git push -u origin feature/my-fix
# GitHub'da PR aç → main'e merge
```

---

## H) Detaylı dokümantasyon

Bu rehber sadece kurulum içindir. Daha fazlası için:

| Doküman | İçerik |
|---|---|
| `README.md` | Mimari, API, geliştirme |
| `SUNUM.md` | Juri sunum dokümanı — pipeline, AI asistan iç işleyişi, demo akışı |
| `Interim_Report.md` | Akademik ara rapor (literatür, metodoloji) |
| `CLAUDE.md` | Yeni üni veri toplarken kullanılan LLM prompt'u |
| `docs/UniCurriculum_Veri_Toplama_Rehberi.pdf` | Veri toplama detayı |
