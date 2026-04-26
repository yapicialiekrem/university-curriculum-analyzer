"use client";

/**
 * SemesterHeatmap — Dashboard Bileşen 2.1.
 *
 * 8 dönem × 10 kategori matris. Her dolu hücre TEK RENK (heatmap değil) —
 * yoğunluk farkı ya da zorunlu/seçmeli görsel ayrımı yok. Hücre üzerine
 * gelindiğinde tooltip'te o hücrenin zorunlu/seçmeli AKTS değerleri yazılır.
 */

import { useState } from "react";

import type { HeatmapResponse, HeatmapMatrixCell } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface SemesterHeatmapProps {
  data: HeatmapResponse | undefined;
  loading?: boolean;
}

// Tüm hücreler için tek tip renk — slate blue (#2d6a8a). Outcomes tablosu
// ile aynı palet → dashboard içinde tutarlılık.
const HEAT_RGB = "45, 106, 138";

// Hücre dolu olduğu sürece sabit alpha — yoğunluk farkı (heatmap) artık yok.
const FILL_ALPHA = 0.55;

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
  // Üniversite ayrımı sadece başlık dot'unda — hücre rengi tek tip
  const accentDotColor = uniColor(slotIndex);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="w-2.5 h-2.5 rounded-full inline-block"
          style={{ background: accentDotColor }}
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
            {categories.map((cat, catIdx) => {
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
                        category={cat.label}
                        semester={sem}
                        yearGap={i > 0 && i % 2 === 0}
                        flipTooltip={catIdx <= 1}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({
  cell,
  category,
  semester,
  yearGap,
  flipTooltip,
}: {
  cell: HeatmapMatrixCell;
  category: string;
  semester: number;
  yearGap?: boolean;
  /** Üst satırlarda tooltip yukarı taşar — aşağıya yansıt. */
  flipTooltip?: boolean;
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

  // Her dolu hücrenin içinde zorunlu (üstte) ve seçmeli (altta) sayıları
  // okunsun — kullanıcı tooltip beklemesin. Sadece o tip 0'dan büyükse satır
  // gözükür; ikisi de varsa iki satır, tek varsa tek satır gösterilir.
  return (
    <td className="p-0 relative" style={tdStyle}>
      <div
        className="relative w-9 h-9 rounded-sm overflow-hidden transition-transform flex flex-col items-center justify-center leading-none"
        style={{
          background: `rgba(${HEAT_RGB}, ${FILL_ALPHA})`,
          transform: hovered ? "scale(1.06)" : undefined,
          outline: hovered ? "1px solid var(--color-ink-900)" : undefined,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`${category}, ${semester}. dönem: ${cell.zorunlu} AKTS zorunlu, ${cell.secmeli} AKTS seçmeli`}
      >
        {cell.zorunlu > 0 && (
          <span className="font-mono tabular-nums text-[11px] font-medium text-[color:var(--color-ink-900)]">
            {cell.zorunlu}
          </span>
        )}
        {cell.secmeli > 0 && (
          <span className="font-mono tabular-nums text-[10px] italic text-[color:var(--color-ink-700)]">
            {cell.zorunlu > 0 ? `+${cell.secmeli}` : cell.secmeli}
          </span>
        )}
      </div>

      {hovered && (
        <CellTooltip
          category={category}
          semester={semester}
          zorunlu={cell.zorunlu}
          secmeli={cell.secmeli}
          flip={flipTooltip}
        />
      )}
    </td>
  );
}

/** Custom tooltip — native title yerine, yarı-saydam paper bg + blur. */
function CellTooltip({
  category,
  semester,
  zorunlu,
  secmeli,
  flip,
}: {
  category: string;
  semester: number;
  zorunlu: number;
  secmeli: number;
  /** true → hücrenin altında göster (üst satırlarda viewport dışına çıkmasın). */
  flip?: boolean;
}) {
  return (
    <div
      role="tooltip"
      className={`absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none ${
        flip ? "top-full mt-2" : "-top-2 -translate-y-full"
      }`}
    >
      <div
        className="rounded shadow-paper px-3 py-2 text-xs whitespace-nowrap"
        style={{
          background: "rgba(252,250,246,0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid var(--color-line)",
        }}
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
