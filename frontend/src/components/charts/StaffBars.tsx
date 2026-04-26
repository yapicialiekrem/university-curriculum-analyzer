"use client";

/**
 * StaffBars — Dashboard Bileşen 2.5: Akademik Kadro.
 *
 * Tasarım: her üniversite ayrı bir kart; kart içinde 5 unvan satırı, her
 * satırda büyük sayı + her akademisyen için bir nokta (max 24 nokta, fazlası
 * "+N" overflow). "Her nokta = bir akademisyen" görsel hissi.
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
  /** Tek üni modu: backend same-uni trick döner; sadece u1 panelini göster. */
  singleMode?: boolean;
  /** Slot offset: çoklu StaffBars yan yana ise renk (uni-a/b/c) sürdür. */
  slotOffset?: number;
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

export function StaffBars({ data, loading, singleMode, slotOffset = 0 }: StaffBarsProps) {
  if (loading || !data) {
    return <div className="h-[300px] skeleton rounded" />;
  }

  const u1 = readCounts(data.university1);
  const u2 = readCounts(data.university2);

  if (u1.total === 0 && (singleMode || u2.total === 0)) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Akademik kadro verisi yüklü değil.
      </p>
    );
  }

  const u1Name = data.university1?.name || "";
  const u1Short = uniShortName("", u1Name);

  if (singleMode) {
    return (
      <div className="grid gap-6 grid-cols-1 max-w-[480px]">
        <StaffCard counts={u1} name={u1Short} idx={slotOffset} />
      </div>
    );
  }

  const u2Name = data.university2?.name || "";
  const u2Short = uniShortName("", u2Name);

  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
      <StaffCard counts={u1} name={u1Short} idx={slotOffset} />
      <StaffCard counts={u2} name={u2Short} idx={slotOffset + 1} />
    </div>
  );
}

/**
 * StaffCard — bir üniversitenin akademik kadrosunu kart halinde gösterir.
 * Üstte ad + toplam; altta 5 unvan satırı, her unvan için sayı + nokta-cluster.
 */
function StaffCard({
  counts,
  name,
  idx,
}: {
  counts: StaffCounts;
  name: string;
  idx: number;
}) {
  const accent = uniColor(idx);
  return (
    <article
      className="rounded-lg border p-4 lg:p-5"
      style={{ borderColor: "var(--color-line)", background: "var(--color-white-paper)" }}
    >
      <header
        className="flex items-baseline justify-between pb-3 mb-3 border-b"
        style={{ borderColor: "var(--color-line)" }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: accent }}
          />
          <h3 className="font-serif text-base font-medium leading-none">{name}</h3>
        </div>
        <div className="text-right">
          <div className="font-serif text-2xl tabular-nums leading-none">
            {counts.total}
          </div>
          <div className="ui-label text-[9px] mt-0.5">Toplam</div>
        </div>
      </header>

      <ul className="space-y-3">
        {TITLES.map(({ key, label }) => {
          const v = (counts[key] as number) || 0;
          return (
            <li
              key={key}
              className={`grid grid-cols-[7rem_2.5rem_1fr] gap-3 items-center ${
                v === 0 ? "opacity-40" : ""
              }`}
            >
              <span className="text-xs text-[color:var(--color-ink-700)]">
                {label}
              </span>
              <span
                className="font-serif text-base tabular-nums text-right"
                style={{ color: v > 0 ? accent : "var(--color-ink-500)" }}
              >
                {v > 0 ? v : "—"}
              </span>
              <DotCluster count={v} accent={accent} />
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/** "Her nokta bir akademisyen" — max 24 nokta; fazlası "+N" overflow. */
function DotCluster({ count, accent }: { count: number; accent: string }) {
  const MAX = 24;
  const shown = Math.min(count, MAX);
  const overflow = Math.max(0, count - MAX);
  if (count === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-[3px]" aria-hidden>
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full block flex-shrink-0"
          style={{ background: accent }}
        />
      ))}
      {overflow > 0 && (
        <span className="ml-1 font-mono text-[9px] text-[color:var(--color-ink-500)] tabular-nums">
          +{overflow}
        </span>
      )}
    </div>
  );
}
