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
    return <RadarLoadingShimmer />;
  }

  if (!data.series.length) {
    return (
      <div className="aspect-square w-full max-w-[480px] mx-auto flex items-center justify-center text-[color:var(--color-ink-500)] text-sm font-mono">
        Veri yok
      </div>
    );
  }

  return (
    <div className="w-full max-w-[440px] mx-auto" data-testid="category-radar">
      <ResponsiveContainer width="100%" aspect={1}>
        <RadarChart
          data={chartData}
          outerRadius="78%"
          margin={{ top: 18, right: 56, bottom: 18, left: 56 }}
        >
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

          {/* İç hafif halkalar (25/50/75) */}
          <PolarGrid
            stroke="rgba(15,14,13,0.10)"
            strokeWidth={1}
            radialLines={false}
            polarRadius={[25, 50, 75]}
            gridType="polygon"
          />
          {/* Dış belirgin çevre çokgeni (100) — referans çerçevesi */}
          <PolarGrid
            stroke="rgba(15,14,13,0.32)"
            strokeWidth={1.25}
            radialLines={true}
            polarRadius={[100]}
            gridType="polygon"
          />
          <PolarAngleAxis
            dataKey="axis"
            tick={{
              fill: "var(--color-ink-700)",
              fontSize: 11,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
            tickSize={10}
            tickFormatter={shortenAxisLabel}
          />
          <Tooltip content={<RadarTooltip data={data} />} />

          {data.series.map((s, idx) => (
            <Radar
              key={s.slug}
              name={s.name}
              dataKey={s.slug}
              stroke={uniColor(idx)}
              strokeWidth={2.25}
              strokeDasharray={idx === 1 ? "4 2" : undefined}
              fill={`url(#pat-${["a", "b", "c"][idx]})`}
              fillOpacity={0.6}
              dot={{
                r: 5,
                fill: uniColor(idx),
                stroke: "var(--color-white-paper)",
                strokeWidth: 2,
              }}
              activeDot={{
                r: 7,
                fill: uniColor(idx),
                stroke: "var(--color-white-paper)",
                strokeWidth: 2.5,
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

/**
 * Uzun eksen etiketlerini kısalt — radar kenarlarına sığsın diye.
 * "/" varsa ilk parçayı, "Mühendisliği" varsa "Müh." kısaltmasını kullanır.
 */
function shortenAxisLabel(value: string): string {
  if (!value || value.length < 14) return value;
  if (value.includes("/")) {
    const first = value.split("/")[0].trim();
    if (first.length >= 4) return first.replace("Mühendisliği", "Müh.");
  }
  return value.replace("Mühendisliği", "Müh.");
}

/**
 * Eksenleri tek tek "çizen" yükleme animasyonu — FRONTEND_PROMPT.md
 * "loading state" bölümünde bahsi geçen bespoke pattern. Spinner kullanmıyoruz.
 */
function RadarLoadingShimmer() {
  const axes = 10;
  const center = 50;
  const radius = 38;
  return (
    <div
      className="aspect-square w-full max-w-[480px] mx-auto relative"
      role="status"
      aria-busy="true"
      aria-label="Radar yükleniyor"
    >
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {[0.25, 0.5, 0.75].map((r) => (
          <circle
            key={r}
            cx={center}
            cy={center}
            r={radius * r}
            fill="none"
            stroke="rgba(15,14,13,0.06)"
            strokeWidth="0.4"
          />
        ))}
        {Array.from({ length: axes }).map((_, i) => {
          const angle = (i / axes) * Math.PI * 2 - Math.PI / 2;
          const x2 = center + Math.cos(angle) * radius;
          const y2 = center + Math.sin(angle) * radius;
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={x2}
              y2={y2}
              stroke="rgba(15,14,13,0.20)"
              strokeWidth="0.5"
              strokeDasharray={radius}
              strokeDashoffset={radius}
              style={{
                animation: `radar-axis-draw 800ms ${i * 80}ms ease-out forwards`,
              }}
            />
          );
        })}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(15,14,13,0.10)"
          strokeWidth="0.4"
          strokeDasharray={radius * Math.PI * 2}
          strokeDashoffset={radius * Math.PI * 2}
          style={{
            animation: `radar-circle-draw 1200ms 800ms ease-out forwards`,
          }}
        />
      </svg>
      <style jsx>{`
        @keyframes radar-axis-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes radar-circle-draw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
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
