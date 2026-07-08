import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const opsDir = resolve(scriptDir, "..");
const repoDir = resolve(opsDir, "..", "..");
const deploymentsDir = resolve(repoDir, "deployments");
const repoRegistryDir = resolve(opsDir, ".registry");
const windowsRegistryDir = "C:\\tmp\\xphere-hyperlane-registry";

const routeDefs = {
  USDC: {
    routeName: "usdc",
    symbol: "USDC",
    xSymbol: "xUSDC",
    tokenKey: "xUSDC",
    ethereumTokenKey: "USDC",
    ethereumToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    ethereumRouteKey: "xphere-usdc",
    xphereRouteKey: "ethereum-usdc",
    ethereumContractKey: "usdcWarpRouter",
    xphereContractKey: "usdcWarpRouter",
  },
  USDT: {
    routeName: "usdt",
    symbol: "USDT",
    xSymbol: "xUSDT",
    tokenKey: "xUSDT",
    ethereumTokenKey: "USDT",
    ethereumToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    ethereumRouteKey: "xphere-usdt",
    xphereRouteKey: "ethereum-usdt",
    ethereumContractKey: "usdtWarpRouter",
    xphereContractKey: "usdtWarpRouter",
  },
  ETH: {
    routeName: "native",
    symbol: "ETH",
    xSymbol: "xETH",
    tokenKey: "xETH",
    ethereumTokenKey: null,
    ethereumToken: "ETH",
    ethereumRouteKey: "xphere-native",
    xphereRouteKey: "ethereum-native",
    ethereumContractKey: "nativeWarpRouter",
    xphereContractKey: "nativeWarpRouter",
  },
};

const coreKeys = {
  mailbox: "hyperlaneMailbox",
  interchainGasPaymaster: "hyperlaneInterchainGasPaymaster",
  validatorAnnounce: "hyperlaneValidatorAnnounce",
  interchainSecurityModule: "hyperlaneInterchainSecurityModule",
  proxyAdmin: "hyperlaneProxyAdmin",
};

function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) &&
    normalized !== "0x0000000000000000000000000000000000000000";
}

async function readArtifact(filename, chainId) {
  const path = resolve(deploymentsDir, filename);
  if (!existsSync(path)) {
    return {
      chainId,
      contracts: {},
      tokens: {},
      router: null,
      factory: null,
      initCodeHash: null,
      bridgeRoutes: {},
    };
  }
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeArtifact(filename, artifact) {
  await mkdir(deploymentsDir, { recursive: true });
  await writeFile(resolve(deploymentsDir, filename), `${JSON.stringify(artifact, null, 2)}\n`);
}

async function readStructured(path) {
  const raw = await readFile(path, "utf8");
  if (extname(path).toLowerCase() === ".json") return JSON.parse(raw);
  return YAML.parse(raw);
}

async function listFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (/\.(ya?ml|json)$/i.test(item.name)) out.push(path);
    }
  }
  await walk(root);
  return out;
}

async function readLastLog() {
  const path = resolve(opsDir, "generated", "hyperlane-last.log");
  if (!existsSync(path)) return "";
  return readFile(path, "utf8");
}

function labelledAddress(log, labels) {
  const lines = log.split(/\r?\n/);
  const candidates = [];
  for (const line of lines) {
    const normalized = normalizeKey(line);
    if (!labels.some((label) => normalized.includes(normalizeKey(label)))) continue;
    const matches = line.match(/0x[a-fA-F0-9]{40}/g) || [];
    candidates.push(...matches);
  }
  const unique = Array.from(new Set(candidates));
  return unique.length === 1 ? unique[0] : undefined;
}

function routeAddressesFromLog(log, asset) {
  const assetKey = normalizeKey(asset);
  const routeLines = log
    .split(/\r?\n/)
    .filter((line) => normalizeKey(line).includes(assetKey) || normalizeKey(line).includes("warp"));
  const routeLog = routeLines.length > 0 ? routeLines.join("\n") : log;
  return {
    ethereumRouter: labelledAddress(routeLog, ["ethereum router", "ethereum warp router", "ethereum"]),
    xphereRouter: labelledAddress(routeLog, ["xphere router", "xphere warp router"]),
    xphereToken: labelledAddress(routeLog, ["xphere token", "synthetic token", "xerc20", "xeth", "xusdc", "xusdt"]),
  };
}

function normalizeKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function flatten(value, path = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, [...path, String(index)]));
  const rows = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isAddress(child)) rows.push({ path: nextPath, value: child });
    rows.push(...flatten(child, nextPath));
  }
  return rows;
}

function addressForKey(data, keys) {
  const wanted = new Set(keys.map(normalizeKey));
  for (const row of flatten(data)) {
    const key = normalizeKey(row.path.at(-1));
    if (wanted.has(key)) return row.value;
  }
  return undefined;
}

function chainScopedRows(data, chainName) {
  const chain = normalizeKey(chainName);
  return flatten(data).filter((row) => row.path.some((part) => normalizeKey(part) === chain));
}

function pickByPath(rows, includes, excludes = []) {
  const found = rows.filter((row) => {
    const path = normalizeKey(row.path.join("."));
    return includes.some((item) => path.includes(normalizeKey(item))) &&
      !excludes.some((item) => path.includes(normalizeKey(item)));
  });
  const unique = Array.from(new Set(found.map((row) => row.value)));
  return unique.length === 1 ? unique[0] : undefined;
}

function pickRouteAddresses(data) {
  const ethereumRows = chainScopedRows(data, "ethereum");
  const xphereRows = chainScopedRows(data, "xphere");

  return {
    ethereumRouter: pickByPath(ethereumRows, ["router"]),
    xphereRouter: pickByPath(xphereRows, ["router"]),
    xphereToken:
      pickByPath(xphereRows, ["syntheticToken", "tokenAddress", "token"], ["router"]) ||
      pickByPath(xphereRows, ["addressOrDenom"], ["router"]),
  };
}

async function syncCore() {
  const paths = [
    resolve(repoRegistryDir, "chains", "xphere", "addresses.yaml"),
    resolve(windowsRegistryDir, "chains", "xphere", "addresses.yaml"),
  ].filter((path) => existsSync(path));

  const artifact = await readArtifact("xphere-mainnet.local.json", 20250217);
  artifact.contracts ||= {};
  let changed = false;

  for (const path of paths) {
    const data = await readStructured(path);
    const found = {
      hyperlaneMailbox: addressForKey(data, ["mailbox"]),
      hyperlaneInterchainGasPaymaster: addressForKey(data, ["interchainGasPaymaster", "interchain-gas-paymaster", "igp"]),
      hyperlaneValidatorAnnounce: addressForKey(data, ["validatorAnnounce", "validator-announce"]),
      hyperlaneInterchainSecurityModule: addressForKey(data, ["interchainSecurityModule", "interchain-security-module", "ism"]),
      hyperlaneProxyAdmin: addressForKey(data, ["proxyAdmin", "proxy-admin"]),
    };

    for (const [artifactKey, value] of Object.entries(found)) {
      if (isAddress(value) && artifact.contracts[artifactKey] !== value) {
        artifact.contracts[artifactKey] = value;
        changed = true;
      }
    }
  }

  const log = await readLastLog();
  const foundFromLog = {
    hyperlaneMailbox: labelledAddress(log, ["mailbox"]),
    hyperlaneInterchainGasPaymaster: labelledAddress(log, ["interchain gas paymaster", "interchainGasPaymaster", "igp"]),
    hyperlaneValidatorAnnounce: labelledAddress(log, ["validator announce", "validatorAnnounce"]),
    hyperlaneInterchainSecurityModule: labelledAddress(log, ["interchain security module", "interchainSecurityModule", "ism"]),
    hyperlaneProxyAdmin: labelledAddress(log, ["proxy admin", "proxyAdmin"]),
  };

  for (const [artifactKey, value] of Object.entries(foundFromLog)) {
    if (!isAddress(artifact.contracts[artifactKey]) && isAddress(value)) {
      artifact.contracts[artifactKey] = value;
      changed = true;
    }
  }

  if (changed) {
    await writeArtifact("xphere-mainnet.local.json", artifact);
    console.log("Synced Xphere Hyperlane core addresses into deployments/xphere-mainnet.local.json");
  }
  return changed;
}

async function syncRoute(asset, route) {
  const routeRoots = [
    resolve(repoRegistryDir, "deployments", "warp_routes", asset),
    resolve(windowsRegistryDir, "deployments", "warp_routes", asset),
  ];
  const files = (await Promise.all(routeRoots.map(listFiles))).flat();

  let found = {};
  for (const file of files) {
    const data = await readStructured(file);
    const next = pickRouteAddresses(data);
    found = { ...found, ...Object.fromEntries(Object.entries(next).filter(([, value]) => isAddress(value))) };
  }

  if (!isAddress(found.ethereumRouter) || !isAddress(found.xphereRouter) || !isAddress(found.xphereToken)) {
    const fromLog = routeAddressesFromLog(await readLastLog(), asset);
    found = { ...found, ...Object.fromEntries(Object.entries(fromLog).filter(([, value]) => isAddress(value))) };
  }

  if (!isAddress(found.ethereumRouter) || !isAddress(found.xphereRouter) || !isAddress(found.xphereToken)) {
    return false;
  }

  const xphere = await readArtifact("xphere-mainnet.local.json", 20250217);
  const ethereum = await readArtifact("ethereum-mainnet.local.json", 1);
  xphere.contracts ||= {};
  ethereum.contracts ||= {};
  xphere.tokens ||= {};
  ethereum.tokens ||= {};
  xphere.bridgeRoutes ||= {};
  ethereum.bridgeRoutes ||= {};

  xphere.contracts[route.xphereContractKey] = found.xphereRouter;
  ethereum.contracts[route.ethereumContractKey] = found.ethereumRouter;
  xphere.tokens[route.tokenKey] = found.xphereToken;
  if (route.ethereumTokenKey) ethereum.tokens[route.ethereumTokenKey] = route.ethereumToken;

  xphere.bridgeRoutes[route.xphereRouteKey] = {
    standard: "hyperlane-warp-route",
    router: found.xphereRouter,
    destinationRouter: found.xphereRouter,
    token: found.xphereToken,
    tokenSymbol: route.xSymbol,
    remoteRouter: found.ethereumRouter,
    remoteToken: route.ethereumToken,
    remoteTokenSymbol: route.symbol,
    remoteDomain: 1,
  };

  ethereum.bridgeRoutes[route.ethereumRouteKey] = {
    standard: "hyperlane-warp-route",
    router: found.ethereumRouter,
    sourceRouter: found.ethereumRouter,
    token: route.ethereumToken,
    tokenSymbol: route.symbol,
    remoteRouter: found.xphereRouter,
    remoteToken: found.xphereToken,
    remoteTokenSymbol: route.xSymbol,
    remoteDomain: 20250217,
  };

  await writeArtifact("xphere-mainnet.local.json", xphere);
  await writeArtifact("ethereum-mainnet.local.json", ethereum);
  console.log(`Synced ${asset} Warp Route from Hyperlane registry artifacts.`);
  return true;
}

async function main() {
  let synced = 0;
  if (await syncCore()) synced += 1;
  for (const [asset, route] of Object.entries(routeDefs)) {
    if (await syncRoute(asset, route)) synced += 1;
  }

  if (synced === 0) {
    console.log("No new Hyperlane deployment artifacts found to sync.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
