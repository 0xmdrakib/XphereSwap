import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const opsDir = resolve(scriptDir, "..");

const ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const XPHERE_MAINNET_RPCS = new Set(["https://en-hkg.x-phere.com", "https://en-bkk.x-phere.com"]);

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function isAddressOrPlaceholder(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value)) || /^\$\{[A-Z0-9_]+\}$/.test(String(value));
}

async function readYaml(relativePath) {
  const absolutePath = resolve(opsDir, relativePath);
  const raw = await readFile(absolutePath, "utf8");
  return { relativePath, data: YAML.parse(raw) };
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
}

function requireTruthy(value, label) {
  if (!value) fail(`${label}: missing`);
}

function validateChainConfig(config, expected) {
  const { data, relativePath } = config;
  requireEqual(data.name, expected.name, `${relativePath} name`);
  requireEqual(data.domainId, expected.domainId, `${relativePath} domainId`);
  requireEqual(data.chainId, expected.chainId, `${relativePath} chainId`);
  requireEqual(data.protocol, "ethereum", `${relativePath} protocol`);
  requireTruthy(data.nativeToken?.symbol, `${relativePath} native token symbol`);
  requireEqual(data.nativeToken?.decimals, 18, `${relativePath} native token decimals`);

  const rpcUrls = data.rpcUrls?.map((entry) => entry.http).filter(Boolean) ?? [];
  if (rpcUrls.length === 0) {
    fail(`${relativePath} rpcUrls: missing`);
  }

  if (expected.name === "xphere") {
    requireEqual(data.nativeToken?.symbol, "XP", `${relativePath} native token symbol`);
    const missingOfficialRpc = [...XPHERE_MAINNET_RPCS].filter((url) => !rpcUrls.includes(url));
    if (missingOfficialRpc.length > 0) {
      fail(`${relativePath} rpcUrls: missing official RPC(s) ${missingOfficialRpc.join(", ")}`);
    }
    requireEqual(data.blockExplorers?.[0]?.url, "https://xp.tamsa.io", `${relativePath} explorer`);
  }

  if (expected.name === "xpheretestnet") {
    requireEqual(data.nativeToken?.symbol, "XPT", `${relativePath} native token symbol`);
    if (!rpcUrls.includes("https://testnet.x-phere.com")) {
      fail(`${relativePath} rpcUrls: missing https://testnet.x-phere.com`);
    }
  }

  if (expected.name === "ethereum") {
    requireEqual(data.nativeToken?.symbol, "ETH", `${relativePath} native token symbol`);
    if (!rpcUrls.includes("${ETHEREUM_MAINNET_RPC_URL}")) {
      fail(`${relativePath} rpcUrls: Ethereum mainnet RPC must stay env-driven`);
    }
    requireEqual(data.blocks?.confirmations, 12, `${relativePath} confirmations`);
  }
}

function validateWarpRoute(config, expected) {
  const { data, relativePath } = config;
  const tokens = data.tokens ?? [];
  if (tokens.length !== 2) {
    fail(`${relativePath} tokens: expected collateral + synthetic entries`);
    return;
  }

  const collateral = tokens.find((token) => token.chainName === "ethereum");
  const synthetic = tokens.find((token) => token.chainName === "xphere");
  requireTruthy(collateral, `${relativePath} ethereum collateral token`);
  requireTruthy(synthetic, `${relativePath} xphere synthetic token`);
  if (!collateral || !synthetic) return;

  requireEqual(collateral.type, expected.ethereumType || "collateral", `${relativePath} ethereum token type`);
  if (expected.ethereumToken) {
    requireEqual(collateral.addressOrDenom, expected.ethereumToken, `${relativePath} ethereum token address`);
  }
  requireEqual(collateral.symbol, expected.ethereumSymbol, `${relativePath} ethereum token symbol`);
  requireEqual(collateral.decimals, expected.decimals, `${relativePath} ethereum token decimals`);

  requireEqual(synthetic.type, expected.xphereType || "synthetic", `${relativePath} xphere token type`);
  requireEqual(synthetic.symbol, expected.xphereSymbol, `${relativePath} xphere token symbol`);
  requireEqual(synthetic.decimals, expected.decimals, `${relativePath} xphere token decimals`);

  requireEqual(data.options?.dailyLimitUsd, 25000, `${relativePath} daily limit`);
  requireEqual(data.options?.totalTvlLimitUsd, 100000, `${relativePath} total TVL limit`);

  const owner = data.options?.owner;
  if (!isAddressOrPlaceholder(owner)) {
    fail(`${relativePath} owner: expected address or env placeholder`);
  }

  const ism = data.options?.interchainSecurityModule;
  requireEqual(ism?.type, "multisig", `${relativePath} ISM type`);
  requireEqual(ism?.threshold, 2, `${relativePath} ISM threshold`);
  const validators = ism?.validators ?? [];
  if (validators.length !== 3) {
    fail(`${relativePath} validators: expected 3 validators`);
  }
  for (const validator of validators) {
    if (!isAddressOrPlaceholder(validator)) {
      fail(`${relativePath} validator ${validator}: expected address or env placeholder`);
    }
  }
}

async function main() {
  const [xphere, xphereTestnet, ethereum, usdcRoute, usdtRoute, nativeRoute] = await Promise.all([
    readYaml("chains/xphere-mainnet.yaml"),
    readYaml("chains/xphere-testnet.yaml"),
    readYaml("chains/ethereum-mainnet.yaml"),
    readYaml("warp-routes/ethereum-xphere-usdc.yaml"),
    readYaml("warp-routes/ethereum-xphere-usdt.yaml"),
    readYaml("warp-routes/ethereum-xphere-native.yaml"),
  ]);

  validateChainConfig(xphere, { name: "xphere", domainId: 20250217, chainId: 20250217 });
  validateChainConfig(xphereTestnet, { name: "xpheretestnet", domainId: 1998991, chainId: 1998991 });
  validateChainConfig(ethereum, { name: "ethereum", domainId: 1, chainId: 1 });

  validateWarpRoute(usdcRoute, {
    ethereumToken: ETH_USDC,
    ethereumSymbol: "USDC",
    xphereSymbol: "xUSDC",
    decimals: 6,
  });
  validateWarpRoute(usdtRoute, {
    ethereumToken: ETH_USDT,
    ethereumSymbol: "USDT",
    xphereSymbol: "xUSDT",
    decimals: 6,
  });
  validateWarpRoute(nativeRoute, {
    ethereumType: "collateralNative",
    ethereumSymbol: "ETH",
    xphereSymbol: "xETH",
    xphereType: "synthetic",
    decimals: 18,
  });

  if (warnings.length > 0) {
    console.warn(`Warnings (${warnings.length}):`);
    for (const warning of warnings) console.warn(`- ${warning}`);
  }

  if (failures.length > 0) {
    console.error(`Hyperlane config validation failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Hyperlane config validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
