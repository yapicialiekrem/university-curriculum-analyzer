import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — visual regression smoke tests.
 *
 * Çalıştırmadan önce backend (port 8000) + frontend dev (port 3000)
 * ayrı başlatılmalı, ya da `webServer` ile auto-start. Bu kurulumda
 * webServer ayağa kaldırıyor — testler local'de hızlı çalışsın.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  expect: {
    // Snapshot'larda küçük antialias farkları için tolere
    toMatchSnapshot: { maxDiffPixelRatio: 0.05 },
    toHaveScreenshot: { maxDiffPixelRatio: 0.05 },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    locale: "tr-TR",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-mobile",
      // iPhone 14 yerine "Pixel 5" — Chromium tabanlı, ek WebKit kurulumu
      // gerekmez. Mobil viewport + touch davranışı korunur.
      use: { ...devices["Pixel 5"] },
    },
  ],
  // webServer auto-start (test komutları zaten çalışıyorsa skip edilir)
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3000",
        timeout: 60_000,
        reuseExistingServer: true,
      },
});
