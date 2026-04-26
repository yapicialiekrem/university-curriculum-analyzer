"use client";

/**
 * StaffBars — Dashboard Bileşen 2.5: Akademik Kadro.
 *
 * Her unvan için satır + her üniversitenin sayısı + dolaylı bar görseli.
 * Toplam ve doktora oranı yerine, en yüksek değer üzerinden normalize edilmiş
 * bar gösterimi (okuyucu hangi unvanda hangi üni'nin daha kalabalık olduğunu
 * tek bakışta görsün).
 */

import type { StaffCounts, StaffComparison } from "@/lib/types";
import { uniColor, uniShortName } from "@/lib/use-selection";

const TITLES: Array<{ key: keyof StaffCounts; label: string }> = [
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

/**
 * Backend hem nested (university1.staff) hem flat (university1.professor)
 * dönebiliyor. Tek bir StaffCounts objesine indirgeyen yardımcı.
 */
function readCounts(side: StaffComparison["university1"] | undefined): StaffCounts {
  if (!side) {
    return {
      department: "",
      professor: 0,
      associate_professor: 0,
      assistant_professor: 0,
      lecturer: 0,
      research_assistant: 0,
      total: 0,
    };
  }
  if (side.staff) return side.staff;
  return {
    department: side.department || "",
    professor: side.professor ?? 0,
    associate_professor: side.associate_professor ?? 0,
    assistant_professor: side.assistant_professor ?? 0,
    lecturer: side.lecturer ?? 0,
    research_assistant: side.research_assistant ?? 0,
    total: side.total ?? 0,
  };
}

export function StaffBars({ data, loading }: StaffBarsProps) {
  if (loading || !data) {
    return <div className="h-[300px] skeleton rounded" />;
  }

  const u1 = readCounts(data.university1);
  const u2 = readCounts(data.university2);

  if (u1.total === 0 && u2.total === 0) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Bu iki üniversite için akademik kadro verisi yüklü değil.
      </p>
    );
  }

  const u1Name = data.university1?.name || "";
  const u2Name = data.university2?.name || "";
  const u1Short = uniShortName("", u1Name);
  const u2Short = uniShortName("", u2Name);

  // Bar normalizasyonu — her unvanda en yüksek değer 100% olur.
  const max = Math.max(
    1,
    ...TITLES.map(({ key }) =>
      Math.max((u1[key] as number) || 0, (u2[key] as number) || 0)
    )
  );

  return (
    <div className="space-y-4">
      {/* Header — sadece üni isimleri ve toplam */}
      <div
        className="grid grid-cols-[1fr_auto_auto] gap-6 items-baseline pb-3 border-b"
        style={{ borderColor: "var(--color-line)" }}
      >
        <span className="ui-label">Unvan</span>
        <UniHeader name={u1Short} idx={0} total={u1.total} />
        <UniHeader name={u2Short} idx={1} total={u2.total} />
      </div>

      {/* Rows */}
      <ul className="space-y-3.5">
        {TITLES.map(({ key, label }) => {
          const v1 = (u1[key] as number) || 0;
          const v2 = (u2[key] as number) || 0;
          if (v1 === 0 && v2 === 0) return null;
          return (
            <li key={key}>
              <div className="grid grid-cols-[1fr_auto_auto] gap-6 items-center">
                <span className="text-sm text-[color:var(--color-ink-700)]">
                  {label}
                </span>
                <CountBar value={v1} max={max} color={uniColor(0)} />
                <CountBar value={v2} max={max} color={uniColor(1)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UniHeader({ name, idx, total }: { name: string; idx: number; total: number }) {
  return (
    <div className="text-right min-w-[88px]">
      <div className="flex items-center gap-1.5 justify-end">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full"
          style={{ background: uniColor(idx) }}
        />
        <span className="text-sm font-medium leading-none">{name}</span>
      </div>
      <span className="font-mono text-[11px] text-[color:var(--color-ink-500)] tabular-nums mt-1 block">
        Toplam {total}
      </span>
    </div>
  );
}

/**
 * Bar + sayı — sayı sağda büyük gözüksün, bar arka planda dolaylı görsel.
 */
function CountBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className="relative w-[88px] h-7 rounded overflow-hidden"
      style={{ background: "var(--color-paper-2)" }}
      aria-label={`${value} kişi`}
    >
      {value > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: color,
            opacity: 0.18,
          }}
        />
      )}
      <span
        className="absolute inset-0 flex items-center justify-end pr-2.5 font-mono text-sm tabular-nums font-medium"
        style={{ color: value > 0 ? color : "var(--color-ink-300)" }}
      >
        {value}
      </span>
    </div>
  );
}
