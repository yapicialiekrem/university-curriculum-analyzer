"use client";

/**
 * ResourcesTable — Dashboard Bileşen 3.3.
 *
 * Ortak ders kaynakları (kitap, makale) — iki üniversitede de geçen
 * kaynaklar tablo halinde.
 */

import type { ResourcesResponse } from "@/lib/types";
import { uniColor, uniShortName } from "@/lib/use-selection";

export interface ResourcesTableProps {
  data: ResourcesResponse | undefined;
  loading?: boolean;
}

export function ResourcesTable({ data, loading }: ResourcesTableProps) {
  if (loading || !data) {
    return <div className="h-[300px] skeleton rounded" />;
  }

  if (!data.shared_resources?.length) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Bu iki üniversitenin paylaştığı ders kaynağı bulunamadı.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-xs flex-wrap gap-2">
        <span className="ui-label">
          {data.shared_resources.length} ortak kaynak
        </span>
        {data.jaccard_similarity != null && (
          <span className="font-mono text-[color:var(--color-ink-500)]">
            Jaccard benzerlik: %{Math.round(data.jaccard_similarity * 100)}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr
              className="border-b ui-label"
              style={{ borderColor: "var(--color-line)" }}
            >
              <th className="py-2 pr-3 w-[40%]" style={{ color: uniColor(0) }}>
                {uniShortName("", data.university1.name)}
              </th>
              <th className="py-2 pr-3 w-[40%]" style={{ color: uniColor(1) }}>
                {uniShortName("", data.university2.name)}
              </th>
              <th className="py-2 pr-2 text-right">Eşleşen</th>
            </tr>
          </thead>
          <tbody>
            {data.shared_resources.map((r, i) => {
              const courses1 = r.courses_uni1 ?? [];
              const courses2 = r.courses_uni2 ?? [];
              return (
                <tr
                  key={i}
                  className="border-b last:border-0 align-top hover:bg-[color:var(--color-paper-2)] transition-colors"
                  style={{ borderColor: "var(--color-line)" }}
                >
                  <td className="py-2 pr-3">
                    <div className="italic font-serif text-[color:var(--color-ink-700)] leading-snug">
                      {r.resource_uni1 || "—"}
                    </div>
                    {courses1.length > 0 && (
                      <div className="font-mono text-[10px] text-[color:var(--color-ink-500)] mt-1">
                        {courses1.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="italic font-serif text-[color:var(--color-ink-700)] leading-snug">
                      {r.resource_uni2 || "—"}
                    </div>
                    {courses2.length > 0 && (
                      <div className="font-mono text-[10px] text-[color:var(--color-ink-500)] mt-1">
                        {courses2.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-xs text-[color:var(--color-ink-500)] whitespace-nowrap">
                    {r.matching_keywords?.length
                      ? r.matching_keywords.slice(0, 2).join(", ")
                      : ""}
                    {r.overlap_score != null && (
                      <div className="text-[10px] mt-0.5">
                        %{Math.round(r.overlap_score)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
