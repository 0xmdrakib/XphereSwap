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
    panelRight: document.querySelector(".panel")?.getBoundingClientRect().right ?? 0,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function assertMobileTouchTargets(page: Page) {
  const undersized = await page.locator("button:visible, a.link-button:visible").evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
          height: rect.height,
          width: rect.width,
        };
      })
      .filter(({ label, height, width }) => !/Max|25%|50%|75%/i.test(label) && (height < 39 || width < 30)),
  );
  expect(undersized).toEqual([]);
}

async function installMockInjectedWallet(page: Page, name: string, rdns: string, account: string) {
  await page.addInitScript(
    ({ walletName, walletRdns, walletAccount }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let connected = false;
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === "wallet_requestPermissions") {
            throw Object.assign(new Error("Method not supported"), { code: -32601 });
          }
          if (method === "eth_requestAccounts") {
            connected = true;
            return [walletAccount];
          }
          if (method === "eth_accounts") return connected ? [walletAccount] : [];
          if (method === "eth_chainId") return "0x1";
          if (method === "wallet_revokePermissions") {
            connected = false;
            return null;
          }
          return null;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const eventListeners = listeners.get(event) ?? new Set();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        },
        removeListener: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(listener);
        },
      };
      const icon = `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#cc785c"/><circle cx="16" cy="16" r="7" fill="white"/></svg>`,
      )}`;
      const detail = {
        info: {
          uuid: crypto.randomUUID(),
          name: walletName,
          icon,
          rdns: walletRdns,
        },
        provider,
      };
      const announce = () => {
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      };
      window.addEventListener("eip6963:requestProvider", announce);
      queueMicrotask(announce);
    },
    { walletName: name, walletRdns: rdns, walletAccount: account },
  );
}

test("preserves the live swap dashboard and branding", async ({ page }, testInfo) => {
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

  await page.getByRole("tab", { name: "Status" }).click();
  await expect(page.getByText("Demo faucets")).toHaveCount(0);
  await expect(page.locator(".status-grid .ready-item span")).toHaveText([
    "Swap contracts",
    "XEF configured",
    "Bridge route records",
    "Bridge public state",
  ]);
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("status-readiness.png"), fullPage: true });
});

test("lists injected wallets and disconnects from the power control", async ({ page }, testInfo) => {
  await installMockInjectedWallet(
    page,
    "Phantom",
    "app.phantom.xphereswap-test",
    "0xdE5700000000000000000000000000000000C25D",
  );
  await installMockInjectedWallet(
    page,
    "Keplr",
    "app.keplr.xphereswap-test",
    "0x8b230000000000000000000000000000000093E1",
  );
  await page.goto("/");

  await page.getByRole("button", { name: "Connect Wallet" }).click();
  const chooser = page.getByRole("dialog", { name: "Choose wallet" });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Phantom/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Keplr/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /WalletConnect Open WalletConnect/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("wallet-chooser.png"), fullPage: false });
  await chooser.getByRole("button", { name: /Phantom/ }).click();

  const connectedWallet = page.getByRole("group", { name: /Connected wallet 0xde57\.\.\.c25d/i });
  await expect(connectedWallet).toBeVisible();
  await expect(connectedWallet).toHaveCSS("background-color", "rgb(255, 253, 250)");
  await expect(connectedWallet.locator(".wallet-address")).toHaveCSS("color", "rgb(37, 37, 35)");
  const disconnectButton = page.getByRole("button", { name: "Disconnect wallet" });
  await expect(disconnectButton).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("connected-wallet-pill.png"), fullPage: false });
  await disconnectButton.click();
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();

  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByRole("dialog", { name: "Choose wallet" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Choose wallet" })).toBeHidden();
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

for (const viewport of [
  { name: "phone-320", width: 320, height: 720 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "pixel-7", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-834", width: 834, height: 1112 },
  { name: "desktop-1440", width: 1440, height: 900 },
]) {
  test(`keeps every workspace responsive at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    if (viewport.width <= 760) {
      const header = page.locator(".topbar");
      await expect(header).toHaveCSS("display", "grid");
      expect((await header.boundingBox())?.height ?? 999).toBeLessThanOrEqual(124);
      await expect(page.locator(".topnav-link svg").first()).toBeVisible();
    } else if (viewport.width >= 1024) {
      await expect(page.locator(".topnav-link svg").first()).toBeHidden();
      expect((await page.locator(".topbar").boundingBox())?.height ?? 0).toBeLessThanOrEqual(70);
    }

    for (const tab of ["Swap", "Liquidity", "Bridge", "Status"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("heading", { name: tab, exact: true })).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }

    if (viewport.width <= 760) await assertMobileTouchTargets(page);
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-status.png`), fullPage: true });
  });
}

test("renders the wallet chooser as a safe mobile bottom sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installMockInjectedWallet(
    page,
    "Phantom",
    "app.phantom.xphereswap-mobile-test",
    "0xdE5700000000000000000000000000000000C25D",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  const chooser = page.getByRole("dialog", { name: "Choose wallet" });
  await expect(chooser).toBeVisible();
  const layout = await chooser.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottomGap: window.innerHeight - rect.bottom,
      height: rect.height,
      viewportHeight: window.innerHeight,
      overflowY: getComputedStyle(element.querySelector(".wallet-option-list")!).overflowY,
    };
  });
  expect(layout.bottomGap).toBeLessThanOrEqual(1);
  expect(layout.height).toBeLessThanOrEqual(layout.viewportHeight * 0.93);
  expect(layout.overflowY).toBe("auto");
  await assertNoHorizontalOverflow(page);

  await page.keyboard.press("Escape");
  await expect(chooser).toBeHidden();
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeFocused();
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.screenshot({ path: testInfo.outputPath("mobile-wallet-bottom-sheet.png"), fullPage: false });
});
