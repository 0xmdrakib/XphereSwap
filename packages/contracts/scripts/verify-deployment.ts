import { ethers, network } from "hardhat";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DeploymentArtifact, deploymentFilename } from "./shared/config";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
];

const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
];
const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WXP() view returns (address)",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
];
const LOCAL_BRIDGE_ABI = [
  "function token() view returns (address)",
  "function localDomain() view returns (uint32)",
  "function remoteDomain() view returns (uint32)",
  "function mode() view returns (uint8)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
];
const LOCAL_NATIVE_BRIDGE_ABI = [
  "function localDomain() view returns (uint32)",
  "function remoteDomain() view returns (uint32)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
];

type Verification = {
  ok: string[];
  warnings: string[];
  failures: string[];
};

const result: Verification = { ok: [], warnings: [], failures: [] };

function ok(message: string) {
  result.ok.push(message);
}

function warn(message: string) {
  result.warnings.push(message);
}

function fail(message: string) {
  result.failures.push(message);
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function requireAddress(value: unknown, label: string): string | undefined {
  if (!isAddress(value)) {
    fail(`${label}: missing or invalid address`);
    return undefined;
  }
  return ethers.getAddress(value);
}

function optionalArtifactAddress(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return requireAddress(value, label);
}

async function requireCode(address: string, label: string) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") fail(`${label}: no contract code at ${address}`);
  else ok(`${label}: code present`);
}

async function verifyToken(address: string, label: string, expectedSymbol?: string, expectedDecimals?: number) {
  await requireCode(address, label);
  const token = new ethers.Contract(address, ERC20_ABI, ethers.provider);
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  if (expectedSymbol && symbol !== expectedSymbol) fail(`${label}: expected symbol ${expectedSymbol}, got ${symbol}`);
  else ok(`${label}: symbol ${symbol}`);
  if (expectedDecimals !== undefined && Number(decimals) !== expectedDecimals) {
    fail(`${label}: expected decimals ${expectedDecimals}, got ${decimals}`);
  } else {
    ok(`${label}: decimals ${decimals}`);
  }
}

async function verifyPair(factoryAddress: string, tokenA: string, tokenB: string, label: string, requireLiquidity: boolean) {
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, ethers.provider);
  const pairAddress = await factory.getPair(tokenA, tokenB);
  if (pairAddress === ethers.ZeroAddress) {
    if (requireLiquidity) fail(`${label}: pair does not exist`);
    else warn(`${label}: pair does not exist yet`);
    return;
  }
  await requireCode(pairAddress, `${label} pair`);
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, ethers.provider);
  const [token0, token1, reserves] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  const normalized = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  const actual = [String(token0).toLowerCase(), String(token1).toLowerCase()].sort();
  if (normalized[0] !== actual[0] || normalized[1] !== actual[1]) {
    fail(`${label}: pair token mismatch`);
  } else {
    ok(`${label}: pair tokens match`);
  }

  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  if (requireLiquidity && (reserve0 === 0n || reserve1 === 0n)) {
    fail(`${label}: missing liquidity`);
  } else {
    ok(`${label}: reserves ${reserve0}/${reserve1}`);
  }
}

async function verifySwapArtifact(artifact: DeploymentArtifact, requireLiquidity: boolean, requireStables: boolean) {
  const wxp = requireAddress(artifact.contracts.wXP, "contracts.wXP");
  const factory = requireAddress(artifact.contracts.factory, "contracts.factory");
  const router = requireAddress(artifact.contracts.router, "contracts.router");
  const multicall = requireAddress(artifact.contracts.multicall3, "contracts.multicall3");

  for (const [label, address] of [
    ["WXP", wxp],
    ["factory", factory],
    ["router", router],
    ["multicall3", multicall],
  ] as const) {
    if (address) await requireCode(address, label);
  }

  if (wxp) await verifyToken(wxp, "WXP", "WXP", 18);

  if (router && factory && wxp) {
    const routerContract = new ethers.Contract(router, ROUTER_ABI, ethers.provider);
    const [routerFactory, routerWxp] = await Promise.all([routerContract.factory(), routerContract.WXP()]);
    if (String(routerFactory).toLowerCase() !== factory.toLowerCase()) fail("router.factory: does not match artifact");
    else ok("router.factory: matches artifact");
    if (String(routerWxp).toLowerCase() !== wxp.toLowerCase()) fail("router.WXP: does not match artifact");
    else ok("router.WXP: matches artifact");
  }

  const xusdc = requireStables
    ? requireAddress(artifact.tokens.xUSDC, "tokens.xUSDC")
    : optionalArtifactAddress(artifact.tokens.xUSDC, "tokens.xUSDC");
  const xusdt = requireStables
    ? requireAddress(artifact.tokens.xUSDT, "tokens.xUSDT")
    : optionalArtifactAddress(artifact.tokens.xUSDT, "tokens.xUSDT");
  const xeth = optionalArtifactAddress(artifact.tokens.xETH, "tokens.xETH");
  const xef = optionalArtifactAddress(artifact.tokens.XEF, "tokens.XEF");
  if (xusdc) await verifyToken(xusdc, "xUSDC", "xUSDC", 6);
  if (xusdt) await verifyToken(xusdt, "xUSDT", "xUSDT", 6);
  if (xeth) await verifyToken(xeth, "xETH", "xETH", 18);
  if (xef) await verifyToken(xef, "XEF", "XEF", 18);

  if (factory && wxp && xusdc && xusdt) {
    await verifyPair(factory, wxp, xusdc, "WXP/xUSDC", requireLiquidity);
    await verifyPair(factory, wxp, xusdt, "WXP/xUSDT", requireLiquidity);
    await verifyPair(factory, xusdc, xusdt, "xUSDC/xUSDT", requireLiquidity);
  }
  if (factory && wxp && xeth) await verifyPair(factory, wxp, xeth, "WXP/xETH", requireLiquidity);
  if (factory && wxp && xef) await verifyPair(factory, wxp, xef, "WXP/XEF", requireLiquidity);
}

async function verifyLocalBridge(routerAddress: string, tokenAddress: string, label: string, expectedMode: number, expectedLocal: number, expectedRemote: number) {
  await requireCode(routerAddress, `${label} bridge`);
  const bridge = new ethers.Contract(routerAddress, LOCAL_BRIDGE_ABI, ethers.provider);
  const [token, localDomain, remoteDomain, mode, paused] = await Promise.all([
    bridge.token(),
    bridge.localDomain(),
    bridge.remoteDomain(),
    bridge.mode(),
    bridge.paused(),
  ]);

  if (String(token).toLowerCase() !== tokenAddress.toLowerCase()) fail(`${label}: bridge token mismatch`);
  else ok(`${label}: bridge token matches`);
  if (Number(localDomain) !== expectedLocal) fail(`${label}: expected local domain ${expectedLocal}, got ${localDomain}`);
  else ok(`${label}: local domain ${localDomain}`);
  if (Number(remoteDomain) !== expectedRemote) fail(`${label}: expected remote domain ${expectedRemote}, got ${remoteDomain}`);
  else ok(`${label}: remote domain ${remoteDomain}`);
  if (Number(mode) !== expectedMode) fail(`${label}: expected mode ${expectedMode}, got ${mode}`);
  else ok(`${label}: mode ${mode}`);
  if (paused) warn(`${label}: bridge is paused`);
  else ok(`${label}: bridge unpaused`);
}

async function verifyLocalNativeBridge(routerAddress: string, label: string, expectedLocal: number, expectedRemote: number) {
  await requireCode(routerAddress, `${label} native bridge`);
  const bridge = new ethers.Contract(routerAddress, LOCAL_NATIVE_BRIDGE_ABI, ethers.provider);
  const [localDomain, remoteDomain, paused, balance] = await Promise.all([
    bridge.localDomain(),
    bridge.remoteDomain(),
    bridge.paused(),
    ethers.provider.getBalance(routerAddress),
  ]);

  if (Number(localDomain) !== expectedLocal) fail(`${label}: expected local domain ${expectedLocal}, got ${localDomain}`);
  else ok(`${label}: local domain ${localDomain}`);
  if (Number(remoteDomain) !== expectedRemote) fail(`${label}: expected remote domain ${expectedRemote}, got ${remoteDomain}`);
  else ok(`${label}: remote domain ${remoteDomain}`);
  if (paused) warn(`${label}: native bridge is paused`);
  else ok(`${label}: native bridge unpaused`);
  if (balance === 0n) warn(`${label}: native bridge has zero release liquidity`);
  else ok(`${label}: native bridge liquidity ${ethers.formatEther(balance)}`);
}

async function verifyBridgeArtifact(artifact: DeploymentArtifact) {
  const chainId = artifact.chainId;
  if (chainId === 31337) {
    const usdcRouter = requireAddress(artifact.contracts.usdcBridgeRouter, "contracts.usdcBridgeRouter");
    const usdtRouter = requireAddress(artifact.contracts.usdtBridgeRouter, "contracts.usdtBridgeRouter");
    const nativeRouter = requireAddress(artifact.contracts.nativeBridgeRouter, "contracts.nativeBridgeRouter");
    const xusdc = requireAddress(artifact.tokens.xUSDC, "tokens.xUSDC");
    const xusdt = requireAddress(artifact.tokens.xUSDT, "tokens.xUSDT");
    if (usdcRouter && xusdc) await verifyLocalBridge(usdcRouter, xusdc, "xUSDC", 1, 31337, 31338);
    if (usdtRouter && xusdt) await verifyLocalBridge(usdtRouter, xusdt, "xUSDT", 1, 31337, 31338);
    if (nativeRouter) await verifyLocalNativeBridge(nativeRouter, "XP", 31337, 31338);
    return;
  }

  if (chainId === 31338) {
    const usdcRouter = requireAddress(artifact.contracts.usdcRouter, "contracts.usdcRouter");
    const usdtRouter = requireAddress(artifact.contracts.usdtRouter, "contracts.usdtRouter");
    const nativeRouter = requireAddress(artifact.contracts.nativeBridgeRouter, "contracts.nativeBridgeRouter");
    const usdc = requireAddress(artifact.tokens.USDC, "tokens.USDC");
    const usdt = requireAddress(artifact.tokens.USDT, "tokens.USDT");
    if (usdc) await verifyToken(usdc, "USDC", "USDC", 6);
    if (usdt) await verifyToken(usdt, "USDT", "USDT", 6);
    if (usdcRouter && usdc) await verifyLocalBridge(usdcRouter, usdc, "USDC", 0, 31338, 31337);
    if (usdtRouter && usdt) await verifyLocalBridge(usdtRouter, usdt, "USDT", 0, 31338, 31337);
    if (nativeRouter) await verifyLocalNativeBridge(nativeRouter, "ETH", 31338, 31337);
    return;
  }

  for (const [routeName, route] of Object.entries(artifact.bridgeRoutes || {})) {
    if (routeName === "seededLiquidity") {
      ok("bridgeRoutes.seededLiquidity: liquidity metadata recorded");
      continue;
    }
    const candidate = route as { router?: unknown; token?: unknown; remoteToken?: unknown };
    const router = requireAddress(candidate.router, `bridgeRoutes.${routeName}.router`);
    if (router) await requireCode(router, `bridgeRoutes.${routeName}.router`);
    if (candidate.token === "ETH" || candidate.token === "XP") {
      ok(`bridgeRoutes.${routeName}.token: native ${candidate.token}`);
    } else {
      const token = requireAddress(candidate.token, `bridgeRoutes.${routeName}.token`);
      if (token) await requireCode(token, `bridgeRoutes.${routeName}.token`);
    }
    if (candidate.remoteToken === "ETH" || candidate.remoteToken === "XP") {
      ok(`bridgeRoutes.${routeName}.remoteToken: native ${candidate.remoteToken}`);
    } else if (candidate.remoteToken !== undefined) {
      const remoteToken = requireAddress(candidate.remoteToken, `bridgeRoutes.${routeName}.remoteToken`);
      if (remoteToken) ok(`bridgeRoutes.${routeName}.remoteToken: address recorded`);
    }
  }
}

async function main() {
  const artifactFile = process.env.VERIFY_ARTIFACT || deploymentFilename(network.name);
  const artifactPath = resolve(__dirname, "../../../deployments", artifactFile);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as DeploymentArtifact;
  const providerChainId = Number((await ethers.provider.getNetwork()).chainId);
  const requireLiquidity = process.env.VERIFY_REQUIRE_LIQUIDITY === "true" || network.name === "localhost";
  const requireStables = process.env.VERIFY_REQUIRE_STABLES !== "false";

  if (artifact.chainId !== providerChainId) {
    fail(`chainId mismatch: artifact ${artifact.chainId}, provider ${providerChainId}`);
  } else {
    ok(`chainId: ${providerChainId}`);
  }

  if (artifact.contracts.router || artifact.contracts.factory || artifact.contracts.wXP) {
    await verifySwapArtifact(artifact, requireLiquidity, requireStables);
  }

  await verifyBridgeArtifact(artifact);

  if (result.warnings.length > 0) {
    console.warn(`Deployment verification warnings (${result.warnings.length}):`);
    for (const message of result.warnings) console.warn(`- ${message}`);
  }

  if (result.failures.length > 0) {
    console.error(`Deployment verification failed (${result.failures.length}):`);
    for (const message of result.failures) console.error(`- ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Deployment verification passed (${result.ok.length} checks).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
