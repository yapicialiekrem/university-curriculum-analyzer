"use client";

/**
 * ResourcesDonut — Dashboard Bileşen 2.6.
 *
 * Üniversite başına ders kaynaklarının İngilizce oranı (donut).
 * Veri kaynağı: _summary.english_resources_ratio (0-1).
 */

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { UniversitySummary } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface ResourcesDonutProps {
  summaries: Array<{ slug: string; data: UniversitySummary | undefined }>;
  loading?: boolean;
}

export function ResourcesDonut({ summaries, loading }: ResourcesDonutProps) {
  if (loading) {
    return <div className="h-[240px] skeleton rounded" />;
  }

  const ready = summaries.filter((s) => s.data);
  if (!ready.length) {
    return <p className="text-sm text-[color:var(--color-ink-500)]">Veri yok.</p>;
  }

  return (
    <div className="space-y-4">
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: `repeat(${ready.length}, minmax(0, 1fr))` }}
      >
        {ready.map((s, idx) => (
          <SingleDonut key={s.slug} data={s.data!} slotIndex={idx} />
        ))}
      </div>
      <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] text-center max-w-2xl mx-auto pt-3 border-t" style={{ borderColor: "var(--color-line)" }}>
        Program dili İngilizce olsa da derslerin kullandığı kaynakların dili
        değişkenlik gösterebilir; yukarıdaki oran ders bazlı kaynaklardan
        türetilmiştir.
      </p>
    </div>
  );
}

function SingleDonut({
  data,
  slotIndex,
}: {
  data: UniversitySummary;
  slotIndex: number;
}) {
  const accent = uniColor(slotIndex);
  const pct = Math.round(data.english_resources_ratio * 100);
  const chartData = [
    { name: "İngilizce", value: pct, fill: accent },
    { name: "Türkçe / diğer", value: 100 - pct, fill: "var(--color-paper-3)" },
  ];

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: accent }} />
        <h3 className="font-serif text-base font-medium leading-tight">{data.name}</h3>
      </div>

      <div className="relative w-full max-w-[180px]">
        <ResponsiveContainer width="100%" aspect={1}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={1}
              startAngle={90}
              endAngle={-270}
              animationDuration={500}
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.fill} stroke="var(--color-white-paper)" strokeWidth={1} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="font-serif text-2xl font-medium leading-none tabular-nums">%{pct}</div>
          <div className="font-mono text-[10px] mt-1 uppercase tracking-wider text-[color:var(--color-ink-500)]">
            İngilizce
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-xs text-[color:var(--color-ink-700)]">
        Program: <span className="font-medium">{data.language || "—"}</span>
      </div>
    </div>
  );
}
