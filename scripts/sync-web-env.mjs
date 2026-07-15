import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const mode = process.argv[2] || "local";

async function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

await loadDotEnv();

const configs = {
  local: {
    artifact: "deployments/localhost.local.json",
    bridgeArtifact: "deployments/local-ethereum.local.json",
    lines: (xphere, ethereum) => [
      "VITE_SWAP_CHAIN=localhost",
      "VITE_BRIDGE_MODE=local",
      "VITE_XPHERE_MAINNET_RPC_URL=",
      "VITE_XPHERE_TESTNET_RPC_URL=",
      `VITE_LOCAL_ROUTER=${xphere.contracts.router}`,
      `VITE_LOCAL_FACTORY=${xphere.contracts.factory}`,
      `VITE_LOCAL_WXP=${xphere.contracts.wXP}`,
      `VITE_LOCAL_XUSDC=${xphere.tokens.xUSDC}`,
      `VITE_LOCAL_XUSDT=${xphere.tokens.xUSDT}`,
      `VITE_LOCAL_XEF=${xphere.tokens.XEF || ""}`,
      `VITE_LOCAL_XPHERE_FAUCET=${xphere.contracts.localFaucet || ""}`,
      `VITE_LOCAL_ETHEREUM_USDC=${ethereum.tokens.USDC}`,
      `VITE_LOCAL_ETHEREUM_USDT=${ethereum.tokens.USDT}`,
      `VITE_LOCAL_ETHEREUM_USDC_BRIDGE_ROUTER=${ethereum.contracts.usdcRouter}`,
      `VITE_LOCAL_ETHEREUM_USDT_BRIDGE_ROUTER=${ethereum.contracts.usdtRouter}`,
      `VITE_LOCAL_ETHEREUM_NATIVE_BRIDGE_ROUTER=${ethereum.contracts.nativeBridgeRouter || ""}`,
      `VITE_LOCAL_ETHEREUM_FAUCET=${ethereum.contracts.localFaucet || ""}`,
      `VITE_LOCAL_XPHERE_USDC_BRIDGE_ROUTER=${xphere.contracts.usdcBridgeRouter}`,
      `VITE_LOCAL_XPHERE_USDT_BRIDGE_ROUTER=${xphere.contracts.usdtBridgeRouter}`,
      `VITE_LOCAL_XPHERE_NATIVE_BRIDGE_ROUTER=${xphere.contracts.nativeBridgeRouter || ""}`,
    ],
  },
  "xphere-testnet": {
    artifact: "deployments/xphere-testnet.local.json",
    lines: (xphere) => [
      "VITE_SWAP_CHAIN=xphere-testnet",
      "VITE_BRIDGE_MODE=",
      "VITE_XPHERE_MAINNET_RPC_URL=",
      `VITE_XPHERE_TESTNET_RPC_URL=${process.env.XPHERE_TESTNET_RPC_URL || process.env.VITE_XPHERE_TESTNET_RPC_URL || ""}`,
      `VITE_XPHERE_ROUTER=${xphere.contracts.router}`,
      `VITE_XPHERE_FACTORY=${xphere.contracts.factory}`,
      `VITE_XPHERE_WXP=${xphere.contracts.wXP}`,
      `VITE_XPHERE_XUSDC=${xphere.tokens.xUSDC || process.env.XPHERE_XUSDC_TOKEN || process.env.VITE_XPHERE_XUSDC || ""}`,
      `VITE_XPHERE_XETH=${xphere.tokens.xETH || ""}`,
      `VITE_XPHERE_XEF=${xphere.tokens.XEF || ""}`,
    ],
  },
  "xphere-mainnet": {
    artifact: "deployments/xphere-mainnet.local.json",
    bridgeArtifact: "deployments/ethereum-mainnet.local.json",
    optionalBridgeArtifact: true,
    tertiaryArtifact: "deployments/base-mainnet.local.json",
    optionalTertiaryArtifact: true,
    lines: (xphere, ethereum, base) => [
      "VITE_SWAP_CHAIN=",
      "VITE_BRIDGE_MODE=",
      `VITE_BRIDGE_RELEASED=${process.env.VITE_BRIDGE_RELEASED === "true" ? "true" : "false"}`,
      `VITE_XPHERE_MAINNET_RPC_URL=${process.env.XPHERE_MAINNET_RPC_URL || process.env.VITE_XPHERE_MAINNET_RPC_URL || ""}`,
      `VITE_XPHERE_TESTNET_RPC_URL=${process.env.XPHERE_TESTNET_RPC_URL || process.env.VITE_XPHERE_TESTNET_RPC_URL || ""}`,
      `VITE_ETHEREUM_MAINNET_RPC_URL=${process.env.ETHEREUM_MAINNET_RPC_URL || process.env.VITE_ETHEREUM_MAINNET_RPC_URL || ""}`,
      `VITE_BASE_MAINNET_RPC_URL=${process.env.BASE_MAINNET_RPC_URL || process.env.VITE_BASE_MAINNET_RPC_URL || ""}`,
      `VITE_XPHERE_ROUTER=${xphere.contracts.router}`,
      `VITE_XPHERE_FACTORY=${xphere.contracts.factory}`,
      `VITE_XPHERE_WXP=${xphere.contracts.wXP}`,
      `VITE_XPHERE_XUSDC=${xphere.tokens.xUSDC || process.env.XPHERE_XUSDC_TOKEN || process.env.VITE_XPHERE_XUSDC || ""}`,
      `VITE_XPHERE_XETH=${xphere.tokens.xETH || process.env.XPHERE_XETH_TOKEN || process.env.VITE_XPHERE_XETH || ""}`,
      `VITE_XPHERE_XEF=${xphere.tokens.XEF || ""}`,
      `VITE_XEF_OFFICIAL_VERIFIED=${process.env.VITE_XEF_OFFICIAL_VERIFIED || "false"}`,
      `VITE_ETHEREUM_USDC_WARP_ROUTER=${ethereum?.bridgeRoutes?.usdc?.router || process.env.VITE_ETHEREUM_USDC_WARP_ROUTER || ""}`,
      `VITE_XPHERE_USDC_WARP_ROUTER=${xphere?.bridgeRoutes?.usdc?.router || process.env.VITE_XPHERE_USDC_WARP_ROUTER || ""}`,
      `VITE_BASE_USDC_WARP_ROUTER=${base?.bridgeRoutes?.usdc?.router || process.env.VITE_BASE_USDC_WARP_ROUTER || ""}`,
      `VITE_ETHEREUM_NATIVE_WARP_ROUTER=${ethereum?.bridgeRoutes?.eth?.router || process.env.VITE_ETHEREUM_NATIVE_WARP_ROUTER || ""}`,
      `VITE_XPHERE_NATIVE_WARP_ROUTER=${xphere?.bridgeRoutes?.eth?.router || process.env.VITE_XPHERE_NATIVE_WARP_ROUTER || ""}`,
      `VITE_BASE_NATIVE_WARP_ROUTER=${base?.bridgeRoutes?.eth?.router || process.env.VITE_BASE_NATIVE_WARP_ROUTER || ""}`,
      `VITE_ETHEREUM_MAILBOX=${ethereum?.bridgeRoutes?.eth?.mailbox || ethereum?.contracts?.hyperlaneMailbox || process.env.ETHEREUM_MAILBOX || process.env.VITE_ETHEREUM_MAILBOX || ""}`,
      `VITE_BASE_MAILBOX=${base?.bridgeRoutes?.eth?.mailbox || base?.contracts?.hyperlaneMailbox || process.env.BASE_MAILBOX || process.env.VITE_BASE_MAILBOX || ""}`,
      `VITE_XPHERE_MAILBOX=${xphere?.bridgeRoutes?.eth?.mailbox || xphere?.contracts?.hyperlaneMailbox || process.env.XPHERE_MAILBOX || process.env.VITE_XPHERE_MAILBOX || ""}`,
    ],
  },
};

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

const config = configs[mode];
if (!config) {
  console.error(`Unknown mode ${mode}. Expected one of: ${Object.keys(configs).join(", ")}`);
  process.exit(1);
}
const walletConnectProjectId = process.env.VITE_WALLETCONNECT_PROJECT_ID || "";

const primary = await readJson(config.artifact);
const secondary = config.bridgeArtifact
  ? config.optionalBridgeArtifact
    ? await readOptionalJson(config.bridgeArtifact)
    : await readJson(config.bridgeArtifact)
  : undefined;
const tertiary = config.tertiaryArtifact
  ? config.optionalTertiaryArtifact
    ? await readOptionalJson(config.tertiaryArtifact)
    : await readJson(config.tertiaryArtifact)
  : undefined;
const lines = [
  `# Auto-generated by pnpm sync:web-env:${mode}`,
  ...config.lines(primary, secondary, tertiary),
  `VITE_WALLETCONNECT_PROJECT_ID=${walletConnectProjectId}`,
  "",
];

await writeFile(resolve(process.cwd(), "apps/web/.env.local"), lines.join("\n"));
console.log(`Wrote apps/web/.env.local for ${mode}.`);
