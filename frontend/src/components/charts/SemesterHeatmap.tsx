"use client";

/**
 * SemesterHeatmap — Dashboard Bileşen 2.1.
 *
 * 8 dönem × 10 kategori matris. Her hücrede:
 *   - boyut/dolgu = AKTS yoğunluğu
 *   - solid = zorunlu
 *   - çizgili = seçmeli (SVG pattern)
 *
 * İki/üç üniversite YAN YANA — her biri ayrı heatmap.
 */

import { useState } from "react";

import type { HeatmapResponse, HeatmapMatrixCell } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface SemesterHeatmapProps {
  data: HeatmapResponse | undefined;
  loading?: boolean;
}

export function SemesterHeatmap({ data, loading }: SemesterHeatmapProps) {
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-[260px] w-full skeleton rounded" />
      </div>
    );
  }

  if (!data.series.length) {
    return (
      <p className="text-sm text-[color:var(--color-ink-500)]">Veri yok.</p>
    );
  }

  // Tüm hücrelerin max ECTS'ini bul (renk yoğunluğu için, üni başına ayrı)
  return (
    <div
      className={`grid gap-6 ${
        data.series.length === 1
          ? "grid-cols-1"
          : data.series.length === 2
          ? "grid-cols-1 lg:grid-cols-2"
          : "grid-cols-1 lg:grid-cols-3"
      }`}
    >
      {data.series.map((series, idx) => (
        <SingleHeatmap
          key={series.slug}
          series={series}
          categories={data.categories}
          semesters={data.semesters}
          slotIndex={idx}
        />
      ))}
    </div>
  );
}

function cellAlpha(ects: number, max: number): number {
  if (ects <= 0) return 0;
  if (max <= 0) return 0;
  // 0 → 0, max → 1 lineer, AMA min görünürlük 0.15
  const ratio = Math.min(ects / max, 1);
  return 0.15 + ratio * 0.85;
}

function SingleHeatmap({
  series,
  categories,
  semesters,
  slotIndex,
}: {
  series: HeatmapResponse["series"][0];
  categories: HeatmapResponse["categories"];
  semesters: number[];
  slotIndex: number;
}) {
  const baseColor = uniColor(slotIndex);

  // Her dönem için bu üniversitenin max ECTS'i (renk normalize için)
  let maxEcts = 0;
  for (const cat of categories) {
    const sems = series.matrix[cat.key];
    if (!sems) continue;
    for (const cell of Object.values(sems)) {
      const total = (cell.zorunlu || 0) + (cell.secmeli || 0);
      if (total > maxEcts) maxEcts = total;
    }
  }

  const patternId = `pat-secmeli-${series.slug}`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="w-2.5 h-2.5 rounded-full inline-block"
          style={{ background: baseColor }}
        />
        <h3 className="font-serif text-lg leading-none">{series.name}</h3>
      </div>

      <div className="overflow-x-auto relative">
        <table
          className="border-separate"
          style={{ borderSpacing: 2 }}
          role="grid"
        >
          <thead>
            <tr>
              <th className="ui-label text-left pr-3 pb-1" />
              {semesters.map((s, i) => (
                <th
                  key={s}
                  className="ui-label text-center w-9 pb-1"
                  scope="col"
                  style={
                    /* Yıl ayırıcı: her 2 dönemde bir 16px gap */
                    i > 0 && i % 2 === 0
                      ? { paddingLeft: "14px" }
                      : undefined
                  }
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const sems = series.matrix[cat.key];
              return (
                <tr key={cat.key}>
                  <th
                    scope="row"
                    className="text-right pr-3 text-xs text-[color:var(--color-ink-700)] whitespace-nowrap"
                  >
                    {cat.label.split(" / ")[0]}
                  </th>
                  {semesters.map((sem, i) => {
                    const cell: HeatmapMatrixCell = sems?.[sem.toString()] || {
                      zorunlu: 0,
                      secmeli: 0,
                    };
                    return (
                      <Cell
                        key={sem}
                        cell={cell}
                        baseColor={baseColor}
                        maxEcts={maxEcts}
                        patternId={patternId}
                        category={cat.label}
                        semester={sem}
                        yearGap={i > 0 && i % 2 === 0}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* SVG pattern (zorunlu solid, seçmeli çizgili) — bir kere tanımla */}
        <svg width="0" height="0" className="absolute">
          <defs>
            <pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill={baseColor} fillOpacity="0.15" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke={baseColor}
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-ink-500)]">
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ background: baseColor, opacity: 0.6 }}
          />
          Zorunlu
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm"
            style={{
              background: `repeating-linear-gradient(45deg, ${baseColor}55, ${baseColor}55 2px, transparent 2px, transparent 4px)`,
              border: `1px solid ${baseColor}55`,
            }}
          />
          Seçmeli
        </span>
      </div>
    </div>
  );
}

function Cell({
  cell,
  baseColor,
  maxEcts,
  patternId,
  category,
  semester,
  yearGap,
}: {
  cell: HeatmapMatrixCell;
  baseColor: string;
  maxEcts: number;
  patternId: string;
  category: string;
  semester: number;
  yearGap?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const total = cell.zorunlu + cell.secmeli;
  const tdStyle = yearGap ? { paddingLeft: "14px" } : undefined;

  if (total === 0) {
    return (
      <td
        className="w-9 h-9 p-0"
        style={tdStyle}
        aria-label={`${category}, ${semester}. dönem: yok`}
      >
        <div
          className="w-9 h-9 rounded-sm"
          style={{ background: "var(--color-paper-2)" }}
        />
      </td>
    );
  }

  const alpha = cellAlpha(total, maxEcts);

  return (
    <td className="p-0 relative" style={tdStyle}>
      <div
        className="relative w-9 h-9 rounded-sm overflow-hidden cursor-help transition-transform"
        style={{
          background: "var(--color-paper-2)",
          transform: hovered ? "scale(1.06)" : undefined,
          outline: hovered ? "1px solid var(--color-ink-900)" : undefined,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {cell.zorunlu > 0 && (
          <div
            className="absolute inset-0"
            style={{ background: baseColor, opacity: alpha }}
          />
        )}
        {cell.secmeli > 0 && (
          <div
            className="absolute inset-0"
            style={{
              background: `url(#${patternId})`,
              opacity: cell.zorunlu > 0 ? 0.6 : alpha,
            }}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono tabular-nums text-[color:var(--color-ink-900)]">
          {total >= 8 ? total : ""}
        </div>
      </div>

      {hovered && (
        <CellTooltip
          category={category}
          semester={semester}
          zorunlu={cell.zorunlu}
          secmeli={cell.secmeli}
        />
      )}
    </td>
  );
}

/** Custom tooltip — native title yerine. */
function CellTooltip({
  category,
  semester,
  zorunlu,
  secmeli,
}: {
  category: string;
  semester: number;
  zorunlu: number;
  secmeli: number;
}) {
  return (
    <div
      role="tooltip"
      className="absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full z-20 pointer-events-none"
    >
      <div
        className="bg-[color:var(--color-white-paper)] border rounded shadow-paper px-3 py-2 text-xs whitespace-nowrap"
        style={{ borderColor: "var(--color-line)" }}
      >
        <div className="font-serif italic mb-1">
          {semester}. dönem · {category}
        </div>
        <div className="space-y-0.5 font-mono tabular-nums">
          {zorunlu > 0 && <div>{zorunlu} AKTS zorunlu</div>}
          {secmeli > 0 && (
            <div className="text-[color:var(--color-ink-500)]">
              {secmeli} AKTS seçmeli
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
