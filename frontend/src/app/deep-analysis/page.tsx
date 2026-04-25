import dynamic from "next/dynamic";

// LayerThree ReactFlow + Recharts içeriyor → ayrı route chunk
const LayerThree = dynamic(
  () => import("@/components/layers/LayerThree").then((m) => ({ default: m.LayerThree })),
  { loading: () => <Loading /> }
);

export const metadata = {
  title: "Derin Analiz — UniCurriculum",
};

export default function DeepAnalysisPage() {
  return (
    <main className="flex-1">
      <LayerThree />
    </main>
  );
}

function Loading() {
  return (
    <section className="px-4 sm:px-6 lg:px-10 max-w-[1440px] mx-auto py-12 space-y-10">
      <div className="space-y-3">
        <div className="h-4 w-24 skeleton" />
        <div className="h-12 w-2/3 skeleton" />
        <div className="h-4 w-1/2 skeleton" />
      </div>
      <div className="card h-[300px] skeleton" />
      <div className="card h-[300px] skeleton" />
    </section>
  );
}
