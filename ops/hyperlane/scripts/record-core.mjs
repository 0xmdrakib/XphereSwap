import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "../../..");
const artifactPath = resolve(repoDir, "deployments", "xphere-mainnet.local.json");

const OPTION_KEYS = {
  mailbox: "hyperlaneMailbox",
  "interchain-gas-paymaster": "hyperlaneInterchainGasPaymaster",
  "validator-announce": "hyperlaneValidatorAnnounce",
  "interchain-security-module": "hyperlaneInterchainSecurityModule",
  "proxy-admin": "hyperlaneProxyAdmin",
};

function usage() {
  console.error(`Usage:
pnpm bridge:record-core --mailbox 0x... --interchain-gas-paymaster 0x... --validator-announce 0x... --interchain-security-module 0x... [--proxy-admin 0x...]`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) &&
    String(value).toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

function requireAddress(options, key) {
  const value = options[key];
  if (!isAddress(value)) throw new Error(`--${key} must be a non-zero EVM address`);
  return value;
}

async function readArtifact() {
  if (!existsSync(artifactPath)) {
    return {
      chainId: 20250217,
      contracts: {},
      tokens: {},
      router: null,
      factory: null,
      initCodeHash: null,
      bridgeRoutes: {},
    };
  }
  return JSON.parse(await readFile(artifactPath, "utf8"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of ["mailbox", "interchain-gas-paymaster", "validator-announce", "interchain-security-module"]) {
    requireAddress(options, required);
  }
  if (options["proxy-admin"]) requireAddress(options, "proxy-admin");

  const artifact = await readArtifact();
  artifact.contracts ||= {};
  artifact.tokens ||= {};
  artifact.bridgeRoutes ||= {};

  for (const [optionKey, artifactKey] of Object.entries(OPTION_KEYS)) {
    if (options[optionKey]) artifact.contracts[artifactKey] = options[optionKey];
  }

  await mkdir(resolve(repoDir, "deployments"), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log("Recorded Xphere Hyperlane core addresses.");
  console.log("Run pnpm bridge:prepare-registry to update the local Hyperlane registry.");
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
