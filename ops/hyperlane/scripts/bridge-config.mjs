import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const OPS_DIR = resolve(scriptDir, "..");
export const REPO_DIR = resolve(OPS_DIR, "../..");
export const DEPLOYMENTS_DIR = resolve(REPO_DIR, "deployments");
export const REGISTRY_DIR = resolve(OPS_DIR, ".registry");
export const WINDOWS_REGISTRY_DIR = "C:\\tmp\\xphere-hyperlane-registry";
export const ACTIVE_REGISTRY_DIR = process.platform === "win32" ? WINDOWS_REGISTRY_DIR : REGISTRY_DIR;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DAILY_CAP_UNITS = 24_999_926_400n;
export const TOTAL_TVL_CAP_USD = 100_000;
export const RATE_LIMIT_PERIOD_SECONDS = 86_400n;
export const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
export const SECURITY_APPLY_ACK = "I_UNDERSTAND_BRIDGE_SECURITY_APPLY";

export const CHAINS = {
  base: {
    name: "base",
    displayName: "Base Mainnet",
    chainId: 8453,
    domainId: 8453,
    artifact: "base-mainnet.local.json",
    exampleArtifact: "base-mainnet.example.json",
    metadata: "chains/base-mainnet.yaml",
    ownerEnv: "BASE_PROTOCOL_ADMIN_SAFE",
    rpcEnv: "BASE_MAINNET_RPC_URL",
    mailboxEnv: "BASE_MAILBOX",
    viteMailboxEnv: "VITE_BASE_MAILBOX",
    explorer: "https://basescan.org",
  },
  ethereum: {
    name: "ethereum",
    displayName: "Ethereum Mainnet",
    chainId: 1,
    domainId: 1,
    artifact: "ethereum-mainnet.local.json",
    exampleArtifact: "ethereum-mainnet.example.json",
    metadata: "chains/ethereum-mainnet.yaml",
    ownerEnv: "ETHEREUM_PROTOCOL_ADMIN_SAFE",
    rpcEnv: "ETHEREUM_MAINNET_RPC_URL",
    mailboxEnv: "ETHEREUM_MAILBOX",
    viteMailboxEnv: "VITE_ETHEREUM_MAILBOX",
    explorer: "https://etherscan.io",
  },
  xphere: {
    name: "xphere",
    displayName: "Xphere Mainnet",
    chainId: 20250217,
    domainId: 20250217,
    artifact: "xphere-mainnet.local.json",
    exampleArtifact: "xphere-mainnet.example.json",
    metadata: "chains/xphere-mainnet.yaml",
    ownerEnv: "XPHERE_PROTOCOL_ADMIN_SAFE",
    rpcEnv: "XPHERE_MAINNET_RPC_URL",
    mailboxEnv: "XPHERE_MAILBOX",
    viteMailboxEnv: "VITE_XPHERE_MAILBOX",
    explorer: "https://xp.tamsa.io",
  },
};

export const ROUTES = {
  eth: {
    key: "eth",
    asset: "ETH",
    id: "ETH/base-ethereum-xphere",
    template: "base-ethereum-xphere-eth.yaml",
    registryAsset: "ETH",
    deployName: "base-ethereum-xphere-deploy.yaml",
    generatedDeployName: "eth-base-ethereum-xphere-deploy.yaml",
    decimals: 18,
    xphereTokenKey: "xETH",
    tokenForChain: {
      base: "ETH",
      ethereum: "ETH",
      xphere: undefined,
    },
    symbolForChain: {
      base: "ETH",
      ethereum: "ETH",
      xphere: "xETH",
    },
    routerEnvForChain: {
      base: "VITE_BASE_NATIVE_WARP_ROUTER",
      ethereum: "VITE_ETHEREUM_NATIVE_WARP_ROUTER",
      xphere: "VITE_XPHERE_NATIVE_WARP_ROUTER",
    },
  },
  usdc: {
    key: "usdc",
    asset: "USDC",
    id: "USDC/base-ethereum-xphere",
    template: "base-ethereum-xphere-usdc.yaml",
    registryAsset: "USDC",
    deployName: "base-ethereum-xphere-deploy.yaml",
    generatedDeployName: "usdc-base-ethereum-xphere-deploy.yaml",
    decimals: 6,
    xphereTokenKey: "xUSDC",
    tokenForChain: {
      base: BASE_USDC,
      ethereum: ETHEREUM_USDC,
      xphere: undefined,
    },
    symbolForChain: {
      base: "USDC",
      ethereum: "USDC",
      xphere: "xUSDC",
    },
    routerEnvForChain: {
      base: "VITE_BASE_USDC_WARP_ROUTER",
      ethereum: "VITE_ETHEREUM_USDC_WARP_ROUTER",
      xphere: "VITE_XPHERE_USDC_WARP_ROUTER",
    },
  },
};

export function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) && normalized !== ZERO_ADDRESS;
}

export function isUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

export async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(REPO_DIR, ".env");
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

export async function readJson(relativePath) {
  const path = resolve(REPO_DIR, relativePath);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readArtifact(chainName) {
  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`Unknown chain ${chainName}`);
  const path = resolve(DEPLOYMENTS_DIR, chain.artifact);
  if (!existsSync(path)) {
    return {
      chainId: chain.chainId,
      contracts: {},
      tokens: chainName === "base" ? { USDC: BASE_USDC } : chainName === "ethereum" ? { USDC: ETHEREUM_USDC } : {},
      router: null,
      factory: null,
      initCodeHash: null,
      bridgeRoutes: {},
    };
  }
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeArtifact(chainName, artifact) {
  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`Unknown chain ${chainName}`);
  await mkdir(DEPLOYMENTS_DIR, { recursive: true });
  await writeFile(resolve(DEPLOYMENTS_DIR, chain.artifact), `${JSON.stringify(artifact, null, 2)}\n`);
}

export function validatorsFromEnv(env) {
  return [1, 2, 3].map((index) => env[`HYPERLANE_VALIDATOR_${index}`]);
}

export function validateUniqueAddresses(values, label) {
  if (!values.every(isAddress)) return `${label} must all be non-zero EVM addresses`;
  const unique = new Set(values.map((value) => value.toLowerCase()));
  if (unique.size !== values.length) return `${label} must use unique addresses`;
  return undefined;
}

export function bridgeOwnersFromEnv(env) {
  return Object.values(CHAINS).map((chain) => env[chain.ownerEnv]);
}

export function validateBridgeOperators(env) {
  return [
    validateUniqueAddresses(bridgeOwnersFromEnv(env), "Ethereum, Base, and Xphere route owners"),
    validateUniqueAddresses(validatorsFromEnv(env), "Hyperlane validators"),
  ].filter(Boolean);
}

export function initialIsmConfig(owner, validators) {
  return {
    type: "staticAggregationIsm",
    threshold: 2,
    modules: [
      {
        type: "messageIdMultisigIsm",
        threshold: 2,
        validators,
      },
      {
        type: "pausableIsm",
        owner,
        paused: false,
      },
    ],
  };
}

export function finalIsmConfig(owner, validators, maxCapacity, recipient, paused = false) {
  return {
    type: "staticAggregationIsm",
    threshold: 3,
    modules: [
      {
        type: "messageIdMultisigIsm",
        threshold: 2,
        validators,
      },
      {
        type: "pausableIsm",
        owner,
        paused,
      },
      {
        type: "rateLimitedIsm",
        maxCapacity: String(maxCapacity),
        recipient,
        owner,
      },
    ],
  };
}

export function ethDailyCap(env) {
  const raw = String(env.BRIDGE_ETH_DAILY_CAP_WEI || "");
  if (!/^\d+$/.test(raw)) return undefined;
  const value = BigInt(raw);
  if (value <= 0n || value % RATE_LIMIT_PERIOD_SECONDS !== 0n) return undefined;
  return value;
}

export function rateLimitForRoute(routeKey, env) {
  if (routeKey === "usdc") return USDC_DAILY_CAP_UNITS;
  if (routeKey === "eth") return ethDailyCap(env);
  return undefined;
}

export function normalizedRouteRecord({ chainName, routeKey, mailbox, router, token, ism, owner, remoteRouters, securityApplied = false }) {
  const route = ROUTES[routeKey];
  const remoteDomains = {};
  for (const remoteName of Object.keys(CHAINS)) {
    if (remoteName !== chainName) remoteDomains[remoteName] = CHAINS[remoteName].domainId;
  }
  return {
    standard: "hyperlane-warp-route",
    routeId: route.id,
    mailbox,
    router,
    token: token || route.tokenForChain[chainName],
    tokenSymbol: route.symbolForChain[chainName],
    interchainSecurityModule: ism,
    owner,
    securityApplied,
    remoteDomains,
    remoteRouters,
  };
}

export function routeComplete(artifact, routeKey, chainName, { requireSecurity = false } = {}) {
  const record = artifact?.bridgeRoutes?.[routeKey];
  const route = ROUTES[routeKey];
  if (!record || record.standard !== "hyperlane-warp-route" || record.routeId !== route.id) return false;
  if (!isAddress(record.mailbox) || !isAddress(record.router) || !isAddress(record.owner)) return false;
  const expectedToken = route.tokenForChain[chainName];
  if (expectedToken === "ETH" && record.token !== "ETH") return false;
  if (isAddress(expectedToken) && String(record.token).toLowerCase() !== expectedToken.toLowerCase()) return false;
  if (!expectedToken && !isAddress(record.token)) return false;
  const expectedRemotes = Object.keys(CHAINS).filter((name) => name !== chainName);
  if (!expectedRemotes.every((name) => record.remoteDomains?.[name] === CHAINS[name].domainId)) return false;
  if (!expectedRemotes.every((name) => isAddress(record.remoteRouters?.[name]))) return false;
  const routers = [record.router, ...expectedRemotes.map((name) => record.remoteRouters[name])];
  if (new Set(routers.map((router) => router.toLowerCase())).size !== routers.length) return false;
  if (requireSecurity && (!record.securityApplied || !isAddress(record.interchainSecurityModule))) return false;
  return true;
}

export function aggregateTvlUsd(routeValues) {
  return Object.values(routeValues).reduce(
    (total, chainValues) =>
      total + Object.values(chainValues).reduce((routeTotal, value) => routeTotal + BigInt(value), 0n),
    0n,
  );
}

export function bridgeReleaseFlagEnabled(env) {
  return env.VITE_BRIDGE_RELEASED === "true";
}

export function routeRegistryDirectory(route) {
  return resolve(ACTIVE_REGISTRY_DIR, "deployments", "warp_routes", route.registryAsset);
}
