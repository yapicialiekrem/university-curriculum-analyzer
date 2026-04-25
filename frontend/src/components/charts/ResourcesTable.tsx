"use client";

/**
 * ResourcesTable — Dashboard Bileşen 3.3.
 *
 * Ortak ders kaynakları (kitap, makale) — iki üniversitede de geçen
 * kaynaklar tablo halinde.
 */

import type { ResourcesResponse } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

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
              <th className="py-2 pr-4">Kaynak</th>
              <th className="py-2 px-2 text-center" style={{ color: uniColor(0) }}>
                {data.university1.name.split(" ")[0]}
              </th>
              <th className="py-2 px-2 text-center" style={{ color: uniColor(1) }}>
                {data.university2.name.split(" ")[0]}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.shared_resources.map((r, i) => (
              <tr
                key={i}
                className="border-b last:border-0 hover:bg-[color:var(--color-paper-2)] transition-colors"
                style={{ borderColor: "var(--color-line)" }}
              >
                <td className="py-2 pr-4 italic font-serif text-[color:var(--color-ink-700)]">
                  {r.resource}
                </td>
                <td className="py-2 px-2 text-center font-mono text-xs text-[color:var(--color-ink-500)]">
                  {r.uni1_courses.length > 0 ? r.uni1_courses.join(", ") : "—"}
                </td>
                <td className="py-2 px-2 text-center font-mono text-xs text-[color:var(--color-ink-500)]">
                  {r.uni2_courses.length > 0 ? r.uni2_courses.join(", ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
