"use client";

/**
 * CurriculumCoverageHeatmap — Dashboard Bileşen 3.1.
 *
 * Haftalık konu örtüşmesi (full heatmap). Her satır = bir benzerlik çifti.
 *
 * /api/compare/curriculum-coverage top_n eşleşen konu çifti döner —
 * tabloda iki ders adı + benzerlik bar.
 */

import type { CurriculumCoverageResponse } from "@/lib/types";
import { uniColor, uniShortName } from "@/lib/use-selection";

export interface CurriculumCoverageHeatmapProps {
  data: CurriculumCoverageResponse | undefined;
  loading?: boolean;
}

export function CurriculumCoverageHeatmap({
  data,
  loading,
}: CurriculumCoverageHeatmapProps) {
  if (loading || !data) {
    return <div className="h-[300px] skeleton rounded" />;
  }

  if (!data.similar_topics?.length) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Bu iki üniversite arasında yeterince benzer konu çifti bulunamadı.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3 text-xs">
        <span className="font-mono" style={{ color: uniColor(0) }}>
          {uniShortName("", data.university1.name)} — {data.university1.total_topics} konu
        </span>
        <span className="font-mono" style={{ color: uniColor(1) }}>
          {uniShortName("", data.university2.name)} — {data.university2.total_topics} konu
        </span>
      </div>

      <ul className="space-y-2">
        {data.similar_topics.map((p, i) => {
          const pct = Math.round(p.similarity * 100);
          return (
            <li
              key={i}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5 rounded border bg-[color:var(--color-white-paper)]"
              style={{ borderColor: "var(--color-line)" }}
            >
              <div className="min-w-0">
                <code
                  className="block font-mono text-[10px]"
                  style={{ color: uniColor(0) }}
                >
                  {p.topic1.code}
                </code>
                <p className="text-sm leading-tight truncate">{p.topic1.topic}</p>
              </div>

              <div className="flex flex-col items-center w-16">
                <div className="font-serif text-lg font-medium tabular-nums leading-none">
                  {pct}%
                </div>
                <div className="mt-1 h-1 w-full rounded-full overflow-hidden bg-[color:var(--color-paper-2)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${pct}%`,
                      background: `rgba(45,106,138,${0.5 + p.similarity * 0.5})`,
                    }}
                  />
                </div>
              </div>

              <div className="min-w-0 text-right">
                <code
                  className="block font-mono text-[10px]"
                  style={{ color: uniColor(1) }}
                >
                  {p.topic2.code}
                </code>
                <p className="text-sm leading-tight truncate">{p.topic2.topic}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
