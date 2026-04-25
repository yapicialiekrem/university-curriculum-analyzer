"use client";

/**
 * OutcomesHeatmap — Dashboard Bileşen 2.4.
 *
 * Program çıktıları benzerlik ısı haritası.
 * /api/compare/program-outcomes top_n eşleşen çift döner.
 *
 * Görsel: A program çıktıları sütun, B program çıktıları satır.
 * Hücre koyuluğu = cosine benzerlik. Tıklanırsa altta detay açılır.
 */

import { useMemo, useState } from "react";

import type { ProgramOutcomesResponse } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface OutcomesHeatmapProps {
  data: ProgramOutcomesResponse | undefined;
  loading?: boolean;
}

export function OutcomesHeatmap({ data, loading }: OutcomesHeatmapProps) {
  const [hovered, setHovered] = useState<{ a: number; b: number } | null>(null);

  // Backend'in döndürdüğü `top_matches` (eski şema) → `similar_pairs`
  // (yeni şema) dönüşümü. SWR fail / boş data güvenli ele alınır.
  const pairs = useMemo(() => {
    if (!data) return [];
    const raw = (data.similar_pairs ??
      (data as unknown as { top_matches?: Array<Record<string, unknown>> }).top_matches ??
      []) as Array<Record<string, unknown>>;
    return raw.map((p) => {
      // Yeni şema (similar_pairs): {outcome1: {index, text}, ...}
      if (p && typeof p === "object" && "outcome1" in p && p.outcome1 && typeof p.outcome1 === "object") {
        return p as unknown as import("@/lib/types").OutcomePair;
      }
      // Eski şema (top_matches): flat fields
      return {
        outcome1: {
          index: Number(p.outcome1_index ?? 0),
          text: String(p.outcome1_text ?? ""),
        },
        outcome2: {
          index: Number(p.outcome2_index ?? 0),
          text: String(p.outcome2_text ?? ""),
        },
        similarity: Number(
          p.similarity ?? (typeof p.similarity_pct === "number" ? p.similarity_pct / 100 : 0)
        ),
      };
    });
  }, [data]);

  const grid = useMemo(() => {
    if (!pairs.length) return null;
    const map = new Map<string, number>();
    let maxA = 0, maxB = 0;
    for (const p of pairs) {
      const i = p.outcome1.index;
      const j = p.outcome2.index;
      map.set(`${i}:${j}`, p.similarity);
      maxA = Math.max(maxA, i);
      maxB = Math.max(maxB, j);
    }
    return { map, maxA, maxB };
  }, [pairs]);

  if (loading || !data) {
    return <div className="h-[260px] skeleton rounded" />;
  }

  if (!pairs.length) {
    return <p className="text-sm text-[color:var(--color-ink-500)]">Karşılaştırılabilir program çıktısı bulunamadı.</p>;
  }

  const { map, maxA, maxB } = grid!;
  const aIndices = Array.from({ length: maxA + 1 }, (_, i) => i);
  const bIndices = Array.from({ length: maxB + 1 }, (_, i) => i);

  // Hover'da ekteki çiftin metinlerini göstereceğiz
  const hoveredPair = hovered
    ? pairs.find(
        (p) => p.outcome1.index === hovered.a && p.outcome2.index === hovered.b
      )
    : null;

  // Üniversite ismini şemadan bağımsız çek
  const uniName = (u: ProgramOutcomesResponse["university1"]) =>
    typeof u === "string" ? u : u?.name ?? "";
  const uni1Name = uniName(data.university1);
  const uni2Name = uniName(data.university2);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <span className="ui-label">Program Çıktısı Benzerliği</span>
          <p className="text-xs italic font-serif text-[color:var(--color-ink-500)] mt-1">
            Hücre koyuluğu = cosine benzerlik. {pairs.length} eşleşen çift.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: uniColor(0) }} />
            {uni1Name.split(" ")[0]}{" "}
            ({typeof data.university1 === "object" ? data.university1.outcome_count : data.outcome_count1 ?? 0})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: uniColor(1) }} />
            {uni2Name.split(" ")[0]}{" "}
            ({typeof data.university2 === "object" ? data.university2.outcome_count : data.outcome_count2 ?? 0})
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {aIndices.map((i) => (
                <th
                  key={i}
                  className="ui-label text-center w-7 pb-1"
                  style={{ color: uniColor(0) }}
                >
                  P{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bIndices.map((j) => (
              <tr key={j}>
                <th
                  scope="row"
                  className="ui-label text-right pr-2"
                  style={{ color: uniColor(1) }}
                >
                  P{j + 1}
                </th>
                {aIndices.map((i) => {
                  const sim = map.get(`${i}:${j}`) || 0;
                  const isHovered =
                    hovered && hovered.a === i && hovered.b === j;
                  return (
                    <td key={i} className="p-0">
                      <button
                        className="block w-7 h-7 rounded-sm transition-transform hover:scale-110"
                        style={{
                          background: sim > 0
                            ? `rgba(45,106,138,${0.15 + sim * 0.85})`
                            : "var(--color-paper-2)",
                          outline: isHovered
                            ? `2px solid var(--color-ink-900)`
                            : "none",
                        }}
                        onMouseEnter={() => setHovered({ a: i, b: j })}
                        onMouseLeave={() => setHovered(null)}
                        title={sim > 0 ? `%${Math.round(sim * 100)} benzerlik` : "—"}
                        aria-label={`${uni1Name} P${i + 1} ↔ ${uni2Name} P${j + 1}: ${Math.round(sim * 100)}%`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hover detay */}
      {hoveredPair && (
        <div className="mt-3 p-4 rounded border bg-[color:var(--color-paper-2)]" style={{ borderColor: "var(--color-line)" }}>
          <div className="text-xs font-mono uppercase tracking-wider mb-2 text-[color:var(--color-ink-500)]">
            %{Math.round(hoveredPair.similarity * 100)} benzerlik
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs font-mono mr-2" style={{ color: uniColor(0) }}>
                P{hoveredPair.outcome1.index + 1}
              </span>
              {hoveredPair.outcome1.text}
            </div>
            <div>
              <span className="text-xs font-mono mr-2" style={{ color: uniColor(1) }}>
                P{hoveredPair.outcome2.index + 1}
              </span>
              {hoveredPair.outcome2.text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
