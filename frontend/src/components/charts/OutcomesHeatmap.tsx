"use client";

/**
 * OutcomesHeatmap — Dashboard Bileşen 2.4.
 *
 * Program çıktıları benzerlik ısı haritası.
 * 2 üni → 1 grid; 3 üni → 3 ikili grid (A-B, A-C, B-C) yan yana.
 *
 * Hover davranışı:
 *   - Sütun/satır başlığı (P1, P2…) → o üniversitenin tam outcome metni popup
 *   - Hücre → iki çıktının metni + benzerlik yüzdesi popup
 */

import { useMemo, useState } from "react";

import type { OutcomePair, ProgramOutcomesResponse } from "@/lib/types";
import { uniColor, uniShortName } from "@/lib/use-selection";

export interface PairwiseOutcomes {
  /** Slot index uniColor için */
  slotA: number;
  slotB: number;
  slugA: string;
  slugB: string;
  data: ProgramOutcomesResponse | undefined;
  loading?: boolean;
}

export interface OutcomesHeatmapProps {
  /** 1, 2 veya 3 ikili — 3 üni varsa A-B, A-C, B-C üçüsü */
  pairs: PairwiseOutcomes[];
}

export function OutcomesHeatmap({ pairs }: OutcomesHeatmapProps) {
  if (!pairs.length) {
    return (
      <p className="text-sm text-[color:var(--color-ink-500)]">
        Karşılaştırma için en az 2 üniversite gerekli.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={`grid gap-6 ${
          pairs.length === 1
            ? "grid-cols-1"
            : pairs.length === 2
            ? "grid-cols-1 lg:grid-cols-2"
            : "grid-cols-1 lg:grid-cols-3"
        }`}
      >
        {pairs.map((p, idx) => (
          <PairGrid key={`${p.slugA}-${p.slugB}-${idx}`} pair={p} />
        ))}
      </div>
    </div>
  );
}

function PairGrid({ pair }: { pair: PairwiseOutcomes }) {
  const { data, loading, slotA, slotB, slugA, slugB } = pair;

  const pairsList: OutcomePair[] = useMemo(() => {
    if (!data) return [];
    const raw = (data.similar_pairs ??
      (data as unknown as { top_matches?: Array<Record<string, unknown>> }).top_matches ??
      []) as Array<Record<string, unknown>>;
    return raw.map((p) => {
      if (p && typeof p === "object" && "outcome1" in p && p.outcome1 && typeof p.outcome1 === "object") {
        return p as unknown as OutcomePair;
      }
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

  // Hücre hover state — col/row koordinatları (orientasyon swap'a göre)
  const [cellHover, setCellHover] = useState<{ col: number; row: number } | null>(null);
  // Eksen başlığı hover — col (yatay/sütun) veya row (dikey/satır)
  const [axisHover, setAxisHover] = useState<
    { side: "col" | "row"; index: number } | null
  >(null);

  // outcome metinleri — backend'in v3 outcomes1/2 listesi varsa onu kullan
  // (TÜM çıktılar dahil), yoksa pair'lerden çıkar (top-N).
  const textMaps = useMemo(() => {
    const a = new Map<number, string>();
    const b = new Map<number, string>();
    (data?.outcomes1 || []).forEach((o) => a.set(o.index, o.text));
    (data?.outcomes2 || []).forEach((o) => b.set(o.index, o.text));
    for (const p of pairsList) {
      if (p.outcome1?.text && !a.has(p.outcome1.index)) a.set(p.outcome1.index, p.outcome1.text);
      if (p.outcome2?.text && !b.has(p.outcome2.index)) b.set(p.outcome2.index, p.outcome2.text);
    }
    return { a, b };
  }, [data, pairsList]);

  // Grid sınırları — outcome listesi varsa onun uzunluğu, yoksa pair'lerden
  const { map, maxA, maxB } = useMemo(() => {
    const m = new Map<string, number>();
    let mA = -1;
    let mB = -1;
    for (const p of pairsList) {
      m.set(`${p.outcome1.index}:${p.outcome2.index}`, p.similarity);
      if (p.outcome1.index > mA) mA = p.outcome1.index;
      if (p.outcome2.index > mB) mB = p.outcome2.index;
    }
    // Backend tüm outcomes listesini döndürüyorsa onu otorite kabul et
    if (data?.outcomes1?.length) mA = data.outcomes1.length - 1;
    if (data?.outcomes2?.length) mB = data.outcomes2.length - 1;
    return { map: m, maxA: mA, maxB: mB };
  }, [pairsList, data]);

  const uniName = (u: ProgramOutcomesResponse["university1"] | undefined) =>
    typeof u === "string" ? u : u?.name ?? "";

  const fullA = uniName(data?.university1);
  const fullB = uniName(data?.university2);
  const shortA = uniShortName(slugA, fullA);
  const shortB = uniShortName(slugB, fullB);
  // outcome_count'ı outcomes1/2 listesi ile düzelt — backend filter'ı bazen
  // duplicate / cross-program count veriyordu (ör. İzmir Ekonomi 35 yerine 24)
  const countA = data?.outcomes1?.length
    ?? (typeof data?.university1 === "object" ? data.university1.outcome_count : data?.outcome_count1)
    ?? 0;
  const countB = data?.outcomes2?.length
    ?? (typeof data?.university2 === "object" ? data.university2.outcome_count : data?.outcome_count2)
    ?? 0;

  if (loading || !data) {
    return <div className="h-[260px] skeleton rounded" />;
  }

  if (maxA < 0 || maxB < 0) {
    return (
      <div className="space-y-2">
        <Header shortA={shortA} shortB={shortB} slotA={slotA} slotB={slotB} countA={countA} countB={countB} />
        <p className="text-sm text-[color:var(--color-ink-500)]">
          Eşleşme bulunamadı.
        </p>
      </div>
    );
  }

  const aIndices = Array.from({ length: maxA + 1 }, (_, i) => i);
  const bIndices = Array.from({ length: maxB + 1 }, (_, i) => i);

  // Yatay/dikey orientasyon — daha çok program çıktılı olan üni yatay (sütun)
  // eksende olsun ki dikey scroll gerekmesin ve okunabilirlik artsın.
  const swap = bIndices.length > aIndices.length;
  const colIndices = swap ? bIndices : aIndices;
  const rowIndices = swap ? aIndices : bIndices;
  const colShort = swap ? shortB : shortA;
  const rowShort = swap ? shortA : shortB;
  const colSlot = swap ? slotB : slotA;
  const rowSlot = swap ? slotA : slotB;
  const colTextMap = swap ? textMaps.b : textMaps.a;
  const rowTextMap = swap ? textMaps.a : textMaps.b;

  // map key her zaman `outcome1:outcome2` (uni1:uni2). swap durumunda
  // (col=outcome2, row=outcome1) → key `row:col`; aksi halde `col:row`.
  const cellSim = (col: number, row: number): number => {
    const i1 = swap ? row : col;
    const i2 = swap ? col : row;
    return map.get(`${i1}:${i2}`) || 0;
  };

  // Hücre hover (col, row) → orijinal pair lookup'u
  const hoveredPair = cellHover
    ? pairsList.find((p) => {
        const i1 = swap ? cellHover.row : cellHover.col;
        const i2 = swap ? cellHover.col : cellHover.row;
        return p.outcome1.index === i1 && p.outcome2.index === i2;
      })
    : null;

  return (
    <div className="space-y-3">
      <Header
        shortA={shortA}
        shortB={shortB}
        slotA={slotA}
        slotB={slotB}
        countA={countA}
        countB={countB}
        pairCount={pairsList.length}
      />

      {/* Grid — orientation swap: daha çok PO'lu üni yatay (sütun) eksende */}
      <div className="overflow-x-auto relative">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {colIndices.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="ui-label text-center w-7 pb-1"
                  style={{ color: uniColor(colSlot) }}
                  onMouseEnter={() => setAxisHover({ side: "col", index: c })}
                  onMouseLeave={() => setAxisHover(null)}
                >
                  P{c + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowIndices.map((r) => (
              <tr key={r}>
                <th
                  scope="row"
                  className="ui-label text-right pr-2"
                  style={{ color: uniColor(rowSlot) }}
                  onMouseEnter={() => setAxisHover({ side: "row", index: r })}
                  onMouseLeave={() => setAxisHover(null)}
                >
                  P{r + 1}
                </th>
                {colIndices.map((c) => {
                  const sim = cellSim(c, r);
                  const isHovered =
                    cellHover && cellHover.col === c && cellHover.row === r;
                  return (
                    <td key={c} className="p-0">
                      <button
                        className="block w-7 h-7 rounded-sm transition-transform hover:scale-110"
                        style={{
                          background: sim > 0
                            ? `rgba(45,106,138,${0.15 + sim * 0.85})`
                            : "var(--color-paper-2)",
                          outline: isHovered ? "2px solid var(--color-ink-900)" : "none",
                        }}
                        onMouseEnter={() => setCellHover({ col: c, row: r })}
                        onMouseLeave={() => setCellHover(null)}
                        aria-label={`${colShort} P${c + 1} ↔ ${rowShort} P${r + 1}: ${Math.round(sim * 100)}%`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detay paneli — eksen başlığı (P) hover'ında tek üni metni;
          hücre hover'ında iki üni metni + benzerlik. Tek noktada okunsun. */}
      {axisHover && (
        <DetailPanel>
          <DetailLine
            label={
              axisHover.side === "col"
                ? `${colShort} P${axisHover.index + 1}`
                : `${rowShort} P${axisHover.index + 1}`
            }
            text={
              (axisHover.side === "col"
                ? colTextMap.get(axisHover.index)
                : rowTextMap.get(axisHover.index)) ||
              "Metin yok."
            }
            color={uniColor(axisHover.side === "col" ? colSlot : rowSlot)}
          />
        </DetailPanel>
      )}

      {!axisHover && hoveredPair && (
        <DetailPanel
          header={`%${Math.round(hoveredPair.similarity * 100)} benzerlik`}
        >
          <DetailLine
            label={`${shortA} P${hoveredPair.outcome1.index + 1}`}
            text={hoveredPair.outcome1.text}
            color={uniColor(slotA)}
          />
          <DetailLine
            label={`${shortB} P${hoveredPair.outcome2.index + 1}`}
            text={hoveredPair.outcome2.text}
            color={uniColor(slotB)}
          />
        </DetailPanel>
      )}

    </div>
  );
}

/**
 * Heatmap altında sabit detay paneli — hover hedefine (eksen başlığı veya
 * hücre) göre içerik değişir. Tek noktada okunsun diye popup tooltip yok.
 */
function DetailPanel({
  header,
  children,
}: {
  header?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mt-2 p-3 rounded border bg-[color:var(--color-paper-2)]"
      style={{ borderColor: "var(--color-line)" }}
    >
      {header && (
        <div className="text-xs font-medium mb-2 text-[color:var(--color-ink-700)]">
          {header}
        </div>
      )}
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function DetailLine({
  label,
  text,
  color,
}: {
  label: string;
  text: string;
  color: string;
}) {
  return (
    <div>
      <span
        className="font-medium font-mono mr-2 text-xs"
        style={{ color }}
      >
        {label}
      </span>
      <span className="text-[color:var(--color-ink-900)]">{text}</span>
    </div>
  );
}

function Header({
  shortA,
  shortB,
  slotA,
  slotB,
  countA,
  countB,
  pairCount,
}: {
  shortA: string;
  shortB: string;
  slotA: number;
  slotB: number;
  countA: number;
  countB: number;
  pairCount?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 text-xs font-mono">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: uniColor(slotA) }} />
          {shortA} ({countA})
        </span>
        <span className="text-[color:var(--color-ink-300)]">×</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: uniColor(slotB) }} />
          {shortB} ({countB})
        </span>
      </div>
      {typeof pairCount === "number" && (
        <span className="text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-ink-500)]">
          {pairCount} eşleşme
        </span>
      )}
    </div>
  );
}

