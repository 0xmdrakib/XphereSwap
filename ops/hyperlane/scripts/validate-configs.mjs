import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IsmConfigSchema } from "@hyperlane-xyz/sdk";
import YAML from "yaml";
import {
  BASE_USDC,
  CHAINS,
  ETHEREUM_USDC,
  OPS_DIR,
  ROUTES,
  TOTAL_TVL_CAP_USD,
  USDC_DAILY_CAP_UNITS,
  initialIsmConfig,
} from "./bridge-config.mjs";

const failures = [];

function fail(message) {
  failures.push(message);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

async function readYaml(relativePath) {
  return YAML.parse(await readFile(resolve(OPS_DIR, relativePath), "utf8"));
}

function validateChain(config, chainName) {
  const expected = CHAINS[chainName];
  equal(config.name, chainName, `${expected.metadata} name`);
  equal(config.chainId, expected.chainId, `${expected.metadata} chainId`);
  equal(config.domainId, expected.domainId, `${expected.metadata} domainId`);
  equal(config.protocol, "ethereum", `${expected.metadata} protocol`);
  equal(config.nativeToken?.decimals, 18, `${expected.metadata} native decimals`);
  const rpcUrls = config.rpcUrls?.map((entry) => entry.http) || [];
  if (chainName === "base" && !rpcUrls.includes("${BASE_MAINNET_RPC_URL}")) fail("Base RPC must stay env-driven");
  if (chainName === "ethereum" && !rpcUrls.includes("${ETHEREUM_MAINNET_RPC_URL}")) fail("Ethereum RPC must stay env-driven");
  if (chainName === "xphere") {
    if (!rpcUrls.includes("https://en-hkg.x-phere.com") || !rpcUrls.includes("https://en-bkk.x-phere.com")) {
      fail("Xphere metadata must retain official fallback RPCs");
    }
    equal(config.blockExplorers?.[0]?.url, "https://xp.tamsa.io", "Xphere explorer");
  }
}

function validateRoute(config, routeKey) {
  const expected = ROUTES[routeKey];
  equal(config.routeId, expected.id, `${expected.template} routeId`);
  equal(config.asset, expected.asset, `${expected.template} asset`);
  equal(config.tokens?.length, 3, `${expected.template} token count`);
  const byChain = Object.fromEntries((config.tokens || []).map((token) => [token.chainName, token]));
  for (const chainName of Object.keys(CHAINS)) {
    if (!byChain[chainName]) fail(`${expected.template}: missing ${chainName} token`);
  }
  equal(byChain.base?.type, routeKey === "eth" ? "collateralNative" : "collateral", `${expected.template} Base type`);
  equal(byChain.ethereum?.type, routeKey === "eth" ? "collateralNative" : "collateral", `${expected.template} Ethereum type`);
  equal(byChain.xphere?.type, "synthetic", `${expected.template} Xphere type`);
  equal(byChain.xphere?.symbol, expected.symbolForChain.xphere, `${expected.template} Xphere symbol`);
  equal(byChain.xphere?.decimals, expected.decimals, `${expected.template} decimals`);
  if (routeKey === "usdc") {
    equal(byChain.base?.addressOrDenom, BASE_USDC, "Base USDC address");
    equal(byChain.ethereum?.addressOrDenom, ETHEREUM_USDC, "Ethereum USDC address");
    equal(config.options?.finalSecurity?.rateLimitCapacity, String(USDC_DAILY_CAP_UNITS), "USDC rate capacity");
  } else {
    equal(config.options?.finalSecurity?.rateLimitEnv, "BRIDGE_ETH_DAILY_CAP_WEI", "ETH rate capacity env");
  }
  equal(config.options?.totalTvlLimitUsd, TOTAL_TVL_CAP_USD, `${expected.template} TVL cap`);
  if (expected.generatedDeployName === expected.deployName) {
    fail(`${expected.template}: generated output name must not collide with the registry deployment name`);
  }
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    equal(config.options?.owners?.[chainName], `\${${chain.ownerEnv}}`, `${expected.template} ${chainName} owner`);
  }
  const security = config.options?.initialSecurity;
  equal(security?.type, "staticAggregationIsm", `${expected.template} initial ISM type`);
  equal(security?.threshold, 2, `${expected.template} initial ISM threshold`);
  equal(security?.modules?.[0]?.type, "messageIdMultisigIsm", `${expected.template} multisig type`);
  equal(security?.modules?.[0]?.threshold, 2, `${expected.template} multisig threshold`);
  equal(security?.modules?.[0]?.validators?.length, 3, `${expected.template} validators`);
  equal(security?.modules?.[1]?.type, "pausableIsm", `${expected.template} pause module`);
  equal(config.options?.finalSecurity?.type, "staticAggregationIsm", `${expected.template} final ISM type`);
  equal(config.options?.finalSecurity?.threshold, 3, `${expected.template} final ISM threshold`);

  try {
    IsmConfigSchema.parse(
      initialIsmConfig(
        "0x1111111111111111111111111111111111111111",
        [
          "0x2222222222222222222222222222222222222222",
          "0x3333333333333333333333333333333333333333",
          "0x4444444444444444444444444444444444444444",
        ],
      ),
    );
  } catch (error) {
    fail(`${expected.template}: generated ISM does not match pinned SDK (${error.message})`);
  }
}

async function main() {
  const [base, ethereum, xphere, xphereTestnet, ethRoute, usdcRoute, packageJson] = await Promise.all([
    readYaml(CHAINS.base.metadata),
    readYaml(CHAINS.ethereum.metadata),
    readYaml(CHAINS.xphere.metadata),
    readYaml("chains/xphere-testnet.yaml"),
    readYaml(`warp-routes/${ROUTES.eth.template}`),
    readYaml(`warp-routes/${ROUTES.usdc.template}`),
    readFile(resolve(OPS_DIR, "package.json"), "utf8").then(JSON.parse),
  ]);
  validateChain(base, "base");
  validateChain(ethereum, "ethereum");
  validateChain(xphere, "xphere");
  equal(xphereTestnet.chainId, 1998991, "Xphere testnet chainId");
  validateRoute(ethRoute, "eth");
  validateRoute(usdcRoute, "usdc");
  equal(packageJson.dependencies?.["@hyperlane-xyz/cli"], "36.0.0", "Hyperlane CLI pin");
  equal(packageJson.dependencies?.["@hyperlane-xyz/sdk"], "36.0.0", "Hyperlane SDK pin");

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
