import { test, expect } from "@playwright/test";

const PREVIEW_URL = process.env.PREVIEW_URL;
if (!PREVIEW_URL) throw new Error("PREVIEW_URL is required");

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: PREVIEW_URL
  }).catch(() => {});
});

test("home ranking flow uses the demo dataset", async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });

  const rankingResponse = await page.request.get(
    new URL("/api/rankings?period=live", PREVIEW_URL).toString()
  );
  expect(rankingResponse.ok()).toBeTruthy();
  expect(rankingResponse.headers()["x-bobaks-demo"]).toBe("1");
  const body = await rankingResponse.json();
  expect(body.data).toHaveLength(30);

  await expect(page.getByRole("heading", { name: "Live Rankings" })).toBeVisible();
  await expect(page.locator(".rows .row")).toHaveCount(15);
  await expect(page.locator(".rows .row").first()).toContainText("Skybound Islands");

  await page.screenshot({
    path: "artifacts/preview-home-live.png",
    fullPage: true
  });
});

test("ranking periods, search, and game detail navigate correctly", async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "This Week", exact: true }).click();
  await expect(page).toHaveURL(/\/rankings\/weekly$/);
  await expect(page.getByRole("heading", { name: "This Week Rankings" })).toBeVisible();
  await expect(page.locator(".rows .row").first()).toContainText("Dungeon Clash");

  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });
  const search = page.locator("#search");
  await search.fill("Dragon");
  const result = page.locator("[data-search-game]").filter({ hasText: "Dragon Valley" });
  await expect(result).toHaveCount(1);
  await result.click();

  await expect(page).toHaveURL(/\/game\/1018$/);
  await expect(page.getByRole("heading", { name: "Dragon Valley" })).toBeVisible();
  await expect(page.locator(".stats")).toContainText("Current Players");
  await expect(page.locator(".stats")).toContainText("Recorded Peak");

  await page.screenshot({
    path: "artifacts/preview-game-detail.png",
    fullPage: true
  });
});

test("saved and compare flows persist within the session", async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });

  const firstRow = page.locator(".rows .row").first();
  const gameName = (await firstRow.locator(".game b").first().innerText()).replace(/★ #\d+$/, "").trim();

  await firstRow.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#savedCount")).toHaveText("(1)");

  await page.getByRole("button", { name: "Saved", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "Saved Games", exact: true })).toBeVisible();
  await expect(page.locator(".rows")).toContainText(gameName);

  await page.getByRole("button", { name: "Rankings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live Rankings" })).toBeVisible();

  await page.locator(".rows .row").first().getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator("#compareNav")).toBeVisible();
  await expect(page.locator("#compareNav")).toHaveText("Compare (1)");

  await page.locator("#compareNav").click();
  await expect(page.getByRole("heading", { name: "Compare Games" })).toBeVisible();
  await expect(page.locator(".compare")).toContainText(gameName);

  await page.screenshot({
    path: "artifacts/preview-saved-compare.png",
    fullPage: true
  });
});

test("game rank-card flow generates the real share modal", async ({ page }) => {
  await page.goto(PREVIEW_URL + "/game/1001", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Skybound Islands" })).toBeVisible();

  await page.getByRole("button", { name: "Share rank card", exact: true }).click();

  const modal = page.locator(".rank-card-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Your Game Rank Card" })).toBeVisible();
  const rankCard = modal.locator("canvas.rank-card-canvas");
  await expect(rankCard).toBeVisible();
  await expect(rankCard).toHaveAttribute(
    "aria-label",
    "Skybound Islands rank card, current players 48,210 and recorded peak 53,210"
  );
  await expect(modal.locator("[data-download]")).toBeVisible();
  await expect(modal.locator("[data-copy-caption]")).toBeVisible();
  await expect(modal.locator("[data-copy-link]")).toBeVisible();
  await expect(modal.locator("[data-platform='facebook']")).toBeVisible();
  await expect(modal.locator("[data-platform='discord']")).toBeVisible();

  await modal.locator("[data-copy-caption]").click();
  await expect(modal.locator(".rank-card-share-status")).toContainText(
    /Caption copied|Clipboard access is unavailable/
  );

  await page.screenshot({
    path: "artifacts/preview-rank-card-modal.png",
    fullPage: true
  });
});

test("theme and refresh controls work without losing the demo rankings", async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });

  const before = await page.locator("html").getAttribute("data-theme");
  await page.locator("#themeNav").click();
  const after = await page.locator("html").getAttribute("data-theme");
  expect(after).not.toBe(before);

  await page.locator("#refresh").click();
  await expect(page.locator(".rows .row")).toHaveCount(15);

  await expect(page.getByRole("button", { name: "Live", exact: true })).toHaveClass(/active/);
});
