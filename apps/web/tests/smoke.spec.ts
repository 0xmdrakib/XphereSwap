import { expect, test } from "@playwright/test";

test("renders the operational dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Xphere Swap" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Swap" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Liquidity" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bridge" })).toBeVisible();
  await expect(page.locator(".metric").filter({ hasText: "Live AMM" }).getByText("WXP/XEF pool")).toBeVisible();
  await expect(page.getByText("Balance:").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Max" })).toBeVisible();

  await page.getByRole("tab", { name: "Liquidity" }).click();
  await expect(page.getByLabel("Token A")).toHaveValue("XP");
  await expect(page.getByRole("button", { name: "Add liquidity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove liquidity" })).toBeVisible();

  await page.getByRole("tab", { name: "Bridge" }).click();
  await expect(page.getByText(/Hyperlane Warp|Local lock\/mint demo/)).toBeVisible();
  await expect(page.getByLabel("Asset").locator("option", { hasText: "ETH" })).toHaveCount(1);
  await expect(page.getByText("Bridge routes are staged for Hyperlane rollout.")).toBeVisible();

  await page.getByRole("tab", { name: "Status" }).click();
  const statusItems = page.locator(".primary-column .ready-item");
  await expect(statusItems.filter({ hasText: "Swap contracts" }).getByText("Ready")).toBeVisible();
  await expect(statusItems.filter({ hasText: "XEF configured" }).getByText("Ready")).toBeVisible();
  await expect(statusItems.filter({ hasText: "Ethereum USDC route" }).getByText("Blocked")).toBeVisible();
  await expect(statusItems.filter({ hasText: "ETH/xETH route" }).getByText("Blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Wrap XP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import token" })).toBeVisible();
});
