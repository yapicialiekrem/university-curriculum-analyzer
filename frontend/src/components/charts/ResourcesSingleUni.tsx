"use client";

/**
 * ResourcesSingleUni — Tek üniversite seçiliyken Bileşen 3.3.
 *
 * Karşılaştırma yok; o üniversitenin tüm ders kaynakları (kitap, makale)
 * tek tabloda, arama input'u ile filtrelenebilir.
 */

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { UniversityResourcesResponse } from "@/lib/types";

export interface ResourcesSingleUniProps {
  data: UniversityResourcesResponse | undefined;
  loading?: boolean;
}

export function ResourcesSingleUni({ data, loading }: ResourcesSingleUniProps) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!data?.resources) return [];
    const ql = q.trim().toLowerCase();
    if (!ql) return data.resources;
    return data.resources.filter(
      (r) =>
        r.resource.toLowerCase().includes(ql) ||
        r.courses.some((c) => c.toLowerCase().includes(ql))
    );
  }, [data, q]);

  if (loading || !data) {
    return <div className="h-[300px] skeleton rounded" />;
  }

  if (!data.resources?.length) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Bu üniversite için kaydedilmiş ders kaynağı bulunamadı.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="ui-label">
          {data.total_resources} kaynak — {data.university.name}
        </span>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded border bg-[color:var(--color-paper-2)] text-sm w-full sm:w-[260px]"
          style={{ borderColor: "var(--color-line)" }}
        >
          <Search size={14} strokeWidth={1.5} className="text-[color:var(--color-ink-500)]" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kitap/ders kodu ara..."
            aria-label="Kaynak ara"
            className="flex-1 bg-transparent outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr
              className="border-b ui-label"
              style={{ borderColor: "var(--color-line)" }}
            >
              <th className="py-2 pr-3">Kaynak</th>
              <th className="py-2 pr-2 text-right">Dersler</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="py-4 text-sm italic font-serif text-[color:var(--color-ink-500)] text-center"
                >
                  Eşleşme yok.
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr
                  key={i}
                  className="border-b last:border-0 align-top hover:bg-[color:var(--color-paper-2)] transition-colors"
                  style={{ borderColor: "var(--color-line)" }}
                >
                  <td className="py-2 pr-3">
                    <div className="italic font-serif text-[color:var(--color-ink-700)] leading-snug">
                      {r.resource}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-[10px] text-[color:var(--color-ink-500)] whitespace-nowrap">
                    {r.courses.join(", ") || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
