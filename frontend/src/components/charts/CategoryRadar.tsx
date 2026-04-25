"use client";

/**
 * CategoryRadar — Dashboard Bileşen 1.1.
 *
 * Recharts <RadarChart> üstüne editorial polish:
 *  - Etiketler Fraunces italic
 *  - Polygon üstünde nokta marker
 *  - Tooltip kart gibi (paper bg, line border)
 *  - 25/50/75 grid çemberi (default 100 yok)
 *  - Pattern fill (renk körü erişimi için):
 *    A solid, B diagonal, C dotted
 */

import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import type { RadarResponse } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface CategoryRadarProps {
  data: RadarResponse | undefined;
  loading?: boolean;
  highlight_axis?: string | null;     // chat overlay
}

export function CategoryRadar({ data, loading, highlight_axis }: CategoryRadarProps) {
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.axes.map((axis, i) => {
      const row: Record<string, string | number> = {
        axis: axis.label,
        axis_key: axis.key,
      };
      data.series.forEach((s) => {
        row[s.slug] = s.values[i];
      });
      return row;
    });
  }, [data]);

  if (loading || !data) {
    return (
      <div className="aspect-square w-full max-w-[480px] mx-auto skeleton" aria-busy />
    );
  }

  if (!data.series.length) {
    return (
      <div className="aspect-square w-full max-w-[480px] mx-auto flex items-center justify-center text-[color:var(--color-ink-500)] text-sm font-mono">
        Veri yok
      </div>
    );
  }

  return (
    <div className="w-full max-w-[480px] mx-auto" data-testid="category-radar">
      <ResponsiveContainer width="100%" aspect={1}>
        <RadarChart data={chartData} outerRadius="78%">
          <defs>
            {/* Pattern fills (renk körü için) */}
            <pattern id="pat-a" patternUnits="userSpaceOnUse" width="6" height="6">
              <rect width="6" height="6" fill="rgba(15,14,13,0.10)" />
            </pattern>
            <pattern
              id="pat-b"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="rgba(179,48,28,0.06)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(179,48,28,0.35)" strokeWidth="1.5" />
            </pattern>
            <pattern id="pat-c" patternUnits="userSpaceOnUse" width="6" height="6">
              <rect width="6" height="6" fill="rgba(45,106,138,0.06)" />
              <circle cx="3" cy="3" r="0.8" fill="rgba(45,106,138,0.5)" />
            </pattern>
          </defs>

          <PolarGrid
            stroke="rgba(15,14,13,0.08)"
            radialLines={false}
            polarRadius={[25, 50, 75]}
          />
          <PolarAngleAxis
            dataKey="axis"
            tick={{
              fill: "var(--color-ink-700)",
              fontSize: 11,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          />
          <Tooltip content={<RadarTooltip data={data} />} />

          {data.series.map((s, idx) => (
            <Radar
              key={s.slug}
              name={s.name}
              dataKey={s.slug}
              stroke={uniColor(idx)}
              strokeWidth={2}
              strokeDasharray={idx === 1 ? "4 2" : undefined}
              fill={`url(#pat-${["a", "b", "c"][idx]})`}
              fillOpacity={0.6}
              dot={{
                r: 3,
                fill: uniColor(idx),
                stroke: "var(--color-white-paper)",
                strokeWidth: 1.5,
              }}
              isAnimationActive
              animationDuration={600}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>

      {/* Alt açıklama */}
      <p className="mt-4 text-xs italic font-serif text-[color:var(--color-ink-500)] text-center max-w-md mx-auto leading-relaxed">
        Her eksende, o konuya ayrılan toplam AKTS'nin tüm üniversiteler arasındaki
        en yüksek değere oranı (0–100).
      </p>

      {highlight_axis && (
        <div className="mt-2 text-center text-xs font-mono uppercase tracking-wider text-[color:var(--color-uni-b)]">
          ✦ Vurgulu eksen: {highlight_axis}
        </div>
      )}
    </div>
  );
}

function RadarTooltip({
  data,
  active,
  payload,
}: {
  data: RadarResponse;
  active?: boolean;
  payload?: Array<{ payload?: { axis: string; axis_key: string }; dataKey?: string }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const axisIndex = data.axes.findIndex((a) => a.key === row.axis_key);
  return (
    <div
      className="bg-[color:var(--color-white-paper)] border border-[color:var(--color-line)] shadow-paper px-4 py-3 rounded text-sm"
      style={{ minWidth: 180 }}
    >
      <div className="font-serif text-base mb-2">{row.axis}</div>
      <div className="space-y-1">
        {data.series.map((s, idx) => {
          const value = s.values[axisIndex];
          const ects = s.raw_ects[axisIndex];
          return (
            <div key={s.slug} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: uniColor(idx) }}
                />
                <span className="text-[color:var(--color-ink-900)]">{s.name}</span>
              </span>
              <span className="font-mono text-xs text-[color:var(--color-ink-500)]">
                {value} · {ects} AKTS
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
