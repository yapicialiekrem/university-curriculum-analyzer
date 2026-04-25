"use client";

/**
 * Tema yönetimi — light / dark / system.
 *
 * `<html data-theme="dark">` koyar; `globals.css` `[data-theme="dark"]`
 * selector'larıyla token'ları override eder.
 *
 * `localStorage` ile persistent. Default: system (prefers-color-scheme).
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
  toggle: () => {},
});

const KEY = "uc-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  // Read localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY) as Theme | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeState(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Apply to <html data-theme=...>
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const r =
        theme === "system" ? (mql.matches ? "dark" : "light") : theme;
      setResolved(r);
      document.documentElement.dataset.theme = r;
    };
    update();
    if (theme === "system") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
