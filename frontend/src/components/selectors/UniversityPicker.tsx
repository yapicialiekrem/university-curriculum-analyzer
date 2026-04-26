"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import type { DepartmentCode, UniversityListItem } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface UniversityPickerProps {
  selectedSlugs: string[];
  department: DepartmentCode;
  onAdd: (slug: string) => void;
  onRemove: (slug: string) => void;
  /**
   * Slot bazlı replace — chip X butonu 2 üniversite varken (silinemez state)
   * için kullanılır.
   */
  onReplace: (slot: "a" | "b" | "c", slug: string) => void;
  /**
   * Atomik toplu replace — bölüm değişiminde a/b/c'yi tek seferde günceller
   * (router.replace race-condition'unu önlemek için).
   */
  onSetSelection: (next: Partial<{ a: string; b: string; c: string | null }>) => void;
}

const fetchUnis = (department: DepartmentCode) => api.universities(department);

const SLOT_KEYS: Array<"a" | "b" | "c"> = ["a", "b", "c"];

export function UniversityPicker({
  selectedSlugs,
  department,
  onAdd,
  onRemove,
  onReplace,
  onSetSelection,
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

  // Replace mode — kullanıcı 2 üni varken X tıkladığında o slot için
  // değiştirme dropdown'u aç. null değilse replacing mode aktif.
  const [replacingSlot, setReplacingSlot] = useState<"a" | "b" | "c" | null>(null);

  // Bölüm değişiminde / list yenilendiğinde geçersiz slug'ları otomatik düzelt.
  // Örn: bilmuh'tan ybs'ye geçince metu artık list'te yok → ilk uygun slug ile
  // tek seferde (atomik) replace et.
  useEffect(() => {
    if (!list || list.length === 0) return;
    const valid = new Set(list.map((u) => u.slug));
    const invalidSlots: Array<"a" | "b" | "c"> = [];
    selectedSlugs.forEach((slug, idx) => {
      if (!valid.has(slug)) invalidSlots.push(SLOT_KEYS[idx]);
    });
    if (invalidSlots.length === 0) return;

    const used = new Set(selectedSlugs.filter((s) => valid.has(s)));
    const available = list.filter((u) => !used.has(u.slug));

    const update: Partial<{ a: string; b: string; c: string | null }> = {};
    invalidSlots.forEach((slot, i) => {
      const next = available[i];
      if (next) {
        used.add(next.slug);
        update[slot] = next.slug;
      } else if (slot === "c") {
        // c için yedek yok — kaldır
        update.c = null;
      }
    });
    if (Object.keys(update).length > 0) {
      onSetSelection(update);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, selectedSlugs.join(",")]);

  const handleChipX = useCallback(
    (slug: string) => {
      // Her zaman kaldır — 1 → 0 da dahil. Eskiden 2 üni varken X "replace
      // moduna gir" davranışı vardı, kullanıcı isteği üzerine kaldırıldı.
      onRemove(slug);
    },
    [onRemove]
  );

  const handlePick = useCallback(
    (slug: string) => {
      if (replacingSlot) {
        onReplace(replacingSlot, slug);
        setReplacingSlot(null);
      } else {
        onAdd(slug);
      }
    },
    [replacingSlot, onAdd, onReplace]
  );

  const showAddButton = selectedSlugs.length < 3 || replacingSlot !== null;
  const replacingSlugName = replacingSlot
    ? map.get(selectedSlugs[SLOT_KEYS.indexOf(replacingSlot)] || "")?.name
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Seçili üniversiteler">
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
              dimmed={replacingSlot === SLOT_KEYS[idx]}
              onRemove={() => handleChipX(slug)}
            />
          );
        })}
      </AnimatePresence>
      {showAddButton && list && (
        <AddButton
          list={list.filter((u) => !selectedSlugs.includes(u.slug))}
          onAdd={handlePick}
          replaceLabel={replacingSlugName ? `${replacingSlugName} yerine seç` : null}
          onCancel={() => setReplacingSlot(null)}
          autoOpen={replacingSlot !== null}
        />
      )}
    </div>
  );
}

function Chip({
  slug,
  name,
  department,
  slotIndex,
  dimmed,
  onRemove,
}: {
  slug: string;
  name: string;
  department: string;
  slotIndex: number;
  dimmed?: boolean;
  onRemove: () => void;
}) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: dimmed ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
      className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md border bg-[color:var(--color-paper-2)] text-sm"
      style={{ borderColor: "var(--color-line)" }}
      title={department ? `${name} — ${department}` : slug}
    >
      <span
        aria-hidden
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: uniColor(slotIndex) }}
      />
      <span className="font-medium leading-none">{name}</span>
      <button
        onClick={onRemove}
        className="ml-1 -mr-1 p-1 text-[color:var(--color-ink-300)] hover:text-[color:var(--color-ink-900)] transition-opacity"
        aria-label={`${name} değiştir/kaldır`}
        title={dimmed ? "Yeni üniversite seç…" : `${name} değiştir`}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </motion.span>
  );
}

function AddButton({
  list,
  onAdd,
  replaceLabel,
  onCancel,
  autoOpen,
}: {
  list: UniversityListItem[];
  onAdd: (slug: string) => void;
  replaceLabel?: string | null;
  onCancel?: () => void;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Replace mode'a geçildiğinde dropdown otomatik açılır
  useEffect(() => {
    if (autoOpen && !open) setOpen(true);
  }, [autoOpen, open]);

  useEffect(() => {
    if (open) {
      setQ("");
      // Sonraki tick'te focus
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onCancel?.();
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onCancel]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return list.slice(0, 50);
    return list
      .filter((u) => u.name.toLowerCase().includes(ql) || u.slug.includes(ql))
      .slice(0, 50);
  }, [q, list]);

  const isReplace = !!replaceLabel;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          if (open && isReplace) {
            // Cancel replace
            onCancel?.();
          }
          setOpen(!open);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-dashed text-sm text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] hover:border-[color:var(--color-ink-500)] transition-colors"
        style={{
          borderColor: isReplace
            ? "var(--color-uni-b)"
            : "var(--color-line-strong)",
          color: isReplace ? "var(--color-uni-b)" : undefined,
        }}
      >
        <Plus size={14} strokeWidth={1.5} />
        {isReplace ? replaceLabel : "Üniversite ekle"}
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
