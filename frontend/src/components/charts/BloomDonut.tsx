"use client";

/**
 * BloomDonut — Dashboard Bileşen 2.3.
 *
 * Her üniversite için ayrı donut + alt liste.
 *   - 6 segment, ink ton gradient
 *   - Dominant segment biraz dışa taşar
 *   - Ortada serif rakam + level adı
 *   - Altında betimleyici cümle (üni'ler arasında dominant kıyas)
 */

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { BloomLevel, BloomResponse, BloomSeries } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

const LEVEL_LABELS: Record<BloomLevel, string> = {
  remember: "Hatırla",
  understand: "Anla",
  apply: "Uygula",
  analyze: "Analiz et",
  evaluate: "Değerlendir",
  create: "Yarat",
};

// Donut'ta segment renkleri — ink ton koyudan açığa
const SEGMENT_COLORS = [
  "rgba(15,14,13,0.92)",
  "rgba(15,14,13,0.78)",
  "rgba(15,14,13,0.62)",
  "rgba(15,14,13,0.46)",
  "rgba(15,14,13,0.30)",
  "rgba(15,14,13,0.16)",
];

export interface BloomDonutProps {
  data: BloomResponse | undefined;
  loading?: boolean;
}

export function BloomDonut({ data, loading }: BloomDonutProps) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-[280px] skeleton rounded" />
        <div className="h-[280px] skeleton rounded" />
      </div>
    );
  }

  if (!data.series.length) {
    return <p className="text-sm text-[color:var(--color-ink-500)]">Bloom verisi yok.</p>;
  }

  return (
    <div className="space-y-6">
      <div
        className="grid gap-8"
        style={{ gridTemplateColumns: `repeat(${data.series.length}, minmax(0, 1fr))` }}
      >
        {data.series.map((s, idx) => (
          <BloomSingle key={s.slug} series={s} levels={data.levels} slotIndex={idx} />
        ))}
      </div>

      <BloomCommentary series={data.series} />
    </div>
  );
}

function BloomSingle({
  series,
  levels,
  slotIndex,
}: {
  series: BloomSeries;
  levels: BloomLevel[];
  slotIndex: number;
}) {
  const accent = uniColor(slotIndex);
  const chartData = levels.map((lvl) => ({
    name: LEVEL_LABELS[lvl],
    key: lvl,
    value: series.distribution[lvl] ?? 0,
  }));

  const dominantIndex = levels.indexOf(series.dominant);
  const dominantPct = Math.round((series.distribution[series.dominant] ?? 0) * 100);

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2 mb-2">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="font-serif text-base font-medium leading-tight">
          {series.name}
        </h3>
      </div>

      <div className="relative w-full max-w-[240px] aspect-square">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              startAngle={90}
              endAngle={-270}
              animationDuration={600}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.key}
                  fill={SEGMENT_COLORS[i] || "rgba(15,14,13,0.5)"}
                  stroke={i === dominantIndex ? accent : "var(--color-white-paper)"}
                  strokeWidth={i === dominantIndex ? 2 : 1}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="font-serif text-3xl font-medium leading-none tabular-nums">
            %{dominantPct}
          </div>
          <div className="font-mono text-[10px] mt-1 uppercase tracking-wider text-[color:var(--color-ink-500)]">
            {LEVEL_LABELS[series.dominant]}
          </div>
        </div>
      </div>

      {/* Liste — her satırda yüzdeyi temsil eden nokta sayısı (max 10) */}
      <ul className="mt-4 w-full max-w-[260px] space-y-1.5">
        {levels.map((lvl, i) => {
          const pct = Math.round((series.distribution[lvl] ?? 0) * 100);
          const isDominant = lvl === series.dominant;
          const dotCount = Math.max(0, Math.min(10, Math.round(pct / 10)));
          const segColor = SEGMENT_COLORS[i] || "rgba(15,14,13,0.5)";
          return (
            <li
              key={lvl}
              className="grid grid-cols-[68px_1fr_36px] items-center gap-2 text-xs"
              aria-current={isDominant}
            >
              <span
                className={
                  isDominant
                    ? "font-medium text-[color:var(--color-ink-900)]"
                    : "text-[color:var(--color-ink-700)]"
                }
              >
                {LEVEL_LABELS[lvl]}
              </span>
              <span
                className="flex items-center gap-[2px]"
                aria-hidden
                title={`${pct}%`}
              >
                {Array.from({ length: 10 }).map((_, di) => (
                  <span
                    key={di}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: di < dotCount ? segColor : "var(--color-paper-3)",
                    }}
                  />
                ))}
              </span>
              <span className="font-mono tabular-nums text-[color:var(--color-ink-500)] text-right">
                %{pct}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-ink-300)]">
        {series.based_on_courses} ders
      </p>
    </div>
  );
}

function BloomCommentary({ series }: { series: BloomSeries[] }) {
  if (series.length < 2) return null;
  const a = series[0];
  const b = series[1];

  const aPct = Math.round((a.distribution[a.dominant] ?? 0) * 100);
  const bPct = Math.round((b.distribution[b.dominant] ?? 0) * 100);

  let cmt: string;
  if (a.dominant === b.dominant) {
    cmt = `İki üniversite de ${LEVEL_LABELS[a.dominant].toLowerCase()} seviyesinde yoğunlaşıyor; ${a.name.split(" ")[0]} %${aPct}, ${b.name.split(" ")[0]} %${bPct}.`;
  } else {
    cmt = `${a.name.split(" ")[0]} ${LEVEL_LABELS[a.dominant].toLowerCase()} seviyesine ağırlık veriyor (%${aPct}); ${b.name.split(" ")[0]} ise ${LEVEL_LABELS[b.dominant].toLowerCase()} (%${bPct}) etrafında yoğunlaşıyor.`;
  }

  return (
    <p className="text-sm italic font-serif text-[color:var(--color-ink-500)] text-center max-w-2xl mx-auto">
      {cmt}
    </p>
  );
}
