/**
 * Visual regression + a11y smoke tests.
 *
 * Backend canlı olmazsa SWR fetch'leri başarısız olur ama sayfanın
 * temel yapısı yine render edilir (skeleton/empty state). Testler buna
 * göre toleranslı yazılmıştır — DOM elementlerinin var olduğunu
 * kontrol ediyoruz, içerik bağımlı değil.
 */

import { expect, test } from "@playwright/test";

test.describe("Smoke", () => {
  test("/ — Layer 1 mounts", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("yan yana");
    await expect(page.getByRole("group", { name: "Seçili üniversiteler" })).toBeVisible();
    await expect(page.getByRole("tablist")).toBeVisible();
    // Radar veya skeleton'u
    await expect(page.locator('[data-testid="category-radar"], .skeleton').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("/deep-analysis — Layer 3 mounts", async ({ page }) => {
    await page.goto("/deep-analysis");
    await expect(page.locator("h1")).toContainText("çekirdeği");
  });

  test("Chat panel — pill açılır, modal görünür", async ({ page }) => {
    await page.goto("/");
    const pill = page.getByRole("button", { name: /müfredat asistan/i });
    await expect(pill).toBeVisible();
    await pill.click();
    // Framer Motion'ın initial state'i opacity:0; "attached" yeterli
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached({ timeout: 5000 });
    // Asistan başlığı görünmeli
    await expect(page.getByText("Asistan").first()).toBeVisible({ timeout: 3000 });
    // ESC ile kapanır (animation çıkar)
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 2000 });
  });

  test("Chat — '/' kısayolu modal açar", async ({ page }) => {
    await page.goto("/");
    await page.click("body");
    await page.keyboard.press("/");
    await expect(page.locator('[role="dialog"]')).toBeAttached({ timeout: 3000 });
  });

  test("URL state — üni seçimi query'de kalır", async ({ page }) => {
    await page.goto("/?a=metu&b=ege");
    await expect(page).toHaveURL(/a=metu/);
    await expect(page).toHaveURL(/b=ege/);
  });

  test("Tema toggle — dark / light geçişi", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    // ThemeProvider mount sonrası data-theme set olur
    await expect(html).toHaveAttribute("data-theme", /^(light|dark)$/, { timeout: 3000 });
    const before = await html.getAttribute("data-theme");
    const toggle = page.getByRole("button", { name: /tema/i });
    await toggle.click();
    const after = await html.getAttribute("data-theme");
    expect(after).not.toBe(before);
    expect(after).toMatch(/^(light|dark)$/);
  });
});
