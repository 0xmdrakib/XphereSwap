import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "../../..");
const deploymentsDir = resolve(repoDir, "deployments");

const ROUTES = {
  usdc: {
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
  usdt: {
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
  native: {
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

function usage() {
  console.error(`Usage:
pnpm bridge:record-route <usdc|usdt|native> --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...

Examples:
pnpm bridge:record-route usdc --ethereum-router 0xEthRouter --xphere-router 0xXphereRouter --xphere-token 0xXusdc
pnpm bridge:record-route native --ethereum-router 0xEthNativeRouter --xphere-router 0xXethRouter --xphere-token 0xXethToken`);
}

function parseArgs(argv) {
  const [routeName, ...rest] = argv;
  const options = { routeName };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function requireAddress(value, label) {
  if (!isAddress(value)) throw new Error(`${label} must be an EVM address`);
  return value;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const route = ROUTES[options.routeName];
  if (!route) {
    usage();
    process.exitCode = 1;
    return;
  }

  const ethereumRouter = requireAddress(options["ethereum-router"], "--ethereum-router");
  const xphereRouter = requireAddress(options["xphere-router"], "--xphere-router");
  const xphereToken = route.tokenKey ? requireAddress(options["xphere-token"], "--xphere-token") : route.xphereToken;

  const xphere = await readArtifact("xphere-mainnet.local.json", 20250217);
  const ethereum = await readArtifact("ethereum-mainnet.local.json", 1);

  xphere.contracts ||= {};
  ethereum.contracts ||= {};
  xphere.tokens ||= {};
  ethereum.tokens ||= {};
  xphere.bridgeRoutes ||= {};
  ethereum.bridgeRoutes ||= {};

  xphere.contracts[route.xphereContractKey] = xphereRouter;
  ethereum.contracts[route.ethereumContractKey] = ethereumRouter;
  if (route.tokenKey) xphere.tokens[route.tokenKey] = xphereToken;
  if (route.ethereumTokenKey) ethereum.tokens[route.ethereumTokenKey] = route.ethereumToken;

  xphere.bridgeRoutes[route.xphereRouteKey] = {
    standard: "hyperlane-warp-route",
    router: xphereRouter,
    destinationRouter: xphereRouter,
    token: xphereToken,
    tokenSymbol: route.xSymbol,
    remoteRouter: ethereumRouter,
    remoteToken: route.ethereumToken,
    remoteTokenSymbol: route.symbol,
    remoteDomain: 1,
  };

  ethereum.bridgeRoutes[route.ethereumRouteKey] = {
    standard: "hyperlane-warp-route",
    router: ethereumRouter,
    sourceRouter: ethereumRouter,
    token: route.ethereumToken,
    tokenSymbol: route.symbol,
    remoteRouter: xphereRouter,
    remoteToken: xphereToken,
    remoteTokenSymbol: route.xSymbol,
    remoteDomain: 20250217,
  };

  await writeArtifact("xphere-mainnet.local.json", xphere);
  await writeArtifact("ethereum-mainnet.local.json", ethereum);

  console.log(`Recorded ${options.routeName} Hyperlane route.`);
  console.log(`- Ethereum router: ${ethereumRouter}`);
  console.log(`- Xphere router: ${xphereRouter}`);
  console.log(`- Xphere token: ${xphereToken}`);
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
