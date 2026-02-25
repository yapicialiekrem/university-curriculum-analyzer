"""
Üniversite bölüm sayfası tarayıcısı.

Verilen bölüm URL'sinden başlayarak ders içeriklerini barındıran tüm
sayfaları tespit eder ve ham metin içeriklerini toplar.

Döndürdüğü şey: { url: metin_içeriği } sözlüğü
Bu içerik daha sonra Claude API'ye gönderilerek JSON'a dönüştürülür.
"""

import logging
from urllib.parse import urlparse

from .fetcher import get_page_content, get_page_links

logger = logging.getLogger(__name__)

# Bu anahtar kelimelerden biri URL'de ya da link metninde varsa → ders sayfası olabilir
COURSE_KEYWORDS = [
    "ders", "course", "müfredat", "curriculum", "program",
    "syllabus", "bologna", "akts", "ects", "katalog", "kataog",
    "plan", "havuz", "secmeli", "zorunlu", "elective", "mandatory",
]

# Bu anahtar kelimeler varsa → ilgisiz sayfa, atla
SKIP_KEYWORDS = [
    "login", "logout", "giris", "cikis",
    "iletisim", "contact", "haber", "news",
    "duyuru", "etkinlik", "event", "galeri", "gallery",
    "facebook", "twitter", "instagram", "linkedin", "youtube",
    "mailto:", "tel:", ".jpg", ".jpeg", ".png", ".gif", ".pdf", ".doc",
]


def _is_course_related(url: str) -> bool:
    """URL'nin ders içeriğiyle ilgili olup olmadığını heuristic olarak belirle."""
    lower = url.lower()
    if any(skip in lower for skip in SKIP_KEYWORDS):
        return False
    return any(kw in lower for kw in COURSE_KEYWORDS)


def _same_domain(url: str, base_domain: str) -> bool:
    """URL aynı domain'e mi ait?"""
    return urlparse(url).netloc == base_domain


def crawl_university(
    department_url: str,
    dynamic: bool = False,
    max_pages: int = 150,
) -> dict[str, str]:
    """
    Üniversite bölüm sayfasını tara ve ders içeriklerini topla.

    Algoritma:
      1. Ana bölüm sayfasını çek
      2. Sayfadaki tüm linkleri bul
      3. Aynı domain + ders ile ilgili linkleri filtrele
      4. Her birini çekip metin içeriğini kaydet

    Args:
        department_url: Bölümün müfredat/ders planı sayfası
        dynamic: JS render gerektiren siteler için True
        max_pages: Çekilecek maksimum ders sayfası sayısı

    Returns:
        { url → sayfa_metni } sözlüğü
    """
    pages: dict[str, str] = {}
    base_domain = urlparse(department_url).netloc

    # ── 1. Ana sayfayı çek ──────────────────────────────────────────────────
    logger.info(f"Ana sayfa çekiliyor: {department_url}")
    main_content = get_page_content(department_url, dynamic)
    if main_content:
        pages[department_url] = main_content
    else:
        logger.warning("Ana sayfa içeriği boş geldi. URL'yi kontrol et.")

    # ── 2. Tüm linkleri bul ─────────────────────────────────────────────────
    all_links = get_page_links(department_url, dynamic)
    logger.info(f"Ana sayfada {len(all_links)} link bulundu")

    # ── 3. Filtrele: aynı domain + ders ile ilgili ──────────────────────────
    course_links = [
        link for link in all_links
        if _same_domain(link, base_domain) and _is_course_related(link)
    ]
    logger.info(f"Ders ile ilgili {len(course_links)} link tespit edildi")

    # ── 4. Her sayfayı çek ──────────────────────────────────────────────────
    fetched = 0
    for link in course_links:
        if fetched >= max_pages:
            logger.warning(f"Maksimum sayfa sınırına ulaşıldı ({max_pages}), durduruluyor")
            break
        if link in pages:
            continue

        content = get_page_content(link, dynamic)
        if content:
            pages[link] = content
            fetched += 1
            total = min(len(course_links), max_pages)
            logger.info(f"  [{fetched}/{total}] {link}")

    logger.info(f"Toplam çekilen sayfa: {len(pages)}")
    return pages
