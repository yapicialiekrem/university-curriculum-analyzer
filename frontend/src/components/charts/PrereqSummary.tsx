"use client";

/**
 * PrereqSummary — Dashboard Bileşen 3.2 (basit sürüm).
 *
 * DASHBOARD_PROMPT.md ReactFlow ile tam graf önerir; bu PR'da
 * istatistiksel özet + örnek zincir listesi (DOT/ReactFlow ileride).
 *
 * Gösterilen:
 *   - Her üni için: toplam ders, önkoşullu ders, ortalama derinlik
 *   - Yan yana yatay bar
 *   - Örnek 5 zincir (course → prereq)
 */

import type { PrerequisitesResponse, PrereqEdge } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface PrereqSummaryProps {
  data: PrerequisitesResponse | undefined;
  loading?: boolean;
}

export function PrereqSummary({ data, loading }: PrereqSummaryProps) {
  if (loading || !data) {
    return <div className="h-[260px] skeleton rounded" />;
  }

  return (
    <div className="space-y-6">
      {/* İstatistik karşılaştırması */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatBlock stats={data.university1} slotIndex={0} />
        <StatBlock stats={data.university2} slotIndex={1} />
      </div>

      <div className="border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
        <h4 className="ui-label mb-3">Örnek Zincirler</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EdgeList edges={data.university1.edges?.slice(0, 6) || []} slotIndex={0} />
          <EdgeList edges={data.university2.edges?.slice(0, 6) || []} slotIndex={1} />
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  stats,
  slotIndex,
}: {
  stats: PrerequisitesResponse["university1"];
  slotIndex: number;
}) {
  const ratio = stats.course_count
    ? Math.round((stats.with_prereqs / stats.course_count) * 100)
    : 0;
  const accent = uniColor(slotIndex);

  return (
    <div
      className="p-4 rounded border bg-[color:var(--color-white-paper)]"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: accent }} />
        <h3 className="font-serif text-base font-medium leading-tight">{stats.name}</h3>
      </div>

      <dl className="space-y-2">
        <Stat label="Toplam ders" value={stats.course_count} />
        <Stat
          label="Önkoşullu ders"
          value={
            <>
              {stats.with_prereqs}{" "}
              <span className="font-mono text-xs text-[color:var(--color-ink-500)]">
                (%{ratio})
              </span>
            </>
          }
        />
        {stats.avg_depth != null && (
          <Stat label="Ortalama derinlik" value={stats.avg_depth.toFixed(1)} />
        )}
        {stats.max_depth != null && (
          <Stat label="Maks. derinlik" value={stats.max_depth} />
        )}
      </dl>

      {/* Bar — önkoşul oranı */}
      <div className="mt-4">
        <div className="ui-label mb-1">Önkoşul oranı</div>
        <div className="h-1.5 w-full rounded-full overflow-hidden bg-[color:var(--color-paper-2)]">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${ratio}%`, background: accent }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <dt className="text-[color:var(--color-ink-500)]">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function EdgeList({
  edges,
  slotIndex,
}: {
  edges: PrereqEdge[];
  slotIndex: number;
}) {
  if (!edges.length) {
    return (
      <p className="text-xs italic text-[color:var(--color-ink-500)]">
        — örnek zincir yok
      </p>
    );
  }
  const accent = uniColor(slotIndex);
  return (
    <ul className="space-y-1.5">
      {edges.map((e, i) => (
        <li key={i} className="flex items-center gap-2 text-xs font-mono">
          <code style={{ color: accent }}>{e.course}</code>
          <span className="text-[color:var(--color-ink-300)]">←</span>
          <code className="text-[color:var(--color-ink-700)]">{e.prerequisite}</code>
        </li>
      ))}
    </ul>
  );
}
