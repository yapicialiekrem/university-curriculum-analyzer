"use client";

import clsx from "clsx";
import type { DepartmentCode } from "@/lib/types";

const TABS: Array<{ key: DepartmentCode; label: string }> = [
  { key: "bilmuh", label: "Bilgisayar Müh." },
  { key: "yazmuh", label: "Yazılım Müh." },
  { key: "ybs", label: "YBS" },
];

export interface DepartmentTabsProps {
  active: DepartmentCode;
  onChange: (dept: DepartmentCode) => void;
}

export function DepartmentTabs({ active, onChange }: DepartmentTabsProps) {
  return (
    <nav role="tablist" aria-label="Bölüm seç" className="flex gap-6 border-b border-[color:var(--color-line)]">
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={clsx(
              "relative pb-2 text-sm font-medium transition-colors",
              isActive
                ? "text-[color:var(--color-ink-900)]"
                : "text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-700)]"
            )}
          >
            {t.label}
            {isActive && (
              <span
                aria-hidden
                className="absolute -bottom-px left-0 right-0 h-0.5 bg-[color:var(--color-ink-900)]"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
