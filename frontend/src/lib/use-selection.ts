"use client";

/**
 * Üniversite seçim state'i — URL query params üzerinden senkron.
 *   ?a=metu&b=ege&c=bilkent&dept=bilmuh
 *
 * Max 3 üniversite. URL = paylaşılabilir state.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import type { DepartmentCode } from "./types";

const VALID_DEPTS: DepartmentCode[] = ["bilmuh", "yazmuh", "ybs"];

const DEFAULT_DEPT: DepartmentCode = "bilmuh";

// Dataset bizde olan üniversiteler arasında demo seçimi
// (DASHBOARD_PROMPT örneklerinde "odtu" + "ieu" geçer ama dataset'imizde
// metu + ekonomi olarak slug'lar var)
const DEFAULT_A = "metu";
const DEFAULT_B = "bilkent";

export interface Selection {
  a: string;
  b: string;
  c: string | null;
  department: DepartmentCode;
  // Yardımcılar
  slugs: string[];          // [a, b] veya [a, b, c]
  isFull: boolean;          // 3 üni seçili mi?
}

export function useSelection() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selection: Selection = useMemo(() => {
    const a = searchParams.get("a") || DEFAULT_A;
    const b = searchParams.get("b") || DEFAULT_B;
    const c = searchParams.get("c");
    const dept = (searchParams.get("dept") as DepartmentCode) || DEFAULT_DEPT;
    const slugs = c ? [a, b, c] : [a, b];
    return {
      a,
      b,
      c,
      department: VALID_DEPTS.includes(dept) ? dept : DEFAULT_DEPT,
      slugs,
      isFull: !!c,
    };
  }, [searchParams]);

  const _push = useCallback(
    (next: Partial<Selection>) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (next.a !== undefined) qs.set("a", next.a);
      if (next.b !== undefined) qs.set("b", next.b);
      if (next.c !== undefined) {
        if (next.c) qs.set("c", next.c);
        else qs.delete("c");
      }
      if (next.department !== undefined) qs.set("dept", next.department);
      router.replace(`?${qs}`, { scroll: false });
    },
    [router, searchParams]
  );

  const setDepartment = useCallback(
    (dept: DepartmentCode) => _push({ department: dept }),
    [_push]
  );

  const removeUniversity = useCallback(
    (slug: string) => {
      // a/b zorunlu, c opsiyonel. a kaldırılırsa b → a, c → b.
      if (slug === selection.a) {
        if (selection.c) {
          _push({ a: selection.b, b: selection.c, c: null });
        }
        // else: tek üniversite kalmaz, dokunma
      } else if (slug === selection.b) {
        if (selection.c) {
          _push({ b: selection.c, c: null });
        }
      } else if (slug === selection.c) {
        _push({ c: null });
      }
    },
    [_push, selection]
  );

  const addUniversity = useCallback(
    (slug: string) => {
      if (selection.slugs.includes(slug)) return;
      if (!selection.c) {
        _push({ c: slug });
      } else {
        // Zaten 3 var — ilk olanı düşürüp kaydır
        _push({ a: selection.b, b: selection.c, c: slug });
      }
    },
    [_push, selection]
  );

  const replaceUniversity = useCallback(
    (slot: "a" | "b" | "c", slug: string) => {
      _push({ [slot]: slug } as Partial<Selection>);
    },
    [_push]
  );

  /**
   * Toplu güncelleme — örn. dept değişiminde a/b/c'yi atomik replace etmek için.
   * Tek setSearchParams çağrısı yapar (race-condition'sız).
   */
  const setSelection = useCallback(
    (next: Partial<Pick<Selection, "a" | "b" | "c" | "department">>) => {
      _push(next);
    },
    [_push]
  );

  return {
    selection,
    setDepartment,
    addUniversity,
    removeUniversity,
    replaceUniversity,
    setSelection,
  };
}

// Üniversite slot'una göre renk
export function uniColor(index: number): string {
  return ["var(--color-uni-a)", "var(--color-uni-b)", "var(--color-uni-c)"][index] || "var(--color-ink-700)";
}

/**
 * Üniversite kısa adı — UI'da chip/legend etiketleri için.
 *
 * "Orta Doğu Teknik Üniversitesi" → "ODTÜ" (split-by-space "Orta" yanlış kalıyordu).
 * Slug → kısa ad sözlüğü; bilinmeyenlerde "Üniversitesi" tail'i atılıp ilk
 * 1-2 kelime alınır (Bilkent, Sabancı gibi tek kelimeli isimler doğal kalır).
 */
const KNOWN_ABBR: Record<string, string> = {
  metu: "ODTÜ",
  itu: "İTÜ",
  ytu: "YTÜ",
  iyte: "İYTE",
  tobb: "TOBB ETÜ",
  tau: "TAÜ",
  ktu: "KTÜ",
  deu: "DEÜ",
  gtu: "GTÜ",
  gebze: "GTÜ",
  gsu: "GSÜ",
  ybeyazit: "AYBÜ",
};

// Resmi ad → kısa ad (slug bilinmiyorsa fallback). uniShortName slug parametresi
// boş gelirse bu sözlüğe başvurur. "Orta Doğu Teknik Üniversitesi" → "ODTÜ"
// gibi durumlar için kritik (split-by-space "Orta" yanlış kalıyordu).
const NAME_TO_ABBR: Record<string, string> = {
  "Orta Doğu Teknik Üniversitesi": "ODTÜ",
  "İstanbul Teknik Üniversitesi": "İTÜ",
  "Yıldız Teknik Üniversitesi": "YTÜ",
  "İzmir Yüksek Teknoloji Enstitüsü": "İYTE",
  "TOBB Ekonomi ve Teknoloji Üniversitesi": "TOBB ETÜ",
  "Türk-Alman Üniversitesi": "TAÜ",
  "Karadeniz Teknik Üniversitesi": "KTÜ",
  "Dokuz Eylül Üniversitesi": "DEÜ",
  "Gebze Teknik Üniversitesi": "GTÜ",
  "Galatasaray Üniversitesi": "GSÜ",
  "Ankara Yıldırım Beyazıt Üniversitesi": "AYBÜ",
  "İzmir Ekonomi Üniversitesi": "İzmir Ekonomi",
  "Türk Hava Kurumu Üniversitesi": "Türk Hava Kurumu",
  "Ostim Teknik Üniversitesi": "Ostim Teknik",
};

export function uniShortName(slug: string, fullName?: string | null): string {
  // Slug suffix'lerini at (-yazilim, -ybs)
  const baseSlug = (slug || "").replace(/-(yazilim|yazılım|ybs)$/i, "");
  if (KNOWN_ABBR[baseSlug]) return KNOWN_ABBR[baseSlug];
  if (fullName && NAME_TO_ABBR[fullName.trim()]) return NAME_TO_ABBR[fullName.trim()];
  if (!fullName) return baseSlug || slug;
  // "Bilkent Üniversitesi" → "Bilkent"
  const cleaned = fullName
    .replace(/\s+(Üniversitesi|Üniversite|Vakıf)$/i, "")
    .trim();
  // 2 kelime ve hâlâ kısa → tam tut ("Türk Hava Kurumu" gibi); aksi halde ilk
  if (cleaned.length <= 14) return cleaned;
  return cleaned.split(/\s+/)[0];
}
