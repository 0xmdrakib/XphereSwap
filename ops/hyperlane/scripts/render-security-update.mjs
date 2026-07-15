import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IsmConfigSchema } from "@hyperlane-xyz/sdk";
import YAML from "yaml";
import {
  CHAINS,
  OPS_DIR,
  REGISTRY_DIR,
  ROUTES,
  USDC_DAILY_CAP_UNITS,
  WINDOWS_REGISTRY_DIR,
  finalIsmConfig,
  isAddress,
  rateLimitForRoute,
  readArtifact,
  readEnv,
  routeComplete,
  validateBridgeOperators,
  validatorsFromEnv,
} from "./bridge-config.mjs";

const routeArgIndex = process.argv.indexOf("--route");
const selectedRoute = routeArgIndex >= 0 ? process.argv[routeArgIndex + 1] : undefined;
const paused = process.argv.includes("--paused");

function deployType(routeKey, chainName) {
  if (chainName === "xphere") return "synthetic";
  if (routeKey === "eth") return "native";
  return "collateral";
}

function assertInputs(env, artifacts) {
  const requiredAddresses = [
    ...Object.values(CHAINS).map((chain) => chain.ownerEnv),
    "HYPERLANE_VALIDATOR_1",
    "HYPERLANE_VALIDATOR_2",
    "HYPERLANE_VALIDATOR_3",
  ];
  const missing = requiredAddresses.filter((key) => !isAddress(env[key]));
  if (missing.length > 0) throw new Error(`Cannot render security update; missing/invalid env: ${missing.join(", ")}`);
  const operatorErrors = validateBridgeOperators(env);
  if (operatorErrors.length > 0) throw new Error(operatorErrors.join("; "));
  if (env.BRIDGE_ETH_DAILY_CAP_REVIEWED !== "true") {
    throw new Error("BRIDGE_ETH_DAILY_CAP_REVIEWED must be true after operator review");
  }
  if (!rateLimitForRoute("eth", env)) {
    throw new Error("BRIDGE_ETH_DAILY_CAP_WEI must be positive and divisible by 86400");
  }
  for (const [chainName, artifact] of Object.entries(artifacts)) {
    for (const routeKey of Object.keys(ROUTES)) {
      if (!routeComplete(artifact, routeKey, chainName)) {
        throw new Error(`${chainName} ${routeKey} route artifact is incomplete; record phase-one deployment first`);
      }
    }
  }
}

function buildDeployConfig(routeKey, env, artifacts) {
  const route = ROUTES[routeKey];
  const validators = validatorsFromEnv(env);
  const maxCapacity = rateLimitForRoute(routeKey, env);
  const deploy = {};
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    const record = artifacts[chainName].bridgeRoutes[routeKey];
    const owner = env[chain.ownerEnv];
    const ism = finalIsmConfig(owner, validators, maxCapacity, record.router, paused);
    IsmConfigSchema.parse(ism);
    const item = {
      type: deployType(routeKey, chainName),
      owner,
      proxyAdmin: { owner },
      interchainSecurityModule: ism,
    };
    if (record.token !== "ETH") item.token = record.token;
    if (chainName === "xphere") {
      item.name = routeKey === "eth" ? "Xphere Bridged ETH" : "Xphere Bridged USDC";
      item.symbol = route.symbolForChain.xphere;
      item.decimals = route.decimals;
    }
    deploy[chainName] = item;
  }
  return deploy;
}

async function writeRegistryConfig(route, rendered) {
  const roots = [REGISTRY_DIR];
  if (process.platform === "win32") roots.push(WINDOWS_REGISTRY_DIR);
  for (const root of roots) {
    const dir = resolve(root, "deployments", "warp_routes", route.registryAsset);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, route.deployName), rendered);
  }
}

async function main() {
  const env = await readEnv();
  const artifacts = Object.fromEntries(
    await Promise.all(Object.keys(CHAINS).map(async (chainName) => [chainName, await readArtifact(chainName)])),
  );
  assertInputs(env, artifacts);
  const outputDir = resolve(OPS_DIR, "generated");
  await mkdir(outputDir, { recursive: true });

  for (const [routeKey, route] of Object.entries(ROUTES)) {
    if (selectedRoute && routeKey !== selectedRoute) continue;
    const rendered = YAML.stringify(buildDeployConfig(routeKey, env, artifacts));
    const filename = `${route.registryAsset.toLowerCase()}-base-ethereum-xphere-security.yaml`;
    await writeFile(resolve(outputDir, filename), rendered);
    await writeRegistryConfig(route, rendered);
    console.log(`Rendered ${paused ? "paused" : "active"} phase-two security update ${route.id}`);
  }
  if (selectedRoute && !ROUTES[selectedRoute]) throw new Error("--route must be eth or usdc");
  console.log(`USDC effective daily capacity: ${USDC_DAILY_CAP_UNITS} base units`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
