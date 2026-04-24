"""
Enrichment canlı durum raporu.

Kullanım:
    python -m src.enrichment.status               # Tek seferlik
    python -m src.enrichment.status --watch       # Her 5 sn yenile
    python -m src.enrichment.status --per-file    # Dosya bazlı detay

Log dosyalarından (src/enrichment/logs/*.jsonl) + data/*.json dosyalarındaki
`_enriched` alanlarından canlı istatistik üretir. Çalışan enrich.py
process'iyle iletişim gerektirmez — sadece disk okur.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
LOG_PATH = HERE / "logs" / "enrichment.jsonl"
ERROR_PATH = HERE / "logs" / "errors.jsonl"
REPO_ROOT = HERE.parent.parent
DATA_DIR = REPO_ROOT / "data"

BUDGET = 20.0    # --budget 20 ile başlattık


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _scan_data() -> tuple[int, int, dict[str, tuple[int, int]]]:
    """Toplam ders, enriched olanlar, per-file (total, enriched)."""
    total = 0
    enriched_total = 0
    per_file: dict[str, tuple[int, int]] = {}
    for path in sorted(DATA_DIR.rglob("*.json")):
        try:
            with path.open(encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        courses = d.get("courses", []) or []
        en = sum(1 for c in courses if c.get("_enriched"))
        rel = str(path.relative_to(REPO_ROOT))
        per_file[rel] = (len(courses), en)
        total += len(courses)
        enriched_total += en
    return total, enriched_total, per_file


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    if seconds < 3600:
        return f"{seconds/60:.1f} dk"
    return f"{seconds/3600:.1f} sa"


def _fmt_eta(ratio: float, elapsed: float) -> str:
    if ratio <= 0:
        return "?"
    total_est = elapsed / ratio
    remaining = total_est - elapsed
    return _fmt_duration(remaining)


def print_status(per_file: bool = False) -> None:
    log_rows = _read_jsonl(LOG_PATH)
    err_rows = _read_jsonl(ERROR_PATH)
    total_courses, enriched_done_disk, per_file_map = _scan_data()

    # Log'dan maliyet/token toplamları
    ok_count = len(log_rows)
    err_count = len(err_rows)
    total_cost = sum(float(r.get("cost_usd") or 0) for r in log_rows)
    total_tok_in = sum(int(r.get("tokens_in") or 0) for r in log_rows)
    total_tok_out = sum(int(r.get("tokens_out") or 0) for r in log_rows)

    # Zamanlama — ilk ve son log kayıtları arasındaki fark
    elapsed_s = 0.0
    avg_latency_ms = None
    rate_per_min = None
    if log_rows:
        try:
            ts_first = datetime.fromisoformat(log_rows[0]["timestamp"])
            ts_last = datetime.fromisoformat(log_rows[-1]["timestamp"])
            elapsed_s = (ts_last - ts_first).total_seconds()
        except Exception:
            pass
        lats = [r.get("latency_ms") for r in log_rows if r.get("latency_ms")]
        if lats:
            avg_latency_ms = sum(lats) / len(lats)
        if elapsed_s > 0:
            rate_per_min = ok_count / elapsed_s * 60

    # Kalan / ETA — log tabanlı (disk ilerlemesi dosya tamamlanmadıkça
    # sıfır kalır, log her ders için güncel)
    target = total_courses
    done_ratio = enriched_done_disk / target if target else 0
    if rate_per_min and ok_count:
        remaining_courses = target - ok_count
        eta_seconds = (remaining_courses / rate_per_min) * 60 if rate_per_min > 0 else 0
        eta = _fmt_duration(eta_seconds)
    else:
        eta = "?"

    # Son işlenen ders
    last = log_rows[-1] if log_rows else None

    # Kategori dağılımı (primary_category)
    cat_counter = Counter(r.get("primary_category") for r in log_rows)

    print("═" * 64)
    print(f"  📊 UniCurriculum enrichment — {datetime.now().strftime('%H:%M:%S')}")
    print("═" * 64)
    print(f"  İlerleme        : {enriched_done_disk} / {target} ders "
          f"({done_ratio*100:.1f}%)")
    print(f"  Başarılı (log)  : {ok_count}")
    print(f"  Hatalı          : {err_count}")
    print()
    print(f"  💰 Harcanan     : ${total_cost:.4f}  /  ${BUDGET:.2f} bütçe "
          f"({total_cost/BUDGET*100:.1f}%)")
    print(f"     Token in/out : {total_tok_in:,} / {total_tok_out:,}")
    if ok_count:
        print(f"     $/ders ort.  : ${total_cost/ok_count:.4f}")
        remaining = target - enriched_done_disk
        est_cost_rem = (total_cost / ok_count) * remaining
        print(f"     Kalan tahmin : ${est_cost_rem:.2f} ({remaining} ders)")
    print()
    if ok_count > 1 and elapsed_s > 0:
        print(f"  ⏱  Süre         : {_fmt_duration(elapsed_s)} (log ilk→son)")
        print(f"     Hız          : {rate_per_min:.1f} ders/dk")
        if avg_latency_ms:
            print(f"     LLM latency  : {avg_latency_ms:.0f} ms ort.")
        print(f"     Kalan ETA    : {eta}")
    print()
    if last:
        print(f"  ⏵ Son ders      : {last.get('course_code')} → "
              f"{last.get('primary_category')} "
              f"(${last.get('cost_usd'):.4f}, "
              f"{last.get('latency_ms')} ms)")
    if cat_counter:
        top = cat_counter.most_common(6)
        print(f"  🏷  Top kategoriler: "
              + ", ".join(f"{c}={n}" for c, n in top))

    if per_file:
        print()
        print("  📁 Dosya bazlı:")
        # En yoğun aktif olanları göster
        rows = sorted(per_file_map.items(), key=lambda kv: -kv[1][1])
        for rel, (tot, en) in rows:
            if en == 0:
                continue
            bar = "█" * int(en / tot * 20) + "░" * (20 - int(en / tot * 20))
            print(f"    {rel:<35s} [{bar}] {en:>4d}/{tot:<4d}")

    # Başarısız ders örnekleri
    if err_rows:
        print()
        print(f"  ⚠ İlk 3 hata:")
        for r in err_rows[:3]:
            print(f"    {r.get('course_code'):<12s} → "
                  f"{str(r.get('error',''))[:80]}")

    print("═" * 64)


def main() -> int:
    ap = argparse.ArgumentParser(description="Enrichment canlı durumu")
    ap.add_argument("--watch", action="store_true",
                    help="Her 5 sn yenile (Ctrl-C ile çık)")
    ap.add_argument("--interval", type=int, default=5,
                    help="--watch için saniye (default 5)")
    ap.add_argument("--per-file", action="store_true",
                    help="Dosya bazlı ilerleme barları")
    args = ap.parse_args()

    if not args.watch:
        print_status(per_file=args.per_file)
        return 0

    try:
        while True:
            # clear screen (basit)
            sys.stdout.write("\033[2J\033[H")
            sys.stdout.flush()
            print_status(per_file=args.per_file)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n(izleme durduruldu)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
