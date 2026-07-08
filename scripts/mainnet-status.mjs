import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = process.cwd();
const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);
const ZERO = "0x0000000000000000000000000000000000000000";

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) && String(value).toLowerCase() !== ZERO;
}

function isPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

function isUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return env;
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || env[match[1]] !== undefined) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function readJson(relativePath) {
  const path = resolve(ROOT, relativePath);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

function stateLine(status, label, detail) {
  console.log(`[${status}] ${label}${detail ? ` - ${detail}` : ""}`);
}

function line(ready, label, detail) {
  stateLine(ready ? "READY" : "NEEDED", label, detail);
}

function addressLine(value, label) {
  line(isAddress(value), label, isAddress(value) ? value : "missing");
}

function bootstrapAddressLine(env, value, label) {
  if (isAddress(value)) {
    stateLine("READY", label, value);
    return;
  }
  if (env.ALLOW_ETHEREUM_PROTOCOL_MULTISIG === "true") {
    stateLine("PENDING", label, "will be deployed by mainnet admin bootstrap");
    return;
  }
  stateLine("NEEDED", label, "missing");
}

function xphereMainnetRpcLine(value) {
  if (!isUrl(value)) {
    line(false, "XPHERE_MAINNET_RPC_URL", "missing");
    return;
  }
  if (PUBLIC_XPHERE_RPCS.has(value)) {
    line(false, "XPHERE_MAINNET_RPC_URL", `${value} (public RPC is dev-only; use a dedicated endpoint for beta)`);
    return;
  }
  line(true, "XPHERE_MAINNET_RPC_URL", value);
}

async function main() {
  const env = await readEnv();
  const xphere = await readJson("deployments/xphere-mainnet.local.json");
  const ethereum = await readJson("deployments/ethereum-mainnet.local.json");

  console.log("Mainnet Operator Status");
  console.log("");
  console.log("1. Wallets and RPCs");
  line(isPrivateKey(env.DEPLOYER_PRIVATE_KEY), "DEPLOYER_PRIVATE_KEY", isPrivateKey(env.DEPLOYER_PRIVATE_KEY) ? "set" : "missing in .env");
  xphereMainnetRpcLine(env.XPHERE_MAINNET_RPC_URL);
  line(isUrl(env.ETHEREUM_MAINNET_RPC_URL), "ETHEREUM_MAINNET_RPC_URL", env.ETHEREUM_MAINNET_RPC_URL || "missing");
  line(
    isUrl(env.SEPOLIA_RPC_URL) || env.SKIP_SEPOLIA_REHEARSAL === "true",
    "SEPOLIA_RPC_URL",
    isUrl(env.SEPOLIA_RPC_URL)
      ? env.SEPOLIA_RPC_URL
      : env.SKIP_SEPOLIA_REHEARSAL === "true"
        ? "skipped by operator"
        : "missing",
  );
  line(env.MAINNET_BETA_ACK === MAINNET_ACK, "MAINNET_BETA_ACK", env.MAINNET_BETA_ACK || "missing");

  console.log("");
  console.log("2. Safe and operators");
  bootstrapAddressLine(env, env.PROTOCOL_ADMIN_SAFE, "PROTOCOL_ADMIN_SAFE");
  bootstrapAddressLine(env, env.TREASURY_SAFE, "TREASURY_SAFE");
  addressLine(env.XPHERE_PROTOCOL_ADMIN_SAFE || xphere?.contracts?.protocolAdminMultisig, "XPHERE_PROTOCOL_ADMIN_SAFE");
  addressLine(env.XPHERE_TREASURY_SAFE || xphere?.contracts?.treasuryMultisig, "XPHERE_TREASURY_SAFE");
  for (let index = 1; index <= 5; index += 1) addressLine(env[`SAFE_OWNER_${index}`], `SAFE_OWNER_${index}`);
  line(env.SAFE_THRESHOLD === "3", "SAFE_THRESHOLD", env.SAFE_THRESHOLD || "missing");
  for (let index = 1; index <= 3; index += 1) addressLine(env[`HYPERLANE_VALIDATOR_${index}`], `HYPERLANE_VALIDATOR_${index}`);
  addressLine(env.HYPERLANE_RELAYER_ADDRESS, "HYPERLANE_RELAYER_ADDRESS");
  line(env.BRIDGE_CAPS_ACTIVE === "true", "BRIDGE_CAPS_ACTIVE", env.BRIDGE_CAPS_ACTIVE || "missing");
  line(
    Boolean(env.BRIDGE_CAPS_LAST_REVIEWED_AT && !Number.isNaN(new Date(env.BRIDGE_CAPS_LAST_REVIEWED_AT).getTime())),
    "BRIDGE_CAPS_LAST_REVIEWED_AT",
    env.BRIDGE_CAPS_LAST_REVIEWED_AT || "missing",
  );

  console.log("");
  console.log("3. Hyperlane core and routes");
  addressLine(xphere?.contracts?.hyperlaneMailbox, "Xphere Mailbox");
  addressLine(xphere?.contracts?.hyperlaneInterchainGasPaymaster, "Xphere InterchainGasPaymaster");
  addressLine(xphere?.contracts?.hyperlaneValidatorAnnounce, "Xphere ValidatorAnnounce");
  addressLine(xphere?.contracts?.hyperlaneInterchainSecurityModule, "Xphere ISM");
  addressLine(ethereum?.bridgeRoutes?.["xphere-usdc"]?.sourceRouter || env.VITE_ETHEREUM_USDC_WARP_ROUTER, "Ethereum USDC router");
  addressLine(xphere?.bridgeRoutes?.["ethereum-usdc"]?.destinationRouter || env.VITE_XPHERE_USDC_WARP_ROUTER, "Xphere USDC router");
  addressLine(xphere?.tokens?.xUSDC || env.XPHERE_XUSDC_TOKEN || env.VITE_XPHERE_XUSDC, "Xphere xUSDC token");
  addressLine(ethereum?.bridgeRoutes?.["xphere-usdt"]?.sourceRouter || env.VITE_ETHEREUM_USDT_WARP_ROUTER, "Ethereum USDT router");
  addressLine(xphere?.bridgeRoutes?.["ethereum-usdt"]?.destinationRouter || env.VITE_XPHERE_USDT_WARP_ROUTER, "Xphere USDT router");
  addressLine(xphere?.tokens?.xUSDT || env.XPHERE_XUSDT_TOKEN || env.VITE_XPHERE_XUSDT, "Xphere xUSDT token");
  addressLine(ethereum?.bridgeRoutes?.["xphere-native"]?.sourceRouter || env.VITE_ETHEREUM_NATIVE_WARP_ROUTER, "Ethereum ETH router");
  addressLine(xphere?.bridgeRoutes?.["ethereum-native"]?.destinationRouter || env.VITE_XPHERE_NATIVE_WARP_ROUTER, "Xphere xETH router");
  addressLine(xphere?.tokens?.xETH || env.XPHERE_XETH_TOKEN || env.VITE_XPHERE_XETH, "Xphere xETH token");

  console.log("");
  console.log("4. Swap deployment");
  addressLine(xphere?.contracts?.wXP || env.VITE_XPHERE_WXP, "WXP");
  addressLine(xphere?.contracts?.factory || env.VITE_XPHERE_FACTORY, "Factory");
  addressLine(xphere?.contracts?.router || env.VITE_XPHERE_ROUTER, "Router");
  addressLine(xphere?.contracts?.multicall3 || env.VITE_XPHERE_MULTICALL3, "Multicall3");

  console.log("");
  console.log("Next useful commands:");
  console.log("- pnpm mainnet:set --file docs/operator-values.local.json");
  console.log("- pnpm mainnet:probe");
  console.log("- pnpm mainnet:funding");
  console.log("- pnpm bridge:prepare-registry");
  console.log("- pnpm bridge:core:deploy");
  console.log("- pnpm bridge:record-core --mailbox 0x... --interchain-gas-paymaster 0x... --validator-announce 0x... --interchain-security-module 0x...");
  console.log("- pnpm bridge:record-route usdc --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...");
  console.log("- pnpm bridge:record-route native --ethereum-router 0x... --xphere-router 0x... --xphere-token 0xXethToken");
  console.log("- pnpm deploy:xphere-mainnet");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
