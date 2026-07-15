import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BASE_USDC,
  CHAINS,
  ETHEREUM_USDC,
  REPO_DIR,
  ROUTES,
  isAddress,
  readArtifact,
  routeComplete,
} from "./bridge-config.mjs";

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

async function readOptionalJson(relativePath) {
  const path = resolve(REPO_DIR, relativePath);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

function validateLocalDemo(xphere, ethereum) {
  if (xphere) {
    equal(xphere.chainId, 31337, "local Xphere chainId");
    for (const key of ["wXP", "factory", "router", "multicall3"]) {
      if (!isAddress(xphere.contracts?.[key])) fail(`local Xphere contracts.${key}: invalid`);
    }
  }
  if (ethereum) equal(ethereum.chainId, 31338, "local Ethereum chainId");
}

function validateProductionChain(chainName, artifact) {
  const chain = CHAINS[chainName];
  equal(artifact.chainId, chain.chainId, `${chain.artifact} chainId`);
  if (chainName === "base") equal(artifact.tokens?.USDC, BASE_USDC, "Base artifact USDC");
  if (chainName === "ethereum") equal(artifact.tokens?.USDC, ETHEREUM_USDC, "Ethereum artifact USDC");
  const presentRoutes = Object.keys(ROUTES).filter((routeKey) => artifact.bridgeRoutes?.[routeKey]);
  if (presentRoutes.length === 0) {
    warn(`${chain.artifact}: production bridge routes not recorded yet`);
    return;
  }
  for (const routeKey of Object.keys(ROUTES)) {
    if (!routeComplete(artifact, routeKey, chainName)) {
      fail(`${chain.artifact} bridgeRoutes.${routeKey}: incomplete normalized route record`);
    }
    if (
      chainName === "xphere" &&
      artifact.bridgeRoutes?.[routeKey]?.token?.toLowerCase() !==
        artifact.tokens?.[ROUTES[routeKey].xphereTokenKey]?.toLowerCase()
    ) {
      fail(`${chain.artifact} bridgeRoutes.${routeKey}: synthetic token must match tokens.${ROUTES[routeKey].xphereTokenKey}`);
    }
  }
}

async function main() {
  const [localXphere, localEthereum] = await Promise.all([
    readOptionalJson("deployments/localhost.local.json"),
    readOptionalJson("deployments/local-ethereum.local.json"),
  ]);
  validateLocalDemo(localXphere, localEthereum);

  const production = {};
  for (const chainName of Object.keys(CHAINS)) {
    const path = resolve(REPO_DIR, "deployments", CHAINS[chainName].artifact);
    if (!existsSync(path)) {
      warn(`${CHAINS[chainName].artifact}: not present`);
      continue;
    }
    const artifact = await readArtifact(chainName);
    production[chainName] = artifact;
    validateProductionChain(chainName, artifact);
  }

  for (const routeKey of Object.keys(ROUTES)) {
    const routers = Object.values(production)
      .map((artifact) => artifact.bridgeRoutes?.[routeKey]?.router)
      .filter(isAddress)
      .map((value) => value.toLowerCase());
    if (routers.length > 1 && new Set(routers).size !== routers.length) {
      fail(`${routeKey}: router addresses must be unique across chains`);
    }
  }

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
