import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const opsDir = resolve(scriptDir, "..");
const repoDir = resolve(opsDir, "../..");
const registryDir = resolve(opsDir, ".registry");
const windowsRegistryDir = "C:\\tmp\\xphere-hyperlane-registry";

const routeFiles = [
  {
    filename: "ethereum-xphere-usdc.yaml",
    asset: "USDC",
    id: "USDC/ethereum-xphere",
    deployName: "ethereum-xphere-deploy.yaml",
  },
  {
    filename: "ethereum-xphere-usdt.yaml",
    asset: "USDT",
    id: "USDT/ethereum-xphere",
    deployName: "ethereum-xphere-deploy.yaml",
  },
  {
    filename: "ethereum-xphere-native.yaml",
    asset: "ETH",
    id: "ETH/ethereum-xphere",
    deployName: "ethereum-xphere-deploy.yaml",
  },
];

const requiredAddressKeys = [
  "PROTOCOL_ADMIN_SAFE",
  "HYPERLANE_VALIDATOR_1",
  "HYPERLANE_VALIDATOR_2",
  "HYPERLANE_VALIDATOR_3",
];

function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) && normalized !== "0x0000000000000000000000000000000000000000";
}

async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(repoDir, ".env");
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

function assertEnv(env) {
  const missing = requiredAddressKeys.filter((key) => !isAddress(env[key]));
  if (missing.length > 0) {
    throw new Error(`Cannot render Warp Route configs; missing/invalid address env: ${missing.join(", ")}`);
  }

  const validators = requiredAddressKeys
    .filter((key) => key.startsWith("HYPERLANE_VALIDATOR_"))
    .map((key) => env[key].toLowerCase());
  if (new Set(validators).size !== validators.length) {
    throw new Error("Cannot render Warp Route configs; Hyperlane validators must be unique");
  }
}

function renderTemplate(raw, env) {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key) => {
    if (env[key] === undefined || env[key] === "") {
      throw new Error(`Template placeholder ${match} is not set in .env`);
    }
    return env[key];
  });
}

function deployType(tokenType) {
  if (tokenType === "collateralNative") return "native";
  if (tokenType === "synthetic") return "synthetic";
  if (tokenType === "collateral") return "collateral";
  throw new Error(`Unsupported Warp Route token type ${tokenType}`);
}

function toDeployConfig(rendered, env) {
  const parsed = YAML.parse(rendered);
  const ownerForChain = (chainName) =>
    chainName === "xphere" && isAddress(env.XPHERE_PROTOCOL_ADMIN_SAFE)
      ? env.XPHERE_PROTOCOL_ADMIN_SAFE
      : env.PROTOCOL_ADMIN_SAFE;
  const interchainSecurityModule = parsed.options?.interchainSecurityModule
    ? {
        ...parsed.options.interchainSecurityModule,
        validators: [
          env.HYPERLANE_VALIDATOR_1,
          env.HYPERLANE_VALIDATOR_2,
          env.HYPERLANE_VALIDATOR_3,
        ],
      }
    : undefined;
  const deploy = {};
  for (const token of parsed.tokens || []) {
    const owner = ownerForChain(token.chainName);
    const item = {
      type: deployType(token.type),
      owner,
      proxyAdmin: {
        owner,
      },
      interchainSecurityModule,
    };

    if (token.addressOrDenom) item.token = token.addressOrDenom;
    if (token.name) item.name = token.name;
    if (token.symbol) item.symbol = token.symbol;
    if (token.decimals !== undefined) item.decimals = token.decimals;

    deploy[token.chainName] = item;
  }

  return YAML.stringify(deploy);
}

async function writeRegistryRoute(route, renderedDeployConfig) {
  const relativeDir = ["deployments", "warp_routes", route.asset];
  const repoRouteDir = resolve(registryDir, ...relativeDir);
  await mkdir(repoRouteDir, { recursive: true });
  await writeFile(resolve(repoRouteDir, route.deployName), renderedDeployConfig);

  if (process.platform === "win32") {
    const windowsRouteDir = resolve(windowsRegistryDir, ...relativeDir);
    await mkdir(windowsRouteDir, { recursive: true });
    await writeFile(resolve(windowsRouteDir, route.deployName), renderedDeployConfig);
  }
}

async function main() {
  const env = await readEnv();
  assertEnv(env);

  const outputDir = resolve(opsDir, "generated");
  await mkdir(outputDir, { recursive: true });

  const ids = [];
  for (const route of routeFiles) {
    const inputPath = resolve(opsDir, "warp-routes", route.filename);
    const outputPath = resolve(outputDir, route.filename);
    const rendered = renderTemplate(await readFile(inputPath, "utf8"), env);
    await writeFile(outputPath, rendered);
    await writeRegistryRoute(route, toDeployConfig(rendered, env));
    ids.push(route.id);
    console.log(`Rendered ops/hyperlane/generated/${route.filename}`);
    console.log(`Wrote local registry route ${route.id}`);
  }
  console.log(`Warp Route IDs: ${ids.join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
