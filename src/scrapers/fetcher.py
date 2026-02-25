"""
Scrapling-based page fetcher.

Sağladığı iki şey:
  1. fetch_page()      → ham Scrapling sayfa nesnesi (selector çalıştırılabilir)
  2. get_page_content() → sayfanın tüm görünür metni (str)
  3. get_page_links()   → sayfadaki tüm mutlak URL'ler (list[str])

Fetcher seçimi:
  dynamic=False → Fetcher (hızlı HTTP, TLS fingerprint taklit)
  dynamic=True  → DynamicFetcher (Playwright/Chrome, JS render)
"""

import logging
import time
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)


def fetch_page(url: str, dynamic: bool = False, delay: float = 1.5):
    """
    URL'yi çek ve Scrapling sayfa nesnesini döndür.

    Args:
        url: Çekilecek URL
        dynamic: True → DynamicFetcher (JS sayfalar için), False → Fetcher
        delay: İstekler arası bekleme süresi (saniye) - siteye nazik olmak için
    """
    time.sleep(delay)

    if dynamic:
        from scrapling.fetchers import DynamicFetcher
        logger.info(f"[browser] {url}")
        return DynamicFetcher.fetch(url, headless=True, network_idle=True)
    else:
        from scrapling.fetchers import Fetcher
        logger.info(f"[http]    {url}")
        return Fetcher.get(url, stealthy_headers=True)


def get_page_content(url: str, dynamic: bool = False) -> str:
    """
    Sayfanın tüm görünür metin içeriğini döndür.
    Hata durumunda boş string döner.
    """
    try:
        page = fetch_page(url, dynamic)
        # Tüm metin düğümlerini çek, boşlukları temizle
        texts = page.css("*::text").getall()
        return "\n".join(t.strip() for t in texts if t.strip())
    except Exception as e:
        logger.error(f"İçerik alınamadı ({url}): {e}")
        return ""


def get_page_links(url: str, dynamic: bool = False) -> list[str]:
    """
    Sayfadaki tüm bağlantıları mutlak URL olarak döndür.
    Hata durumunda boş liste döner.
    """
    try:
        page = fetch_page(url, dynamic)
        hrefs = page.css("a::attr(href)").getall()

        result: list[str] = []
        seen: set[str] = set()

        for href in hrefs:
            if not href:
                continue
            href = href.strip()
            # Fragment ve javascript bağlantılarını atla
            if href.startswith("#") or href.lower().startswith("javascript"):
                continue
            absolute = urljoin(url, href)
            if absolute not in seen:
                seen.add(absolute)
                result.append(absolute)

        return result

    except Exception as e:
        logger.error(f"Bağlantılar alınamadı ({url}): {e}")
        return []
