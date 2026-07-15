import { expect, test, type Page } from "@playwright/test";

const completeBridgeConfig = {
  VITE_ETHEREUM_MAILBOX: "0x1000000000000000000000000000000000000001",
  VITE_BASE_MAILBOX: "0x1000000000000000000000000000000000000002",
  VITE_XPHERE_MAILBOX: "0x1000000000000000000000000000000000000003",
  VITE_ETHEREUM_NATIVE_WARP_ROUTER: "0x2000000000000000000000000000000000000001",
  VITE_BASE_NATIVE_WARP_ROUTER: "0x2000000000000000000000000000000000000002",
  VITE_XPHERE_NATIVE_WARP_ROUTER: "0x2000000000000000000000000000000000000003",
  VITE_ETHEREUM_USDC_WARP_ROUTER: "0x3000000000000000000000000000000000000001",
  VITE_BASE_USDC_WARP_ROUTER: "0x3000000000000000000000000000000000000002",
  VITE_XPHERE_USDC_WARP_ROUTER: "0x3000000000000000000000000000000000000003",
  VITE_XPHERE_XETH: "0x4000000000000000000000000000000000000001",
  VITE_XPHERE_XUSDC: "0x4000000000000000000000000000000000000002",
  VITE_BRIDGE_RELEASED: "false",
};

async function assertNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    panelRight: document.querySelector(".bridge-panel")?.getBoundingClientRect().right ?? 0,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

test("preserves the live swap dashboard and branding", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Xphere Swap" })).toBeVisible();
  await expect(page.locator(".brand-logo")).toHaveAttribute("src", "/xphereswap-icon.png");
  await expect
    .poll(() => page.locator(".brand-logo").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByRole("tab", { name: "Swap" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Liquidity" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bridge" })).toBeVisible();
  await expect(page.locator(".metric").filter({ hasText: "Live AMM" }).getByText("WXP/XEF pool")).toBeVisible();

  await page.getByRole("tab", { name: "Liquidity" }).click();
  await expect(page.getByLabel("Token A")).toHaveValue("XP");
  await expect(page.getByRole("button", { name: "Add liquidity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove liquidity" })).toBeVisible();
});

test("keeps the default bridge preview visibly not live and transaction-disabled", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Bridge" }).click();

  await expect(page.getByRole("heading", { name: "Bridge" })).toBeVisible();
  await expect(page.locator(".bridge-not-live")).toHaveText("Not live");
  await expect(page.getByText("Ethereum and Base routes are prepared for team review. Transactions are disabled.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Quote gas" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bridge not live" })).toBeDisabled();
  await expect(page.getByLabel("From")).toHaveValue("ethereum");
  await expect(page.getByLabel("To")).toHaveValue("xphere");

  await page.getByLabel("From").selectOption("base");
  await expect(page.getByLabel("To")).toHaveValue("xphere");
  await expect(page.getByLabel("To").locator("option")).toHaveCount(1);

  await page.getByLabel("From").selectOption("xphere");
  await expect(page.getByLabel("To").locator("option")).toHaveCount(2);
  await expect(page.getByLabel("To").locator('option[value="ethereum"]')).toHaveCount(1);
  await expect(page.getByLabel("To").locator('option[value="base"]')).toHaveCount(1);
  await page.getByLabel("To").selectOption("base");

  await expect(page.getByRole("group", { name: "Bridge asset" }).getByRole("button", { name: "ETH" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Bridge asset" }).getByRole("button", { name: "USDC" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("bridge-preview.png"), fullPage: true });
});

test("renders all configured route directions while release remains locked", async ({ page }, testInfo) => {
  await page.addInitScript((config) => {
    window.__XPHERE_BRIDGE_TEST_CONFIG__ = config;
  }, completeBridgeConfig);
  await page.goto("/");
  await page.getByRole("tab", { name: "Bridge" }).click();

  await expect(page.getByText("Route contracts are not deployed yet. Preview only.")).toHaveCount(0);
  await expect(page.locator(".bridge-not-live")).toHaveText("Not live");
  await expect(page.getByRole("button", { name: "Quote gas" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bridge not live" })).toBeDisabled();

  for (const source of ["ethereum", "base"] as const) {
    await page.getByLabel("From").selectOption(source);
    await expect(page.getByLabel("To")).toHaveValue("xphere");
  }
  await page.getByLabel("From").selectOption("xphere");
  for (const destination of ["ethereum", "base"] as const) {
    await page.getByLabel("To").selectOption(destination);
    await expect(page.getByLabel("To")).toHaveValue(destination);
  }

  await page.getByRole("group", { name: "Bridge asset" }).getByRole("button", { name: "USDC" }).click();
  await expect(page.locator(".bridge-route-card").getByText("xUSDC", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Bridge asset" }).getByRole("button", { name: "ETH" }).click();
  await expect(page.locator(".bridge-route-card").getByText("xETH", { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("bridge-configured-preview.png"), fullPage: true });
});
