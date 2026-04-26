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

// Default üniversite SEÇİMİ YOK — kullanıcı seçim yapana kadar dashboard
// boş başlangıç state'inde kalır. Eski "metu+bilkent" otomatik kıyas çağrımı
// kaldırıldı (kullanıcı isteği: 0/1/2/3 üni seçimi mümkün olsun).

export interface Selection {
  a: string | null;
  b: string | null;
  c: string | null;
  department: DepartmentCode;
  // Yardımcılar
  slugs: string[];          // doldurulu slot'ların listesi (0-3 üye)
  isEmpty: boolean;         // 0 üni seçili mi?
  isFull: boolean;          // 3 üni seçili mi?
}

export function useSelection() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selection: Selection = useMemo(() => {
    const a = searchParams.get("a") || null;
    const b = searchParams.get("b") || null;
    const c = searchParams.get("c") || null;
    const dept = (searchParams.get("dept") as DepartmentCode) || DEFAULT_DEPT;
    const slugs = [a, b, c].filter((s): s is string => !!s);
    return {
      a,
      b,
      c,
      department: VALID_DEPTS.includes(dept) ? dept : DEFAULT_DEPT,
      slugs,
      isEmpty: slugs.length === 0,
      isFull: slugs.length >= 3,
    };
  }, [searchParams]);

  const _push = useCallback(
    (next: Partial<Selection>) => {
      const qs = new URLSearchParams(searchParams.toString());
      // null → query param'dan kaldır; string → set
      const apply = (key: "a" | "b" | "c") => {
        if (next[key] === undefined) return;
        const v = next[key];
        if (v) qs.set(key, v);
        else qs.delete(key);
      };
      apply("a");
      apply("b");
      apply("c");
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
      // Hangi slot'ta olduğunu bul, kaldır, kalan slug'ları sıkıştır.
      const remaining = selection.slugs.filter((s) => s !== slug);
      _push({
        a: remaining[0] || null,
        b: remaining[1] || null,
        c: remaining[2] || null,
      });
    },
    [_push, selection.slugs]
  );

  const addUniversity = useCallback(
    (slug: string) => {
      if (selection.slugs.includes(slug)) return;
      // İlk boş slot'a yerleştir (a → b → c)
      if (!selection.a) {
        _push({ a: slug });
      } else if (!selection.b) {
        _push({ b: slug });
      } else if (!selection.c) {
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
