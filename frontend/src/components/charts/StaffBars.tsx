"use client";

/**
 * StaffBars — Dashboard Bileşen 2.5.
 *
 * FRONTEND_PROMPT.md "family tree" / dot-cluster yaklaşımı.
 * Yatay bar yerine her unvan için "● ● ● ..." gruplaması.
 */

import type { StaffComparison } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

const TITLES: Array<{ key: keyof StaffComparison["university1"]; label: string }> = [
  { key: "professor", label: "Profesör Dr." },
  { key: "associate_professor", label: "Doçent Dr." },
  { key: "assistant_professor", label: "Dr. Öğr. Üyesi" },
  { key: "lecturer", label: "Öğr. Gör." },
  { key: "research_assistant", label: "Araş. Gör." },
];

export interface StaffBarsProps {
  data: StaffComparison | undefined;
  loading?: boolean;
}

export function StaffBars({ data, loading }: StaffBarsProps) {
  if (loading || !data) {
    return <div className="h-[260px] skeleton rounded" />;
  }

  // Tek üniversite olabilir — Comparison şeması iki ünili
  const u1 = data.university1;
  const u2 = data.university2;

  // Doctorate ratio (Prof + Doç + Dr.Öğr.Üyesi) / total
  const docCount = (u: typeof u1) =>
    u.professor + u.associate_professor + u.assistant_professor;
  const u1Doc = u1.total ? Math.round((docCount(u1) / u1.total) * 100) : 0;
  const u2Doc = u2.total ? Math.round((docCount(u2) / u2.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 items-baseline pb-2 border-b" style={{ borderColor: "var(--color-line)" }}>
        <span className="ui-label">Unvan</span>
        <Header name={u1.name} idx={0} count={u1.total} />
        <Header name={u2.name} idx={1} count={u2.total} />
      </div>

      {/* Rows */}
      <ul className="space-y-3">
        {TITLES.map(({ key, label }) => {
          const aCount = (u1[key] as number) || 0;
          const bCount = (u2[key] as number) || 0;
          if (aCount === 0 && bCount === 0) return null;
          return (
            <li
              key={key}
              className="grid grid-cols-[1fr_auto_auto] gap-4 items-center"
            >
              <span className="text-sm">{label}</span>
              <Dots count={aCount} color={uniColor(0)} />
              <Dots count={bCount} color={uniColor(1)} />
            </li>
          );
        })}
      </ul>

      {/* Açıklayıcı not */}
      <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] mt-3 pt-3 border-t" style={{ borderColor: "var(--color-line)" }}>
        Doktoralı oranı: {u1.name.split(" ")[0]} %{u1Doc}, {u2.name.split(" ")[0]} %{u2Doc}.
      </p>
    </div>
  );
}

function Header({ name, idx, count }: { name: string; idx: number; count: number }) {
  return (
    <div className="text-right">
      <div className="flex items-center gap-1.5 justify-end">
        <span className="w-2 h-2 rounded-full" style={{ background: uniColor(idx) }} />
        <span className="text-sm font-medium leading-none">{name.split(" ").slice(0, 2).join(" ")}</span>
      </div>
      <span className="font-mono text-xs text-[color:var(--color-ink-500)] tabular-nums mt-0.5 block">
        Toplam {count}
      </span>
    </div>
  );
}

function Dots({ count, color }: { count: number; color: string }) {
  // Her nokta = 1 akademisyen. Çok fazlaysa 30+ → +N etiketi
  const MAX_DOTS = 30;
  const display = Math.min(count, MAX_DOTS);
  const overflow = count - MAX_DOTS;

  return (
    <span className="flex items-center gap-2 justify-end" aria-label={`${count} kişi`}>
      <span className="flex flex-wrap gap-[3px] max-w-[160px] justify-end">
        {Array.from({ length: display }, (_, i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ background: color }}
          />
        ))}
        {overflow > 0 && (
          <span className="font-mono text-[10px] ml-1 text-[color:var(--color-ink-500)]">
            +{overflow}
          </span>
        )}
      </span>
      <span className="font-mono text-xs text-[color:var(--color-ink-500)] tabular-nums w-6 text-right">
        {count}
      </span>
    </span>
  );
}
