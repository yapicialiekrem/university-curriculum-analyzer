"use client";

/**
 * Pagination — basit sayfalama kontrol paneli.
 *
 * Liste içi sayfalama (route değiştirmez). Toplam item sayısı ve sayfa
 * boyutuna göre N sayfa hesaplanır. Boş veya tek sayfa durumunda render
 * etmez.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  /** Bilgi metni: "X-Y / total" + label (örn. "kaynak", "sonuç") */
  label?: string;
}

export function Pagination({ page, pageSize, total, onChange, label }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const goPrev = () => onChange(Math.max(1, page - 1));
  const goNext = () => onChange(Math.min(totalPages, page + 1));

  return (
    <div className="flex items-center justify-between gap-3 pt-2 text-xs">
      <span className="font-mono text-[color:var(--color-ink-500)]">
        {start}–{end} / {total}
        {label ? ` ${label}` : ""}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={goPrev}
          disabled={page <= 1}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border bg-[color:var(--color-paper-2)] text-[color:var(--color-ink-700)] hover:bg-[color:var(--color-paper-3)] disabled:opacity-30 disabled:hover:bg-[color:var(--color-paper-2)] transition-colors"
          aria-label="Önceki sayfa"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        <span className="font-mono tabular-nums px-2">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={page >= totalPages}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border bg-[color:var(--color-paper-2)] text-[color:var(--color-ink-700)] hover:bg-[color:var(--color-paper-3)] disabled:opacity-30 disabled:hover:bg-[color:var(--color-paper-2)] transition-colors"
          aria-label="Sonraki sayfa"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
