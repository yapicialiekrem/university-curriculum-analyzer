import { Suspense } from "react";

import { LayerThree } from "@/components/layers/LayerThree";

export const metadata = {
  title: "Derin Analiz — UniCurriculum",
};

export default function DeepAnalysisPage() {
  return (
    <main className="flex-1">
      <Suspense fallback={null}>
        <LayerThree />
      </Suspense>
    </main>
  );
}
