"use client";

/**
 * WeeklyTopicsSingleUni — Tek üni seçiliyken Bileşen 3.1 için.
 *
 * Karşılaştırma yok; o üniversitenin kategori başına ders listesi +
 * her dersin haftalık konuları (tıklanabilir/expand). Arama + sayfalama.
 */

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Pagination } from "@/components/Pagination";
import type { CourseFull, UniversityFull } from "@/lib/types";

const PAGE_SIZE = 15;

// Frontend'de kullanılan kategori → Türkçe etiket eşlemesi (CoverageTable
// ile aynı liste). software_eng için "Yazılım Geliştirme" — bölüm "Yazılım
// Mühendisliği" ile karışmasın.
const CAT_LABELS: Record<string, string> = {
  ai_ml: "Yapay Zeka / ML",
  programming: "Programlama",
  systems: "Sistem / Donanım",
  software_eng: "Yazılım Geliştirme",
  security: "Güvenlik",
  web_mobile: "Web / Mobil",
  data_science: "Veri Bilimi",
  graphics_vision: "Grafik / Görüntü",
  distributed: "Dağıtık Sistemler",
  theory: "Hesaplama Kuramı",
  math: "Matematik",
  info_systems: "Bilgi Sistemleri",
};

export interface WeeklyTopicsSingleUniProps {
  data: UniversityFull | undefined;
  loading?: boolean;
}

export function WeeklyTopicsSingleUni({ data, loading }: WeeklyTopicsSingleUniProps) {
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openCode, setOpenCode] = useState<string | null>(null);

  // Kategori başına ders sayısı (ders en az bir haftalık konu içeriyorsa say)
  const categories = useMemo(() => {
    if (!data?.courses) return [];
    const counts: Record<string, number> = {};
    for (const c of data.courses) {
      const cats = c._enriched?.categories || [];
      for (const cat of cats) {
        if (cat === "not_cs") continue;
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }, [data]);

  const currentCat = activeCat || categories[0];

  const visibleCourses = useMemo(() => {
    if (!data?.courses) return [] as CourseFull[];
    const ql = q.trim().toLowerCase();
    return data.courses.filter((c) => {
      const cats = c._enriched?.categories || [];
      if (currentCat && !cats.includes(currentCat)) return false;
      if (!ql) return true;
      const code = (c.code || "").toLowerCase();
      const name = (c.name || "").toLowerCase();
      return code.includes(ql) || name.includes(ql);
    });
  }, [data, currentCat, q]);

  // Filtre/kategori değişince ilk sayfaya dön
  useEffect(() => {
    setPage(1);
    setOpenCode(null);
  }, [currentCat, q]);

  if (loading || !data) {
    return <div className="h-[300px] skeleton rounded" />;
  }

  if (!data.courses?.length) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Bu üniversite için ders verisi yüklü değil.
      </p>
    );
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
        Kategori etiketli ders bulunamadı.
      </p>
    );
  }

  const total = visibleCourses.length;
  const pageItems = visibleCourses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Kategori sekmeleri */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => {
          const isActive = cat === currentCat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                isActive
                  ? "bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)]"
                  : "bg-[color:var(--color-paper-2)] text-[color:var(--color-ink-700)] hover:bg-[color:var(--color-paper-3)]"
              }`}
            >
              {CAT_LABELS[cat] || cat}
            </button>
          );
        })}
      </div>

      {/* Arama */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="ui-label">
          {total} ders — {CAT_LABELS[currentCat] || currentCat}
        </span>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded border bg-[color:var(--color-paper-2)] text-sm w-full sm:w-[260px]"
          style={{ borderColor: "var(--color-line)" }}
        >
          <Search size={14} strokeWidth={1.5} className="text-[color:var(--color-ink-500)]" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ders kodu/adı ara..."
            aria-label="Ders ara"
            className="flex-1 bg-transparent outline-none"
          />
        </div>
      </div>

      {/* Liste */}
      {pageItems.length === 0 ? (
        <p className="text-sm italic font-serif text-[color:var(--color-ink-500)]">
          Eşleşme yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {pageItems.map((c) => {
            const code = c.code || "";
            const isOpen = openCode === code;
            const topics = c.weekly_topics || [];
            return (
              <li
                key={code || c.name}
                className="rounded border bg-[color:var(--color-white-paper)]"
                style={{ borderColor: "var(--color-line)" }}
              >
                <button
                  type="button"
                  onClick={() => setOpenCode(isOpen ? null : code)}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-[color:var(--color-paper-2)] transition-colors"
                  aria-expanded={isOpen}
                >
                  <code className="font-mono text-[10px] text-[color:var(--color-ink-500)] tracking-tight w-20 flex-shrink-0">
                    {code || "—"}
                  </code>
                  <span className="text-sm font-medium leading-tight flex-1 min-w-0 truncate">
                    {c.name || "—"}
                  </span>
                  <span className="font-mono text-[10px] text-[color:var(--color-ink-500)] tabular-nums whitespace-nowrap">
                    {topics.length} hafta · {c.ects ?? "—"} AKTS
                    {c.type ? ` · ${c.type}` : ""}
                  </span>
                  <ChevronDown
                    size={14}
                    strokeWidth={1.5}
                    className={`text-[color:var(--color-ink-500)] transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div
                    className="px-3 pb-3 pt-1 border-t"
                    style={{ borderColor: "var(--color-line)" }}
                  >
                    {topics.length === 0 ? (
                      <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] mt-2">
                        Haftalık konu kaydı yok.
                      </p>
                    ) : (
                      <ol className="mt-2 space-y-1 text-sm leading-snug">
                        {topics.map((t, i) => (
                          <li
                            key={i}
                            className="text-[color:var(--color-ink-700)]"
                          >
                            {t}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onChange={setPage}
        label="ders"
      />
    </div>
  );
}
