"use client";

/**
 * Dashboard overlay state — Chat'ten gelen `dashboard_update`'ı uygulayıp
 * 30 saniye sonra otomatik temizler. DASHBOARD_PROMPT.md "Chat → Dashboard
 * İletişimi" bölümü.
 *
 * Provider tüm dashboard'u sarmalar (app/page.tsx + deep-analysis page).
 * Bileşenler `useOverlay()` ile current overlay'i okur ve görsel vurgu
 * yapar (radar ekseni glow, kart border parıltı, vb.).
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import type { DashboardUpdate } from "./types";

const OVERLAY_TTL_MS = 30000;   // 30 saniye

interface OverlayContextValue {
  overlay: DashboardUpdate | null;
  setOverlay: (update: DashboardUpdate | null) => void;
  clearOverlay: () => void;
}

const OverlayContext = createContext<OverlayContextValue>({
  overlay: null,
  setOverlay: () => {},
  clearOverlay: () => {},
});

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlayState] = useState<DashboardUpdate | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOverlay = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOverlayState(null);
  }, []);

  const setOverlay = useCallback(
    (update: DashboardUpdate | null) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOverlayState(update);
      if (update) {
        timerRef.current = setTimeout(() => {
          setOverlayState(null);
          timerRef.current = null;
        }, OVERLAY_TTL_MS);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <OverlayContext.Provider value={{ overlay, setOverlay, clearOverlay }}>
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayContextValue {
  return useContext(OverlayContext);
}

/** Bileşenlerin "show_metric eşleşiyor mu?" kontrolü için yardımcı. */
export function useMetricGlow(metric: DashboardUpdate["show_metric"]): boolean {
  const { overlay } = useOverlay();
  return overlay?.show_metric === metric;
}
