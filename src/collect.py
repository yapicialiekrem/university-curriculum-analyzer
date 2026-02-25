"""
Üniversite müfredat verisi toplama aracı.

Scrapling ile üniversite sayfalarını tarar, ardından Claude API ile
CLAUDE.md kurallarına uygun JSON formatına dönüştürür.

Kullanım:
    python -m src.collect --university "Hacettepe Üniversitesi" \\
                          --url "https://cs.hacettepe.edu.tr/bolum/ders-plani" \\
                          --output data/hacettepe.json

Seçenekler:
    --dynamic     JS render gerektiren siteler (Playwright/Chrome gerektirir)
    --max-pages   Maksimum ders sayfası sayısı (varsayılan: 150)
"""

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Prompt ──────────────────────────────────────────────────────────────────

def build_extraction_prompt(
    university_name: str,
    department_url: str,
    pages: dict[str, str],
) -> str:
    """Claude API için prompt oluştur."""

    # Sayfa içeriklerini birleştir (ana sayfa önce gelsin)
    sections: list[str] = []
    if department_url in pages:
        sections.append(f"=== ANA SAYFA: {department_url} ===\n{pages[department_url]}")

    for url, content in pages.items():
        if url == department_url:
            continue
        sections.append(f"=== SAYFA: {url} ===\n{content}")

    all_content = "\n\n".join(sections)

    # Çok büyükse kırp (~170k karakter ≈ ~45k token, 200k context'e sığar)
    max_chars = 170_000
    if len(all_content) > max_chars:
        logger.warning(
            f"İçerik çok büyük ({len(all_content):,} karakter), "
            f"{max_chars:,} karaktere kırpılıyor"
        )
        all_content = all_content[:max_chars] + "\n... [içerik kırpıldı]"

    return f"""Sen bir veri toplama asistanısın. Aşağıdaki üniversitenin Bilgisayar Mühendisliği (veya Bilgisayar ve Bilişim Bilimleri) bölümünün müfredat verilerini, aşağıdaki JSON formatına BİREBİR uygun şekilde çıkar.

## Hedef Üniversite
- Üniversite: {university_name}
- Bölüm URL: {department_url}

## Kurallar

### Tip Kuralları
1. `ects` her zaman number (6, tırnak yok — "6" YAZMA)
2. `semester` 1-8 arası number veya null ("Semester 1" gibi string YAZMA)
3. `year` = ⌈semester / 2⌉ (semester 3 → year 2, semester 4 → year 2). semester null ise year da null
4. `type` sadece iki değer: `"zorunlu"` veya `"secmeli"` (küçük harf, c var ç yok)
5. `language` sadece iki değer: `"Türkçe"` veya `"İngilizce"`
6. Bulunamayan string alan = `null` | Bulunamayan liste alan = `[]` | Boş string `""` KULLANMA

### Liste Kuralları
7. `learning_outcomes` → her çıktı ayrı string, tek string içinde birleştirme
8. `weekly_topics` formatı: `"Hafta 1: ..."`, her hafta ayrı string
9. "Week 1" → `"Hafta 1: ..."` olarak çevir (sadece "Week" → "Hafta", içeriği çevirme)

### İçerik Kuralları
10. Çeviri YAPMA. Veri hangi dildeyse o dilde bırak
11. `purpose` = Dersin AMACI. "Bu ders neden var?" sorusunun cevabı. 1-3 cümle.
12. `description` = Dersin İÇERİĞİ. "Bu derste ne öğretiliyor?" sorusunun cevabı.
13. `purpose` ve `description` AYNI ŞEY DEĞİL. Biri "neden", diğeri "ne"

### Saat Kuralları
14. `hours_theory` ve `hours_practice` sadece sayı. Parse edemezsen null yaz.
15. Uygulama saati gerçekten 0 ise `0` yaz. Bilgi yoksa `null` yaz. 0 ile null farklı!

### Kategori ve Seçmeli Kuralları
16. Bölümün TÜM derslerini topla (zorunlu + seçmeli). Eksik ders bırakma.
17. `categories` = seçmeli havuz adları. Zorunlu dersler için: []
18. Üniversite seçmelileri gruplara ayırıyorsa → grup adlarını categories'e yaz
19. `department url` = {department_url}
20. `source_url` = dersin kaynak sayfasının URL'i (varsa)

### Akademik Kadro
21. `academic_staff` = professor, associate_professor, assistant_professor, lecturer, research_assistant, total
22. Bulunamazsa her alan 0, tüm bilgi yoksa `academic_staff` = null

## Çıktı JSON Formatı

```json
{{
  "university_name": "Üniversite Tam Adı",
  "department": "Bilgisayar Mühendisliği",
  "faculty": "Mühendislik Fakültesi",
  "language": "Türkçe",
  "type": "devlet",
  "department_url": "{department_url}",
  "program_outcomes": ["Program çıktısı 1"],
  "academic_staff": {{
    "professor": 5,
    "associate_professor": 14,
    "assistant_professor": 2,
    "lecturer": 3,
    "research_assistant": 8,
    "total": 32
  }},
  "courses": [
    {{
      "code": "CS 101",
      "name": "Programlamaya Giriş",
      "ects": 6,
      "semester": 1,
      "year": 1,
      "type": "zorunlu",
      "language": "İngilizce",
      "hours_theory": 3,
      "hours_practice": 2,
      "purpose": "Bu dersin amacı temel programlama kavramlarını öğretmektir.",
      "description": "Değişkenler, döngüler, fonksiyonlar, diziler konularını kapsar.",
      "learning_outcomes": [
        "Temel algoritmaları Python ile yazabilme",
        "Problem çözme becerisi kazanma"
      ],
      "weekly_topics": [
        "Hafta 1: Bilgisayar bilimine giriş",
        "Hafta 2: Değişkenler ve veri tipleri"
      ],
      "resources": ["Think Python, Allen Downey"],
      "prerequisites": ["CS 100"],
      "categories": [],
      "source_url": "https://..."
    }}
  ]
}}
```

SADECE JSON döndür. Başına/sonuna açıklama, markdown kod bloğu veya başka metin EKLEME.

## Toplanan Sayfa İçerikleri

{all_content}
"""


# ── Claude API ───────────────────────────────────────────────────────────────

def extract_with_claude(prompt: str) -> dict:
    """Prompt'u Claude API'ye gönder, JSON döndür."""
    try:
        import anthropic
    except ImportError:
        logger.error("anthropic paketi yüklü değil. Çalıştır: pip install anthropic")
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error(
            "ANTHROPIC_API_KEY ortam değişkeni bulunamadı. "
            ".env dosyasına ekle: ANTHROPIC_API_KEY=sk-ant-..."
        )
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    logger.info("Claude API'ye gönderiliyor...")

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # Claude zaman zaman ```json ... ``` bloğu içine sarıyor, temizle
    if response_text.startswith("```"):
        response_text = re.sub(r"^```(?:json)?\s*", "", response_text)
        response_text = re.sub(r"\s*```$", "", response_text.rstrip())

    return json.loads(response_text)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrapling + Claude API ile üniversite müfredatı topla"
    )
    parser.add_argument(
        "--university", required=True,
        help='Üniversite adı (Türkçe), örn: "Hacettepe Üniversitesi"',
    )
    parser.add_argument(
        "--url", required=True,
        help="Bölüm müfredat/ders-planı sayfasının URL'i",
    )
    parser.add_argument(
        "--output",
        help="Çıktı JSON dosyası (varsayılan: data/<üniversite_slug>.json)",
    )
    parser.add_argument(
        "--dynamic", action="store_true",
        help="Playwright/Chrome ile JS render (scrapling install gerektirir)",
    )
    parser.add_argument(
        "--max-pages", type=int, default=150,
        help="Taranacak maksimum ders sayfası sayısı (varsayılan: 150)",
    )
    args = parser.parse_args()

    # Çıktı yolu
    if args.output:
        output_path = Path(args.output)
    else:
        slug = re.sub(r"[^a-z0-9_]", "_", args.university.lower())
        slug = re.sub(r"_+", "_", slug).strip("_")
        output_path = Path("data") / f"{slug}.json"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info(f"Üniversite : {args.university}")
    logger.info(f"URL        : {args.url}")
    logger.info(f"Mod        : {'dinamik (tarayıcı)' if args.dynamic else 'statik (HTTP)'}")
    logger.info(f"Maks sayfa : {args.max_pages}")
    logger.info(f"Çıktı      : {output_path}")
    logger.info("=" * 60)

    # .env yükle
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    # 1. Sayfaları tara
    from .scrapers.crawler import crawl_university
    pages = crawl_university(
        department_url=args.url,
        dynamic=args.dynamic,
        max_pages=args.max_pages,
    )

    if not pages:
        logger.error(
            "Hiç sayfa çekilemedi.\n"
            "  - URL'yi kontrol et\n"
            "  - Site JS render kullanıyorsa --dynamic bayrağını ekle"
        )
        sys.exit(1)

    logger.info(f"{len(pages)} sayfadan içerik toplandı")

    # 2. Claude ile yapılandırılmış JSON'a dönüştür
    prompt = build_extraction_prompt(args.university, args.url, pages)

    try:
        data = extract_with_claude(prompt)
    except json.JSONDecodeError as e:
        logger.error(f"Claude'un yanıtı JSON olarak parse edilemedi: {e}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"API çağrısı başarısız: {e}")
        sys.exit(1)

    # 3. Kaydet
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    course_count = len(data.get("courses", []))
    logger.info(f"Tamamlandı! {course_count} ders → {output_path}")
    logger.info("Sonraki adım: python -m src.ingest")


if __name__ == "__main__":
    main()
