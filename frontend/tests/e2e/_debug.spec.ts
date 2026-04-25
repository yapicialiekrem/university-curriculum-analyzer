import { test } from "@playwright/test";

test("debug — errors in dev", async ({ page }) => {
  page.on("pageerror", (e) => console.log("PAGE ERR:", e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("ERR:", msg.text().slice(0, 400));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  const dataTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("dataTheme:", dataTheme);
});
