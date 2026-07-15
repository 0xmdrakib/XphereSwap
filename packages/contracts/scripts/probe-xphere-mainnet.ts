import { ethers, network } from "hardhat";

const EXPECTED_CHAIN_ID = 20250217;
const PUBLIC_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);
const CANDIDATE_XEF = "0x80252C2D06bbd85699c555fc3633D5B8eE67C9AD";
const EXPLORER_URL = "https://xp.tamsa.io";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WXP() view returns (address)",
];

type ProbeStatus = "OK" | "WARN" | "FAIL";
type ProbeResult = { status: ProbeStatus; label: string; detail: string };

const results: ProbeResult[] = [];

function add(status: ProbeStatus, label: string, detail = "") {
  results.push({ status, label, detail });
}

function ok(label: string, detail = "") {
  add("OK", label, detail);
}

function warn(label: string, detail = "") {
  add("WARN", label, detail);
}

function fail(label: string, detail = "") {
  add("FAIL", label, detail);
}

function isAddress(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^0x[a-fA-F0-9]{40}$/.test(value) &&
      value.toLowerCase() !== "0x0000000000000000000000000000000000000000",
  );
}

function configuredAddress(envName: string): string | undefined {
  const value = process.env[envName];
  if (!value) return undefined;
  if (!isAddress(value)) {
    fail(envName, `invalid address: ${value}`);
    return undefined;
  }
  return ethers.getAddress(value);
}

async function requireCode(address: string, label: string): Promise<boolean> {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    fail(label, `no contract code at ${address}`);
    return false;
  }
  ok(label, `code present at ${address}`);
  return true;
}

async function probeToken(address: string, label: string, expected?: { symbol?: string; decimals?: number }) {
  if (!(await requireCode(address, label))) return;

  const token = new ethers.Contract(address, ERC20_ABI, ethers.provider);
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals(),
      token.totalSupply(),
    ]);

    const numericDecimals = Number(decimals);
    ok(`${label} metadata`, `${name} / ${symbol} / ${numericDecimals} decimals`);
    ok(`${label} totalSupply`, ethers.formatUnits(totalSupply, numericDecimals));

    if (expected?.symbol && symbol !== expected.symbol) {
      fail(`${label} symbol`, `expected ${expected.symbol}, got ${symbol}`);
    }
    if (expected?.decimals !== undefined && numericDecimals !== expected.decimals) {
      fail(`${label} decimals`, `expected ${expected.decimals}, got ${numericDecimals}`);
    }
  } catch (error) {
    fail(`${label} ERC20 metadata`, error instanceof Error ? error.message : String(error));
  }
}

async function probeRouter(routerAddress: string, expectedFactory?: string, expectedWxp?: string) {
  if (!(await requireCode(routerAddress, "VITE_XPHERE_ROUTER"))) return;

  const router = new ethers.Contract(routerAddress, ROUTER_ABI, ethers.provider);
  try {
    const [factory, wxp] = await Promise.all([router.factory(), router.WXP()]);
    ok("router.factory()", factory);
    ok("router.WXP()", wxp);

    if (expectedFactory && factory.toLowerCase() !== expectedFactory.toLowerCase()) {
      fail("router.factory() match", `expected ${expectedFactory}, got ${factory}`);
    }
    if (expectedWxp && wxp.toLowerCase() !== expectedWxp.toLowerCase()) {
      fail("router.WXP() match", `expected ${expectedWxp}, got ${wxp}`);
    }
  } catch (error) {
    fail("router read", error instanceof Error ? error.message : String(error));
  }
}

async function probeExplorer() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(EXPLORER_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) ok("Tamsa explorer", `reachable (${response.status})`);
    else warn("Tamsa explorer", `HTTP ${response.status}`);
  } catch (error) {
    warn("Tamsa explorer", error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  if (network.name !== "xphereMainnet") {
    throw new Error(`probe-xphere-mainnet must run on xphereMainnet, got ${network.name}`);
  }

  const rpc = process.env.XPHERE_MAINNET_RPC_URL || "https://en-hkg.x-phere.com";
  if (PUBLIC_RPCS.has(rpc)) {
    warn("XPHERE_MAINNET_RPC_URL", "using public RPC; use dedicated RPC for beta launch");
  } else {
    ok("XPHERE_MAINNET_RPC_URL", "custom RPC configured");
  }

  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  if (chainId === EXPECTED_CHAIN_ID) ok("chainId", String(chainId));
  else fail("chainId", `expected ${EXPECTED_CHAIN_ID}, got ${chainId}`);

  const [blockNumber, feeData] = await Promise.all([
    ethers.provider.getBlockNumber(),
    ethers.provider.getFeeData(),
  ]);
  ok("latest block", String(blockNumber));
  if (feeData.gasPrice) ok("gas price", `${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei`);
  else warn("gas price", "provider did not return gasPrice");

  const wxp = configuredAddress("VITE_XPHERE_WXP");
  const factory = configuredAddress("VITE_XPHERE_FACTORY");
  const router = configuredAddress("VITE_XPHERE_ROUTER");
  const xusdc = configuredAddress("XPHERE_XUSDC_TOKEN") || configuredAddress("VITE_XPHERE_XUSDC");
  const xeth = configuredAddress("XPHERE_XETH_TOKEN") || configuredAddress("VITE_XPHERE_XETH");
  const envXef = configuredAddress("XPHERE_XEF_TOKEN") || configuredAddress("VITE_XPHERE_XEF");

  if (wxp) await probeToken(wxp, "WXP", { symbol: "WXP", decimals: 18 });
  else warn("VITE_XPHERE_WXP", "not set; swap contracts not deployed or not synced");
  if (factory) await requireCode(factory, "VITE_XPHERE_FACTORY");
  else warn("VITE_XPHERE_FACTORY", "not set; swap contracts not deployed or not synced");
  if (router) await probeRouter(router, factory, wxp);
  else warn("VITE_XPHERE_ROUTER", "not set; swap contracts not deployed or not synced");

  if (xusdc) await probeToken(xusdc, "xUSDC", { symbol: "xUSDC", decimals: 6 });
  else warn("XPHERE_XUSDC_TOKEN", "not set; Hyperlane xUSDC token not deployed or not synced");
  if (xeth) await probeToken(xeth, "xETH", { symbol: "xETH", decimals: 18 });
  else warn("XPHERE_XETH_TOKEN", "not set; ETH can only bridge to Xphere after Hyperlane xETH is deployed");

  await probeToken(envXef || CANDIDATE_XEF, envXef ? "configured XEF" : "candidate XEF", {
    symbol: "XEF",
    decimals: 18,
  });
  if (!envXef) {
    warn(
      "XEF listing",
      "candidate was probed read-only; keep VITE_XEF_OFFICIAL_VERIFIED=false until official confirmation",
    );
  }

  for (const key of [
    "VITE_XPHERE_USDC_WARP_ROUTER",
    "VITE_XPHERE_NATIVE_WARP_ROUTER",
  ]) {
    const address = configuredAddress(key);
    if (address) await requireCode(address, key);
    else warn(key, "not set; bridge route remains preview-only until Hyperlane deployment records this");
  }

  await probeExplorer();

  const counts = results.reduce(
    (acc, result) => {
      acc[result.status] += 1;
      return acc;
    },
    { OK: 0, WARN: 0, FAIL: 0 } as Record<ProbeStatus, number>,
  );

  console.log("Xphere mainnet probe:");
  for (const result of results) {
    console.log(`[${result.status}] ${result.label}${result.detail ? ` - ${result.detail}` : ""}`);
  }
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.FAIL} failures`);

  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
