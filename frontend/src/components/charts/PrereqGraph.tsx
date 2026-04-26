"use client";

/**
 * PrereqGraph — Dashboard Bileşen 3.2 (tam graf).
 *
 * ReactFlow ile önkoşul ağını çizer. Kullanıcı bir derse tıklarsa o
 * dersin altındaki tüm önkoşul zinciri vurgulanır.
 *
 * Kaynak: `/api/compare/prerequisites` → her üni için edges[].
 * İki üni yan yana, her biri ayrı sub-flow.
 *
 * Not: Otomatik layout için elkjs/dagre yerine basit topological sort
 * + grid placement kullanıyoruz (dış bağımlılık eklemeyelim).
 */

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "reactflow";

import "reactflow/dist/style.css";

import type { PrereqEdge, PrerequisitesResponse } from "@/lib/types";
import { uniColor } from "@/lib/use-selection";

export interface PrereqGraphProps {
  data: PrerequisitesResponse | undefined;
  loading?: boolean;
}

export function PrereqGraph({ data, loading }: PrereqGraphProps) {
  if (loading || !data) {
    return <div className="h-[420px] skeleton rounded" />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SingleGraph
        title={data.university1?.name || "—"}
        edges={Array.isArray(data.university1?.edges) ? data.university1.edges : []}
        slotIndex={0}
      />
      <SingleGraph
        title={data.university2?.name || "—"}
        edges={Array.isArray(data.university2?.edges) ? data.university2.edges : []}
        slotIndex={1}
      />
    </div>
  );
}

function SingleGraph({
  title,
  edges,
  slotIndex,
}: {
  title: string;
  edges: PrereqEdge[];
  slotIndex: number;
}) {
  const accent = uniColor(slotIndex);

  // Edges → ReactFlow node + edge listesi (basit topological layout)
  const { nodes, flowEdges } = useMemo(
    () => buildGraph(edges, accent),
    [edges, accent]
  );

  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => setSelected(null), [edges]);

  // Seçili node'un atalarını işaretle (ihtiyaç olan tüm prereq'ler)
  const ancestors = useMemo(() => {
    if (!selected) return new Set<string>();
    const set = new Set<string>([selected]);
    const queue = [selected];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.course === cur && !set.has(e.prerequisite)) {
          set.add(e.prerequisite);
          queue.push(e.prerequisite);
        }
      }
    }
    return set;
  }, [selected, edges]);

  // Selected'a göre style override
  const styledNodes: Node[] = nodes.map((n) => {
    const inChain = ancestors.has(n.id);
    return {
      ...n,
      data: { ...n.data, label: n.data.label },
      style: {
        ...n.style,
        opacity: selected ? (inChain ? 1 : 0.25) : 1,
        borderColor: inChain && selected ? accent : "rgba(15,14,13,0.18)",
        borderWidth: inChain && selected ? 2 : 1,
      },
    };
  });
  const styledEdges: Edge[] = flowEdges.map((e) => {
    const inChain = ancestors.has(e.source) && ancestors.has(e.target);
    return {
      ...e,
      style: {
        ...e.style,
        opacity: selected ? (inChain ? 0.9 : 0.15) : 0.5,
        stroke: inChain && selected ? accent : "rgba(15,14,13,0.30)",
      },
    };
  });

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="font-serif text-base font-medium leading-tight">{title}</h3>
        <span className="font-mono text-xs text-[color:var(--color-ink-500)] tabular-nums ml-auto">
          {nodes.length} ders, {flowEdges.length} bağ
        </span>
      </div>

      {nodes.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-sm italic font-serif text-[color:var(--color-ink-500)] border rounded" style={{ borderColor: "var(--color-line)" }}>
          Bu üniversitede önkoşul bağlantısı yok.
        </div>
      ) : nodes.length > 600 ? (
        <div
          className="h-[300px] flex items-center justify-center text-sm italic font-serif text-[color:var(--color-ink-500)] border rounded text-center px-6"
          style={{ borderColor: "var(--color-line)" }}
        >
          {nodes.length} ders / {flowEdges.length} bağ — bu üniversitenin önkoşul ağı interaktif görselleştirme için fazla büyük.
        </div>
      ) : (
        <div
          className="h-[420px] rounded border bg-[color:var(--color-paper-2)]"
          style={{ borderColor: "var(--color-line)" }}
          aria-label={`${title} önkoşul ağı`}
        >
          <ReactFlow
            nodes={styledNodes}
            edges={styledEdges}
            fitView
            nodesDraggable
            elementsSelectable
            onNodeClick={(_, node) => setSelected(node.id === selected ? null : node.id)}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: true }}
            minZoom={0.4}
            maxZoom={1.6}
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(15,14,13,0.40)" },
            }}
          >
            <Background gap={16} size={1} color="rgba(15,14,13,0.06)" />
            <Controls
              showInteractive={false}
              style={{
                background: "var(--color-white-paper)",
                border: "1px solid var(--color-line)",
              }}
            />
          </ReactFlow>
        </div>
      )}

      <p className="text-xs italic font-serif text-[color:var(--color-ink-500)]">
        Bir derse tıkla — alt zinciri vurgulanır. Tekrar tıklarsan seçim kalkar.
      </p>
    </div>
  );
}

/**
 * Topological-sort + grid layout.
 *
 *  - Köklerden (önkoşulu olmayan dersler) başlayarak depth atanır.
 *  - Aynı depth'tekiler X eksenine sıralanır.
 */
function buildGraph(edges: PrereqEdge[], accent: string) {
  const safeEdges = Array.isArray(edges) ? edges : [];
  const nodeIds = new Set<string>();
  for (const e of safeEdges) {
    if (!e || !e.course || !e.prerequisite) continue;
    nodeIds.add(e.course);
    nodeIds.add(e.prerequisite);
  }
  const ids = Array.from(nodeIds);
  if (ids.length === 0) return { nodes: [] as Node[], flowEdges: [] as Edge[] };

  // Adjacency: course → list of prereqs
  const prereqsOf = new Map<string, string[]>();
  for (const e of safeEdges) {
    if (!e || !e.course || !e.prerequisite) continue;
    if (!prereqsOf.has(e.course)) prereqsOf.set(e.course, []);
    prereqsOf.get(e.course)!.push(e.prerequisite);
  }

  // Depth (BFS dal kökten) — root = prereqs[]==0
  const depth = new Map<string, number>();
  let safety = 0;
  while (depth.size < ids.length && safety < 50) {
    safety += 1;
    let progressed = false;
    for (const id of ids) {
      if (depth.has(id)) continue;
      const ps = prereqsOf.get(id) || [];
      if (ps.length === 0) {
        depth.set(id, 0);
        progressed = true;
      } else if (ps.every((p) => depth.has(p))) {
        const d = Math.max(...ps.map((p) => depth.get(p)!)) + 1;
        depth.set(id, d);
        progressed = true;
      }
    }
    if (!progressed) {
      // cyclic veya disconnected — kalanları en yüksek seviyeye at
      for (const id of ids) if (!depth.has(id)) depth.set(id, 0);
      break;
    }
  }

  // Depth → node count
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth.entries()) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  // Layout: x = depth × 180, y = position × 64
  const NODE_W = 90;
  const COL_GAP = 60;
  const ROW_GAP = 50;

  const nodes: Node[] = [];
  for (const [d, list] of byDepth.entries()) {
    list.sort();
    list.forEach((id, i) => {
      nodes.push({
        id,
        position: { x: d * (NODE_W + COL_GAP), y: i * (NODE_W * 0.45 + ROW_GAP) },
        data: { label: id },
        style: {
          width: NODE_W,
          padding: "8px 6px",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          textAlign: "center" as const,
          background: "var(--color-white-paper)",
          border: "1px solid rgba(15,14,13,0.18)",
          borderRadius: 6,
          color: "var(--color-ink-900)",
        },
      });
    });
  }

  const flowEdges: Edge[] = safeEdges
    .filter((e) => e && e.course && e.prerequisite)
    .map((e, i) => ({
      id: `e-${i}`,
      source: e.prerequisite,
      target: e.course,
      type: "smoothstep",
      animated: false,
      style: { stroke: "rgba(15,14,13,0.35)", strokeWidth: 1.5 },
    }));

  return { nodes, flowEdges };
}
