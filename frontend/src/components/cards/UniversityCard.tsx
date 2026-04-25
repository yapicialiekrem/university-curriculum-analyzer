"use client";

/**
 * UniversityCard — Dashboard Bileşen 1.2.
 *
 * Bir üniversitenin özeti:
 *   - 4px sol kenarda accent renk (uni-a/b/c)
 *   - 80px serif rakam: modernity_score
 *   - GÜNCELLİK bar (renk: kırmızı/sarı/yeşil eşik)
 *   - Öğretim dili
 *   - UZMANLAŞMA: top 3 teknik kategoride zorunlu+seçmeli
 */

import type { UniversitySummary } from "@/lib/types";
import { X } from "lucide-react";

import { uniColor } from "@/lib/use-selection";

const TECHNICAL_CATS = [
  { key: "ai_ml", label: "Yapay Zeka" },
  { key: "security", label: "Güvenlik" },
  { key: "web_mobile", label: "Web / Mobil" },
  { key: "data_science", label: "Veri Bilimi" },
  { key: "software_eng", label: "Yazılım Müh." },
  { key: "graphics_vision", label: "Grafik / Görüntü" },
  { key: "distributed", label: "Dağıtık Sistemler" },
] as const;

function modernityColor(score: number): string {
  if (score < 50) return "var(--color-alert)";
  if (score < 70) return "var(--color-warn)";
  return "var(--color-ok)";
}

export interface UniversityCardProps {
  summary: UniversitySummary | undefined;
  loading?: boolean;
  slotIndex: number;             // 0/1/2 → renk
  onRemove?: () => void;         // X butonu (a/b'de gizli, c'de var)
  removable?: boolean;
}

export function UniversityCard({
  summary,
  loading,
  slotIndex,
  onRemove,
  removable,
}: UniversityCardProps) {
  if (loading || !summary) {
    return (
      <article className="card relative">
        <div className="absolute left-0 top-6 bottom-6 w-1 rounded skeleton" />
        <div className="space-y-3 ml-2">
          <div className="h-7 w-3/4 skeleton" />
          <div className="h-4 w-1/2 skeleton" />
          <div className="h-20 w-full skeleton mt-6" />
          <div className="h-32 w-full skeleton" />
        </div>
      </article>
    );
  }

  const accent = uniColor(slotIndex);
  const score = summary.modernity_score ?? 0;
  const enrichedRatio = summary.total_courses
    ? summary.enriched_courses / summary.total_courses
    : 1;
  const dataSparse = enrichedRatio < 0.5;

  // Top 3 teknik uzmanlaşma
  const topSpec = TECHNICAL_CATS
    .map((c) => ({
      ...c,
      d: summary.specialization_depth[c.key] || { required: 0, elective: 0, total: 0 },
    }))
    .filter((x) => x.d.total > 0)
    .sort((a, b) => b.d.total - a.d.total)
    .slice(0, 3);

  return (
    <article className="card relative" data-testid={`uni-card-${slotIndex}`}>
      {/* Sol accent line */}
      <div
        className="absolute left-0 top-6 bottom-6 w-1 rounded"
        style={{ background: accent }}
      />

      {/* X kapama */}
      {removable && onRemove && (
        <button
          onClick={onRemove}
          className="absolute right-3 top-3 p-1 text-[color:var(--color-ink-300)] hover:text-[color:var(--color-ink-900)] transition-opacity"
          aria-label={`${summary.name} kaldır`}
        >
          <X size={16} />
        </button>
      )}

      <div className="ml-3 pr-6">
        <h3 className="font-serif text-xl font-medium leading-tight tracking-tight">
          {summary.name}
        </h3>
        <p className="text-sm text-[color:var(--color-ink-500)] italic mt-1">
          {summary.department || "—"}
        </p>

        {dataSparse && (
          <div
            role="status"
            className="mt-3 text-xs font-mono italic px-3 py-2 rounded"
            style={{
              background: "rgba(212,160,23,0.10)",
              color: "var(--color-warn)",
            }}
          >
            ⚠ Kısıtlı veri: {summary.total_courses} dersin {summary.enriched_courses}'i için detaylı bilgi mevcut.
          </div>
        )}

        <div className="mt-4 h-px" style={{ background: "var(--color-line)" }} />

        {/* GÜNCELLIK */}
        <section className="mt-5">
          <div className="ui-label">Güncellik</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className="font-serif text-5xl font-medium tracking-tighter leading-none"
              style={{ color: "var(--color-ink-900)" }}
            >
              {score}
            </span>
            <span className="font-mono text-xs text-[color:var(--color-ink-500)]">
              / 100
            </span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full overflow-hidden" style={{ background: "var(--color-paper-2)" }}>
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${score}%`,
                background: modernityColor(score),
              }}
            />
          </div>
        </section>

        {/* DİL */}
        <section className="mt-5">
          <div className="ui-label">Öğretim Dili</div>
          <p className="mt-1 text-sm">{summary.language || "—"}</p>
        </section>

        {/* UZMANLAŞMA */}
        {topSpec.length > 0 && (
          <section className="mt-5">
            <div className="ui-label">Uzmanlaşma Derinliği</div>
            <ul className="mt-3 space-y-2.5">
              {topSpec.map((c) => (
                <li key={c.key} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[color:var(--color-ink-700)] flex-1">
                      {c.label}
                    </span>
                    <span className="font-mono text-xs text-[color:var(--color-ink-500)] tabular-nums">
                      {c.d.required} zor. + {c.d.elective} seç.
                    </span>
                  </div>
                  <SpecBlocks
                    required={c.d.required}
                    elective={c.d.elective}
                    accent={accent}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* İngilizce kaynak oranı */}
        <section className="mt-5">
          <div className="ui-label">Kaynak Dili</div>
          <p className="mt-1 text-sm">
            <span className="font-mono">
              %{Math.round(summary.english_resources_ratio * 100)}
            </span>{" "}
            <span className="text-[color:var(--color-ink-500)]">İngilizce</span>
          </p>
        </section>
      </div>
    </article>
  );
}

/**
 * UZMANLAŞMA mini bar — FRONTEND_PROMPT.md "8px × 4px blok" görseli.
 * Zorunlu: solid accent. Seçmeli: 2px stroke, transparent fill. Max 20 blok.
 */
function SpecBlocks({
  required,
  elective,
  accent,
}: {
  required: number;
  elective: number;
  accent: string;
}) {
  const MAX = 20;
  const total = required + elective;
  const overflow = Math.max(0, total - MAX);
  const reqShown = Math.min(required, MAX);
  const elShown = Math.max(0, Math.min(elective, MAX - reqShown));

  if (total === 0) return null;

  return (
    <div className="mt-1.5 flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: reqShown }).map((_, i) => (
        <span
          key={`r${i}`}
          className="w-2 h-1 rounded-[1px] block"
          style={{ background: accent }}
        />
      ))}
      {Array.from({ length: elShown }).map((_, i) => (
        <span
          key={`e${i}`}
          className="w-2 h-1 rounded-[1px] block"
          style={{ border: `1px solid ${accent}`, background: "transparent" }}
        />
      ))}
      {overflow > 0 && (
        <span className="ml-1 font-mono text-[10px] text-[color:var(--color-ink-500)] tabular-nums">
          +{overflow}
        </span>
      )}
    </div>
  );
}
