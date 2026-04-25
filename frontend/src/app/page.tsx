import { Suspense } from "react";
import dynamic from "next/dynamic";

import { LayerOne } from "@/components/layers/LayerOne";

// Code splitting: LayerTwo ayrı chunk'a düşsün — Recharts heatmap +
// donut bileşenleri ~80 KB initial bundle'ı şişirmesin.
// (Next 16 server component'ta ssr:false yasak; SSR yapılır ama
// chunk yine ayrılır.)
const LayerTwo = dynamic(
  () => import("@/components/layers/LayerTwo").then((m) => ({ default: m.LayerTwo })),
  { loading: () => <LazyPlaceholder /> }
);

export default function Home() {
  return (
    <main className="flex-1">
      <Suspense fallback={<DashboardSkeleton />}>
        <LayerOne />
      </Suspense>
      <LayerTwo />
    </main>
  );
}

function LazyPlaceholder() {
  return (
    <section className="px-4 sm:px-6 lg:px-10 max-w-[1440px] mx-auto py-16">
      <div className="card h-[400px] skeleton" />
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <section className="px-4 sm:px-6 lg:px-10 max-w-[1440px] mx-auto pt-12 pb-16">
      <div className="space-y-4 mb-10">
        <div className="h-10 w-2/3 skeleton" />
        <div className="h-4 w-1/2 skeleton" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 card">
          <div className="aspect-square skeleton" />
        </div>
        <div className="lg:col-span-5 grid gap-6">
          <div className="card h-[400px] skeleton" />
          <div className="card h-[400px] skeleton" />
        </div>
      </div>
    </section>
  );
}
