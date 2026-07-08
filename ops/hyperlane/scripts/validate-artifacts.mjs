import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "../../..");

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

async function readJson(relativePath, required = false) {
  const path = resolve(repoDir, relativePath);
  if (!existsSync(path)) {
    if (required) fail(`${relativePath}: missing`);
    else warn(`${relativePath}: not present`);
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

async function readEnvLocal() {
  const path = resolve(repoDir, "apps/web/.env.local");
  if (!existsSync(path)) return {};
  const env = {};
  const raw = await readFile(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function requireAddress(object, path) {
  const value = path.split(".").reduce((item, key) => item?.[key], object);
  if (!isAddress(value)) fail(`${path}: missing or invalid address`);
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

function validateLocalXphere(artifact) {
  if (!artifact) return;
  requireEqual(artifact.chainId, 31337, "deployments/localhost.local.json chainId");
  for (const path of [
    "contracts.wXP",
    "contracts.factory",
    "contracts.router",
    "contracts.multicall3",
    "contracts.usdcBridgeRouter",
    "contracts.usdtBridgeRouter",
    "contracts.nativeBridgeRouter",
    "tokens.xUSDC",
    "tokens.xUSDT",
    "tokens.XEF",
  ]) {
    requireAddress(artifact, path);
  }

  for (const route of ["localUsdc", "localUsdt"]) {
    const config = artifact.bridgeRoutes?.[route];
    if (!config) {
      fail(`bridgeRoutes.${route}: missing`);
      continue;
    }
    if (!isAddress(config.router)) fail(`bridgeRoutes.${route}.router: missing or invalid address`);
    if (!isAddress(config.token)) fail(`bridgeRoutes.${route}.token: missing or invalid address`);
    requireEqual(config.remoteDomain, 31338, `bridgeRoutes.${route}.remoteDomain`);
  }

  const native = artifact.bridgeRoutes?.localNative;
  if (!native) {
    fail("bridgeRoutes.localNative: missing");
  } else {
    if (!isAddress(native.router)) fail("bridgeRoutes.localNative.router: missing or invalid address");
    requireEqual(native.token, "XP", "bridgeRoutes.localNative.token");
    requireEqual(native.remoteToken, "ETH", "bridgeRoutes.localNative.remoteToken");
    requireEqual(native.remoteDomain, 31338, "bridgeRoutes.localNative.remoteDomain");
  }
}

function validateLocalEthereum(artifact) {
  if (!artifact) return;
  requireEqual(artifact.chainId, 31338, "deployments/local-ethereum.local.json chainId");
  for (const path of ["contracts.usdcRouter", "contracts.usdtRouter", "contracts.nativeBridgeRouter", "tokens.USDC", "tokens.USDT"]) {
    requireAddress(artifact, path);
  }

  for (const route of ["localUsdc", "localUsdt"]) {
    const config = artifact.bridgeRoutes?.[route];
    if (!config) {
      fail(`local-ethereum bridgeRoutes.${route}: missing`);
      continue;
    }
    if (!isAddress(config.router)) fail(`local-ethereum bridgeRoutes.${route}.router: missing or invalid address`);
    if (!isAddress(config.token)) fail(`local-ethereum bridgeRoutes.${route}.token: missing or invalid address`);
    requireEqual(config.remoteDomain, 31337, `local-ethereum bridgeRoutes.${route}.remoteDomain`);
  }

  const native = artifact.bridgeRoutes?.localNative;
  if (!native) {
    fail("local-ethereum bridgeRoutes.localNative: missing");
  } else {
    if (!isAddress(native.router)) fail("local-ethereum bridgeRoutes.localNative.router: missing or invalid address");
    requireEqual(native.token, "ETH", "local-ethereum bridgeRoutes.localNative.token");
    requireEqual(native.remoteToken, "XP", "local-ethereum bridgeRoutes.localNative.remoteToken");
    requireEqual(native.remoteDomain, 31337, "local-ethereum bridgeRoutes.localNative.remoteDomain");
  }
}

function validateEnv(env, xphere, ethereum) {
  if (Object.keys(env).length === 0) {
    warn("apps/web/.env.local: missing, local frontend may not be configured");
    return;
  }

  if (env.VITE_SWAP_CHAIN === "localhost") {
    requireEqual(env.VITE_LOCAL_ROUTER, xphere?.contracts?.router, "VITE_LOCAL_ROUTER");
    requireEqual(env.VITE_LOCAL_FACTORY, xphere?.contracts?.factory, "VITE_LOCAL_FACTORY");
    requireEqual(env.VITE_LOCAL_WXP, xphere?.contracts?.wXP, "VITE_LOCAL_WXP");
    requireEqual(env.VITE_LOCAL_XUSDC, xphere?.tokens?.xUSDC, "VITE_LOCAL_XUSDC");
    requireEqual(env.VITE_LOCAL_XUSDT, xphere?.tokens?.xUSDT, "VITE_LOCAL_XUSDT");
    requireEqual(env.VITE_LOCAL_XEF, xphere?.tokens?.XEF, "VITE_LOCAL_XEF");
  }

  if (env.VITE_BRIDGE_MODE === "local") {
    requireEqual(env.VITE_LOCAL_ETHEREUM_USDC, ethereum?.tokens?.USDC, "VITE_LOCAL_ETHEREUM_USDC");
    requireEqual(env.VITE_LOCAL_ETHEREUM_USDT, ethereum?.tokens?.USDT, "VITE_LOCAL_ETHEREUM_USDT");
    requireEqual(
      env.VITE_LOCAL_ETHEREUM_USDC_BRIDGE_ROUTER,
      ethereum?.contracts?.usdcRouter,
      "VITE_LOCAL_ETHEREUM_USDC_BRIDGE_ROUTER",
    );
    requireEqual(
      env.VITE_LOCAL_ETHEREUM_USDT_BRIDGE_ROUTER,
      ethereum?.contracts?.usdtRouter,
      "VITE_LOCAL_ETHEREUM_USDT_BRIDGE_ROUTER",
    );
    requireEqual(
      env.VITE_LOCAL_ETHEREUM_NATIVE_BRIDGE_ROUTER,
      ethereum?.contracts?.nativeBridgeRouter,
      "VITE_LOCAL_ETHEREUM_NATIVE_BRIDGE_ROUTER",
    );
    requireEqual(
      env.VITE_LOCAL_XPHERE_USDC_BRIDGE_ROUTER,
      xphere?.contracts?.usdcBridgeRouter,
      "VITE_LOCAL_XPHERE_USDC_BRIDGE_ROUTER",
    );
    requireEqual(
      env.VITE_LOCAL_XPHERE_USDT_BRIDGE_ROUTER,
      xphere?.contracts?.usdtBridgeRouter,
      "VITE_LOCAL_XPHERE_USDT_BRIDGE_ROUTER",
    );
    requireEqual(
      env.VITE_LOCAL_XPHERE_NATIVE_BRIDGE_ROUTER,
      xphere?.contracts?.nativeBridgeRouter,
      "VITE_LOCAL_XPHERE_NATIVE_BRIDGE_ROUTER",
    );
  }
}

async function main() {
  const xphere = await readJson("deployments/localhost.local.json");
  const ethereum = await readJson("deployments/local-ethereum.local.json");
  const env = await readEnvLocal();

  validateLocalXphere(xphere);
  validateLocalEthereum(ethereum);
  validateEnv(env, xphere, ethereum);

  if (warnings.length > 0) {
    console.warn(`Artifact validation warnings (${warnings.length}):`);
    for (const warning of warnings) console.warn(`- ${warning}`);
  }

  if (failures.length > 0) {
    console.error(`Artifact validation failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Deployment artifact validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
