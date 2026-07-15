import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IsmConfigSchema } from "@hyperlane-xyz/sdk";
import YAML from "yaml";
import {
  CHAINS,
  OPS_DIR,
  REGISTRY_DIR,
  ROUTES,
  WINDOWS_REGISTRY_DIR,
  initialIsmConfig,
  isAddress,
  readEnv,
  validateBridgeOperators,
  validatorsFromEnv,
} from "./bridge-config.mjs";

function deployType(tokenType) {
  if (tokenType === "collateralNative") return "native";
  if (tokenType === "synthetic") return "synthetic";
  if (tokenType === "collateral") return "collateral";
  throw new Error(`Unsupported Warp Route token type ${tokenType}`);
}

function assertInputs(env) {
  const required = [
    ...Object.values(CHAINS).map((chain) => chain.ownerEnv),
    "HYPERLANE_VALIDATOR_1",
    "HYPERLANE_VALIDATOR_2",
    "HYPERLANE_VALIDATOR_3",
  ];
  const missing = required.filter((key) => !isAddress(env[key]));
  if (missing.length > 0) {
    throw new Error(`Cannot render Warp Routes; missing/invalid address env: ${missing.join(", ")}`);
  }
  const operatorErrors = validateBridgeOperators(env);
  if (operatorErrors.length > 0) throw new Error(operatorErrors.join("; "));
}

function toDeployConfig(template, env) {
  const validators = validatorsFromEnv(env);
  const deploy = {};
  for (const token of template.tokens || []) {
    const chain = CHAINS[token.chainName];
    if (!chain) throw new Error(`Unknown route chain ${token.chainName}`);
    const owner = env[chain.ownerEnv];
    const interchainSecurityModule = initialIsmConfig(owner, validators);
    IsmConfigSchema.parse(interchainSecurityModule);
    const item = {
      type: deployType(token.type),
      owner,
      proxyAdmin: { owner },
      interchainSecurityModule,
    };
    if (token.addressOrDenom) item.token = token.addressOrDenom;
    if (token.name) item.name = token.name;
    if (token.symbol) item.symbol = token.symbol;
    if (token.decimals !== undefined) item.decimals = token.decimals;
    deploy[token.chainName] = item;
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
  assertInputs(env);
  const outputDir = resolve(OPS_DIR, "generated");
  await mkdir(outputDir, { recursive: true });

  for (const route of Object.values(ROUTES)) {
    const raw = await readFile(resolve(OPS_DIR, "warp-routes", route.template), "utf8");
    const template = YAML.parse(raw);
    if (template.routeId !== route.id) throw new Error(`${route.template}: routeId mismatch`);
    const rendered = YAML.stringify(toDeployConfig(template, env));
    await writeFile(resolve(outputDir, route.generatedDeployName), rendered);
    await writeRegistryConfig(route, rendered);
    console.log(`Rendered phase-one route ${route.id}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
