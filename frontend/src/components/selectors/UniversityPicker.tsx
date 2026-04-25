"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import type { DepartmentCode, UniversityListItem } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface UniversityPickerProps {
  selectedSlugs: string[];
  department: DepartmentCode;
  onAdd: (slug: string) => void;
  onRemove: (slug: string) => void;
}

const fetchUnis = (department: DepartmentCode) => api.universities(department);

export function UniversityPicker({
  selectedSlugs,
  department,
  onAdd,
  onRemove,
}: UniversityPickerProps) {
  const { data: list } = useSWR<UniversityListItem[]>(
    ["universities", department],
    () => fetchUnis(department),
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  // Slug → ad map
  const map = useMemo(() => {
    const m = new Map<string, UniversityListItem>();
    list?.forEach((u) => m.set(u.slug, u));
    return m;
  }, [list]);

  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Seçili üniversiteler">
      <AnimatePresence mode="popLayout" initial={false}>
        {selectedSlugs.map((slug, idx) => {
          const u = map.get(slug);
          return (
            <Chip
              key={slug}
              slug={slug}
              name={u?.name || slug}
              department={u?.department || ""}
              slotIndex={idx}
              removable={selectedSlugs.length > 2 || idx === 2}
              onRemove={() => onRemove(slug)}
            />
          );
        })}
      </AnimatePresence>
      {selectedSlugs.length < 3 && list && (
        <AddButton list={list.filter((u) => !selectedSlugs.includes(u.slug))} onAdd={onAdd} />
      )}
    </div>
  );
}

function Chip({
  slug,
  name,
  department,
  slotIndex,
  removable,
  onRemove,
}: {
  slug: string;
  name: string;
  department: string;
  slotIndex: number;
  removable: boolean;
  onRemove: () => void;
}) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
      className="inline-flex items-center gap-2 px-3 h-10 rounded-md border bg-[color:var(--color-paper-2)] text-sm"
      style={{ borderColor: "var(--color-line)" }}
      title={slug}
    >
      <span
        aria-hidden
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ background: uniColor(slotIndex) }}
      />
      <span className="font-medium leading-none">{name}</span>
      {department && (
        <span className="font-mono text-xs text-[color:var(--color-ink-500)] leading-none hidden sm:inline">
          {department.length > 18 ? department.slice(0, 16) + "…" : department}
        </span>
      )}
      {removable && (
        <button
          onClick={onRemove}
          className="ml-1 -mr-1 p-1 text-[color:var(--color-ink-300)] hover:text-[color:var(--color-ink-900)] transition-opacity"
          aria-label={`${name} kaldır`}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
    </motion.span>
  );
}

function AddButton({
  list,
  onAdd,
}: {
  list: UniversityListItem[];
  onAdd: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      // Sonraki tick'te focus
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return list.slice(0, 50);
    return list
      .filter((u) => u.name.toLowerCase().includes(ql) || u.slug.includes(ql))
      .slice(0, 50);
  }, [q, list]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 h-10 rounded-md border border-dashed text-sm text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] hover:border-[color:var(--color-ink-500)] transition-colors"
        style={{ borderColor: "var(--color-line-strong)" }}
      >
        <Plus size={14} strokeWidth={1.5} />
        Üniversite ekle
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 w-[360px] max-w-[calc(100vw-32px)] max-h-[420px] overflow-hidden rounded-md border bg-[color:var(--color-white-paper)] shadow-raised z-50"
            style={{ borderColor: "var(--color-line)" }}
            role="listbox"
          >
            <div
              className="border-b px-3 py-2 flex items-center gap-2"
              style={{ borderColor: "var(--color-line)" }}
            >
              <Search size={14} strokeWidth={1.5} className="text-[color:var(--color-ink-500)]" />
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ara..."
                aria-label="Üniversite ara"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            <ul className="max-h-[360px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-4 py-3 text-sm italic font-serif text-[color:var(--color-ink-500)]">
                  Eşleşen üniversite yok.
                </li>
              ) : (
                filtered.map((u) => (
                  <li key={u.slug} role="option" aria-selected={false}>
                    <button
                      onClick={() => {
                        onAdd(u.slug);
                        setOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-[color:var(--color-paper-3)] transition-colors flex items-baseline justify-between gap-3"
                    >
                      <span className="text-sm font-medium">{u.name}</span>
                      <span className="font-mono text-[10px] text-[color:var(--color-ink-500)] uppercase tracking-wider">
                        {u.department_code}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
