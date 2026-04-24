"""
Azure OpenAI ile ders zenginleştirme — ana CLI.

Kullanım:
    python -m src.enrichment.enrich --dry-run           # Sadece tahmin
    python -m src.enrichment.enrich --max 5             # İlk 5 dersi dene
    python -m src.enrichment.enrich --file data/bilgisayar/metu.json
    python -m src.enrichment.enrich --force             # Zaten enriched'ları yeniden dene
    python -m src.enrichment.enrich --budget 25         # Max bütçe (USD)

Canlı progress tracking (her tqdm iterasyonunda postfix):
    $0.43 | ok=47 err=2 | 45ms avg | eta_cost=$1.12

İdempotent: `_enriched.enrichment_version` bu modüldeki
`ENRICHMENT_VERSION`'dan eski veya yoksa yeniden üretir.

Çıktı:
    data/*/*.json  → in-place güncellenir (her ders için _enriched, her
                      dosya sonunda _summary).
    src/enrichment/logs/enrichment.jsonl → her başarılı çağrı
    src/enrichment/logs/errors.jsonl     → her başarısız ders
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from tqdm import tqdm

from .aggregator import SUMMARY_VERSION, build_university_summary
from .llm_client import (
    PRICE_INPUT_PER_1M,
    PRICE_OUTPUT_PER_1M,
    AzureLLMClient,
)
from .prompts import (
    COURSE_PROMPT_TEMPLATE,
    NOT_CS_CATEGORY,
    SYSTEM_PROMPT,
    VALID_BLOOM_LEVELS,
    VALID_CATEGORIES,
)

load_dotenv()

ENRICHMENT_VERSION = 1

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
LOG_DIR = Path(__file__).parent / "logs"
LOG_PATH = LOG_DIR / "enrichment.jsonl"
ERROR_PATH = LOG_DIR / "errors.jsonl"

# Her ders için prompt maliyet tahmini (token) — MD'den
EST_INPUT_TOKENS_PER_COURSE = 1300
EST_OUTPUT_TOKENS_PER_COURSE = 250

# Rate limit güvenlik marjı: 150 req/dk → 0.4s; biz 0.5s veriyoruz
REQUEST_INTERVAL_S = 0.5

# LLM params
ANSWER_MAX_TOKENS = 600
TEMPERATURE = 0.1

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# LOG / KAYIT
# ═══════════════════════════════════════════════════════════════════════════

def _log(path: Path, entry: dict) -> None:
    """jsonl'e tek satır ekle. Asla exception fırlatmaz."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
    except Exception as e:  # pragma: no cover
        log.warning("Log yazma hatası %s: %s", path.name, e)


# ═══════════════════════════════════════════════════════════════════════════
# VALIDASYON — LLM çıktısını Pydantic yerine elle kontrol ediyoruz
# (minimum bağımlılık; MD "her alanda type hint" kuralına uyuyor)
# ═══════════════════════════════════════════════════════════════════════════

def _validate_enrichment(data: dict) -> tuple[dict, Optional[str]]:
    """LLM çıktısını doğrula + normalize et.

    Returns:
        (normalized_dict, error_message_or_None)
        Eğer hata varsa normalized içi kısmen dolu olabilir — caller
        None kontrolü yapmalı.
    """
    if not isinstance(data, dict):
        return {}, "output is not a dict"

    # categories
    cats = data.get("categories")
    if not isinstance(cats, list) or not cats:
        return data, "categories boş veya liste değil"
    cats = [c for c in cats if isinstance(c, str) and c in VALID_CATEGORIES]
    if not cats:
        return data, "categories listesinde geçerli kategori yok"
    data["categories"] = cats[:3]  # max 3

    # primary_category
    primary = data.get("primary_category")
    if primary not in VALID_CATEGORIES:
        primary = cats[0]
    if primary not in data["categories"]:
        primary = data["categories"][0]
    data["primary_category"] = primary

    # modernity_score
    try:
        ms = int(data.get("modernity_score", 50))
    except (TypeError, ValueError):
        ms = 50
    data["modernity_score"] = max(0, min(100, ms))

    # tags (lowercase, list[str])
    for fld in ("modern_tech_tags", "legacy_tech_tags"):
        v = data.get(fld) or []
        if not isinstance(v, list):
            v = []
        data[fld] = [str(x).strip().lower() for x in v if str(x).strip()]

    # bloom_level
    bl = data.get("bloom_level")
    if bl not in VALID_BLOOM_LEVELS:
        bl = "apply"
    data["bloom_level"] = bl

    # bloom_distribution (6 float)
    bd = data.get("bloom_distribution") or {}
    if not isinstance(bd, dict):
        bd = {}
    for k in VALID_BLOOM_LEVELS:
        try:
            bd[k] = float(bd.get(k, 0.0))
        except (TypeError, ValueError):
            bd[k] = 0.0
    total = sum(bd[k] for k in VALID_BLOOM_LEVELS)
    if total <= 0:
        bd = {k: (1.0 if k == bl else 0.0) for k in VALID_BLOOM_LEVELS}
    elif abs(total - 1.0) > 0.15:  # normalize eğer çok kaçıksa
        bd = {k: round(bd[k] / total, 3) for k in VALID_BLOOM_LEVELS}
    data["bloom_distribution"] = bd

    # bool
    data["is_project_heavy"] = bool(data.get("is_project_heavy", False))

    # enum-ish strings
    for fld, valid in (
        ("difficulty_level", {"beginner", "intermediate", "advanced"}),
        ("language_of_instruction", {"tr", "en", "other"}),
        ("resources_language", {"tr", "en", "mixed", "unknown"}),
        ("confidence", {"high", "medium", "low"}),
    ):
        v = str(data.get(fld, "")).lower()
        if v not in valid:
            # makul default'lar
            defaults = {
                "difficulty_level": "intermediate",
                "language_of_instruction": "other",
                "resources_language": "unknown",
                "confidence": "low",
            }
            v = defaults[fld]
        data[fld] = v

    return data, None


# ═══════════════════════════════════════════════════════════════════════════
# TEK DERS ZENGİNLEŞTİRME
# ═══════════════════════════════════════════════════════════════════════════

def _fmt_topic_list(items, max_items: int, max_chars: int) -> str:
    """List → " | " join, truncated."""
    if not items:
        return ""
    out = " | ".join(str(x) for x in items[:max_items] if x)
    return out[:max_chars]


def enrich_course(course: dict, client: AzureLLMClient) -> Optional[dict]:
    """Tek dersi LLM ile zenginleştir. Başarısızsa None (çağıran log'lar)."""
    prompt = COURSE_PROMPT_TEMPLATE.format(
        code=course.get("code", ""),
        name=course.get("name", ""),
        course_type=course.get("type") or "unknown",
        ects=course.get("ects"),
        semester=course.get("semester"),
        language=course.get("language") or "unknown",
        purpose=(course.get("purpose") or "")[:500],
        description=(course.get("description") or "")[:500],
        weekly_topics=_fmt_topic_list(
            course.get("weekly_topics"), 14, 1500
        ),
        learning_outcomes=_fmt_topic_list(
            course.get("learning_outcomes"), 15, 1500
        ),
        resources=_fmt_topic_list(course.get("resources"), 10, 500),
    )

    try:
        response, meta = client.ask(
            system=SYSTEM_PROMPT,
            prompt=prompt,
            response_format={"type": "json_object"},
            max_tokens=ANSWER_MAX_TOKENS,
            temperature=TEMPERATURE,
        )
    except Exception as e:
        _log(ERROR_PATH, {
            "course_code": course.get("code"),
            "error": f"{type(e).__name__}: {e}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return None

    # Parse
    try:
        data = json.loads(response)
    except json.JSONDecodeError as e:
        _log(ERROR_PATH, {
            "course_code": course.get("code"),
            "error": f"json parse: {e}",
            "response_preview": response[:200],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return None

    data, err = _validate_enrichment(data)
    if err:
        _log(ERROR_PATH, {
            "course_code": course.get("code"),
            "error": f"validation: {err}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return None

    data["enrichment_version"] = ENRICHMENT_VERSION
    data["enriched_at"] = datetime.now(timezone.utc).isoformat()

    _log(LOG_PATH, {
        "course_code": course.get("code"),
        "primary_category": data["primary_category"],
        "tokens_in": meta["tokens_in"],
        "tokens_out": meta["tokens_out"],
        "cost_usd": meta["cost_usd"],
        "latency_ms": meta["latency_ms"],
        "timestamp": data["enriched_at"],
    })
    return data


# ═══════════════════════════════════════════════════════════════════════════
# TEK ÜNİVERSİTE
# ═══════════════════════════════════════════════════════════════════════════

def enrich_university(
    path: Path,
    client: AzureLLMClient,
    *,
    force: bool = False,
    max_courses: Optional[int] = None,
    budget_remaining: Optional[float] = None,
) -> dict:
    """Bir üniversitenin tüm derslerini işle.

    Returns:
        Durum dict: {file, total, processed, ok, err, cost}
    """
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    courses: list[dict] = data.get("courses", []) or []
    if max_courses:
        courses_scope = courses[:max_courses]
    else:
        courses_scope = courses

    # Zaten güncel olanları atla (force dışında)
    to_enrich: list[dict] = []
    for course in courses_scope:
        existing = course.get("_enriched")
        if force or not existing or (
            existing.get("enrichment_version", 0) < ENRICHMENT_VERSION
        ):
            to_enrich.append(course)

    stats = {
        "file": path.name,
        "total": len(courses),
        "scope": len(courses_scope),
        "to_enrich": len(to_enrich),
        "ok": 0,
        "err": 0,
        "cost": 0.0,
    }

    if not to_enrich:
        tqdm.write(f"  ✓ {path.name}: hepsi güncel, atlandı")
        return stats

    desc = f"  {path.stem[:18]:<18s}"
    start_cost = client.total_cost
    latencies: list[int] = []

    # tqdm.write → warning callback ile uyumlu
    client._warn = tqdm.write

    with tqdm(
        total=len(to_enrich),
        desc=desc,
        unit="ders",
        leave=True,
        bar_format="{l_bar}{bar:25}{r_bar}",
    ) as pbar:
        for course in to_enrich:
            # Bütçe koruması — çağrı ÖNCESİ kontrol
            if budget_remaining is not None:
                if (client.total_cost - start_cost + stats["cost"]) > budget_remaining:
                    tqdm.write(
                        f"⚠ Bütçe aşıldı ({client.total_cost:.2f} USD), durduruluyor."
                    )
                    break

            enriched = enrich_course(course, client)
            if enriched:
                course["_enriched"] = enriched
                stats["ok"] += 1
            else:
                stats["err"] += 1

            # Son çağrı meta'sı (client.total_cost güncelleniyor)
            stats["cost"] = round(client.total_cost - start_cost, 4)
            if client.total_requests:
                # Ortalama latency tahmini — son ~10'un ortalaması
                pass

            # Progress postfix — CANLI tracking
            pbar.set_postfix_str(
                f"${stats['cost']:.3f} | ok={stats['ok']} err={stats['err']} | "
                f"total=${client.total_cost:.2f}"
            )
            pbar.update(1)

            time.sleep(REQUEST_INTERVAL_S)

    # Üniversite özeti (enriched olmayan courses için de çalışır)
    data["_summary"] = build_university_summary(data)

    # Güvenli yaz: önce .tmp'ye, sonra rename (yarım kalırsa JSON bozulmaz)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

    return stats


# ═══════════════════════════════════════════════════════════════════════════
# MALİYET TAHMİNİ
# ═══════════════════════════════════════════════════════════════════════════

def estimate_cost(
    files: list[Path], max_per_file: Optional[int] = None
) -> dict:
    """Toplam maliyet tahmini (LLM çağırmadan)."""
    total_courses = 0
    per_file: list[dict] = []
    for path in files:
        try:
            with path.open(encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        n = len(data.get("courses", []))
        if max_per_file is not None:
            n = min(n, max_per_file)
        total_courses += n
        per_file.append({"file": str(path.relative_to(REPO_ROOT)),
                         "courses": n})

    input_tokens = total_courses * EST_INPUT_TOKENS_PER_COURSE
    output_tokens = total_courses * EST_OUTPUT_TOKENS_PER_COURSE
    cost_usd = (
        input_tokens * PRICE_INPUT_PER_1M
        + output_tokens * PRICE_OUTPUT_PER_1M
    ) / 1_000_000

    return {
        "total_courses": total_courses,
        "file_count": len(per_file),
        "estimated_input_tokens": input_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_cost_usd": round(cost_usd, 2),
        "estimated_time_minutes": round(
            total_courses * REQUEST_INTERVAL_S / 60, 1
        ),
        "per_file": per_file,
    }


# ═══════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════

def _gather_files(file_arg: Optional[str]) -> list[Path]:
    if file_arg:
        p = Path(file_arg)
        if not p.is_absolute():
            # relative to CWD veya repo
            if (REPO_ROOT / p).exists():
                p = REPO_ROOT / p
        return [p]
    return sorted(DATA_DIR.rglob("*.json"))


def _format_estimate(est: dict) -> str:
    lines = [
        "",
        "═" * 64,
        f"  Dosya sayısı:     {est['file_count']}",
        f"  Toplam ders:      {est['total_courses']}",
        f"  Tahmini input:    {est['estimated_input_tokens']:,} token",
        f"  Tahmini output:   {est['estimated_output_tokens']:,} token",
        f"  Tahmini maliyet:  ${est['estimated_cost_usd']:.2f}",
        f"  Tahmini süre:     {est['estimated_time_minutes']} dakika",
        "═" * 64,
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Azure OpenAI ile ders zenginleştirme."
    )
    parser.add_argument("--file", help="Tek JSON yolu (relative veya absolute)")
    parser.add_argument("--force", action="store_true",
                        help="Mevcut enrichment'ı yoksay, yeniden üret")
    parser.add_argument("--max", type=int,
                        help="Üniversite başına max ders (test için)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Sadece maliyet tahmini, LLM çağırma")
    parser.add_argument("--budget", type=float, default=30.0,
                        help="Max bütçe USD (varsayılan 30)")
    parser.add_argument("--yes", action="store_true",
                        help="Onay sormadan başla")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)

    files = _gather_files(args.file)
    if not files or not files[0].exists():
        print(f"❌ Dosya bulunamadı: {args.file or DATA_DIR}")
        return 1

    # Maliyet tahmini
    estimate = estimate_cost(files, max_per_file=args.max)
    print(_format_estimate(estimate))

    if args.dry_run:
        return 0

    # Bütçe uyarısı
    if estimate["estimated_cost_usd"] > args.budget:
        print(
            f"⚠️  Tahmini maliyet (${estimate['estimated_cost_usd']:.2f}) "
            f"bütçeyi (${args.budget:.2f}) aşıyor!"
        )
        if not args.yes:
            c = input("Devam etmek istiyor musun? (yes/no): ").strip().lower()
            if c != "yes":
                print("İptal edildi.")
                return 0

    if not args.yes:
        c = input("Başlamak için 'yes' yaz: ").strip().lower()
        if c != "yes":
            print("İptal edildi.")
            return 0

    # Client + ana döngü
    try:
        client = AzureLLMClient(on_warning=tqdm.write)
    except RuntimeError as e:
        print(f"❌ {e}")
        return 1

    overall_start = time.time()
    all_stats: list[dict] = []
    budget_remaining = args.budget

    try:
        for path in files:
            try:
                stats = enrich_university(
                    path, client,
                    force=args.force,
                    max_courses=args.max,
                    budget_remaining=budget_remaining - client.total_cost,
                )
                all_stats.append(stats)
                tqdm.write(
                    f"  ✓ {stats['file']}: ok={stats['ok']} err={stats['err']} "
                    f"(+${stats['cost']:.3f}, toplam ${client.total_cost:.2f})"
                )
                if client.total_cost >= budget_remaining:
                    tqdm.write(
                        f"⚠ Bütçe limitine ulaşıldı "
                        f"(${client.total_cost:.2f}); kalan dosyalar atlanıyor."
                    )
                    break
            except KeyboardInterrupt:
                raise
            except Exception as e:
                tqdm.write(f"  ❌ {path.name}: {type(e).__name__}: {e}")
                all_stats.append({
                    "file": path.name, "error": str(e),
                    "ok": 0, "err": 0, "cost": 0.0,
                })
    except KeyboardInterrupt:
        tqdm.write("\n⚠ Kullanıcı durdurdu (KeyboardInterrupt).")

    # ─── Final rapor ──────────────────────────────────────────────────
    elapsed_min = (time.time() - overall_start) / 60
    total_ok = sum(s.get("ok", 0) for s in all_stats)
    total_err = sum(s.get("err", 0) for s in all_stats)

    print()
    print("═" * 64)
    print("  ✅ TAMAMLANDI")
    print("═" * 64)
    print(f"  İşlenen dosya   : {len(all_stats)}")
    print(f"  Başarılı        : {total_ok} ders")
    print(f"  Hatalı          : {total_err} ders")
    print(f"  LLM istek       : {client.total_requests}")
    print(f"  Token in/out    : "
          f"{client.total_tokens_in:,} / {client.total_tokens_out:,}")
    print(f"  Toplam maliyet  : ${client.total_cost:.4f}")
    print(f"  Süre            : {elapsed_min:.1f} dakika")
    print(f"  Log             : {LOG_PATH.relative_to(REPO_ROOT)}")
    if total_err:
        print(f"  Hata logu       : {ERROR_PATH.relative_to(REPO_ROOT)}")
    print("═" * 64)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
