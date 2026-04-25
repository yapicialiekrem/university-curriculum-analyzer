"use client";

/**
 * OutcomesHeatmap — Dashboard Bileşen 2.4.
 *
 * Program çıktıları benzerlik ısı haritası.
 * /api/compare/program-outcomes top_n eşleşen çift döner.
 *
 * Görsel: A program çıktıları sütun, B program çıktıları satır.
 * Hücre koyuluğu = cosine benzerlik. Tıklanırsa altta detay açılır.
 */

import { useMemo, useState } from "react";

import type { ProgramOutcomesResponse } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface OutcomesHeatmapProps {
  data: ProgramOutcomesResponse | undefined;
  loading?: boolean;
}

export function OutcomesHeatmap({ data, loading }: OutcomesHeatmapProps) {
  const [hovered, setHovered] = useState<{ a: number; b: number } | null>(null);

  const grid = useMemo(() => {
    if (!data) return null;
    // (i,j) → similarity
    const map = new Map<string, number>();
    let maxA = 0, maxB = 0;
    for (const p of data.similar_pairs) {
      const i = p.outcome1.index;
      const j = p.outcome2.index;
      map.set(`${i}:${j}`, p.similarity);
      maxA = Math.max(maxA, i);
      maxB = Math.max(maxB, j);
    }
    return { map, maxA, maxB };
  }, [data]);

  if (loading || !data) {
    return <div className="h-[260px] skeleton rounded" />;
  }

  if (!data.similar_pairs.length) {
    return <p className="text-sm text-[color:var(--color-ink-500)]">Karşılaştırılabilir program çıktısı bulunamadı.</p>;
  }

  const { map, maxA, maxB } = grid!;
  const aIndices = Array.from({ length: maxA + 1 }, (_, i) => i);
  const bIndices = Array.from({ length: maxB + 1 }, (_, i) => i);

  // Hover'da ekteki çiftin metinlerini göstereceğiz
  const hoveredPair = hovered
    ? data.similar_pairs.find(
        (p) => p.outcome1.index === hovered.a && p.outcome2.index === hovered.b
      )
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <span className="ui-label">Program Çıktısı Benzerliği</span>
          <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] mt-1">
            Hücre koyuluğu = cosine benzerlik. {data.similar_pairs.length} eşleşen çift.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: uniColor(0) }} />
            {data.university1.name.split(" ")[0]} ({data.university1.outcome_count})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: uniColor(1) }} />
            {data.university2.name.split(" ")[0]} ({data.university2.outcome_count})
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {aIndices.map((i) => (
                <th
                  key={i}
                  className="ui-label text-center w-7 pb-1"
                  style={{ color: uniColor(0) }}
                >
                  P{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bIndices.map((j) => (
              <tr key={j}>
                <th
                  scope="row"
                  className="ui-label text-right pr-2"
                  style={{ color: uniColor(1) }}
                >
                  P{j + 1}
                </th>
                {aIndices.map((i) => {
                  const sim = map.get(`${i}:${j}`) || 0;
                  const isHovered =
                    hovered && hovered.a === i && hovered.b === j;
                  return (
                    <td key={i} className="p-0">
                      <button
                        className="block w-7 h-7 rounded-sm transition-transform hover:scale-110"
                        style={{
                          background: sim > 0
                            ? `rgba(45,106,138,${0.15 + sim * 0.85})`
                            : "var(--color-paper-2)",
                          outline: isHovered
                            ? `2px solid var(--color-ink-900)`
                            : "none",
                        }}
                        onMouseEnter={() => setHovered({ a: i, b: j })}
                        onMouseLeave={() => setHovered(null)}
                        title={sim > 0 ? `%${Math.round(sim * 100)} benzerlik` : "—"}
                        aria-label={`${data.university1.name} P${i + 1} ↔ ${data.university2.name} P${j + 1}: ${Math.round(sim * 100)}%`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hover detay */}
      {hoveredPair && (
        <div className="mt-3 p-4 rounded border bg-[color:var(--color-paper-2)]" style={{ borderColor: "var(--color-line)" }}>
          <div className="text-xs font-mono uppercase tracking-wider mb-2 text-[color:var(--color-ink-500)]">
            %{Math.round(hoveredPair.similarity * 100)} benzerlik
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs font-mono mr-2" style={{ color: uniColor(0) }}>
                P{hoveredPair.outcome1.index + 1}
              </span>
              {hoveredPair.outcome1.text}
            </div>
            <div>
              <span className="text-xs font-mono mr-2" style={{ color: uniColor(1) }}>
                P{hoveredPair.outcome2.index + 1}
              </span>
              {hoveredPair.outcome2.text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
