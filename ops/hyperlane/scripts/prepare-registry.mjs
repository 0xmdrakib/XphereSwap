import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const opsDir = resolve(scriptDir, "..");
const repoDir = resolve(opsDir, "..", "..");
const registryDir = resolve(opsDir, ".registry");
const windowsRegistryDir = "C:\\tmp\\xphere-hyperlane-registry";
const xphereChainDir = resolve(registryDir, "chains", "xphere");
const windowsXphereChainDir = resolve(windowsRegistryDir, "chains", "xphere");
const xphereArtifactPath = resolve(repoDir, "deployments", "xphere-mainnet.local.json");

const CORE_KEYS = {
  hyperlaneMailbox: "mailbox",
  hyperlaneInterchainGasPaymaster: "interchainGasPaymaster",
  hyperlaneValidatorAnnounce: "validatorAnnounce",
  hyperlaneInterchainSecurityModule: "interchainSecurityModule",
  hyperlaneProxyAdmin: "proxyAdmin",
};

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

async function readArtifact() {
  if (!existsSync(xphereArtifactPath)) return undefined;
  return JSON.parse(await readFile(xphereArtifactPath, "utf8"));
}

async function main() {
  await mkdir(xphereChainDir, { recursive: true });
  if (process.platform === "win32") await mkdir(windowsXphereChainDir, { recursive: true });
  await mkdir(resolve(opsDir, "generated"), { recursive: true });
  const metadataSource = resolve(opsDir, "chains", "xphere-mainnet.yaml");
  await copyFile(metadataSource, resolve(xphereChainDir, "metadata.yaml"));
  if (process.platform === "win32") {
    await copyFile(metadataSource, resolve(windowsXphereChainDir, "metadata.yaml"));
  }

  const artifact = await readArtifact();
  const lines = [];
  for (const [artifactKey, registryKey] of Object.entries(CORE_KEYS)) {
    const value = artifact?.contracts?.[artifactKey];
    if (isAddress(value)) lines.push(`${registryKey}: "${value}"`);
  }

  if (lines.length > 0) {
    const addresses = `${lines.join("\n")}\n`;
    await writeFile(resolve(xphereChainDir, "addresses.yaml"), addresses);
    if (process.platform === "win32") {
      await writeFile(resolve(windowsXphereChainDir, "addresses.yaml"), addresses);
    }
    console.log(`Prepared Hyperlane registry at ${registryDir}`);
    if (process.platform === "win32") console.log(`Prepared Windows-safe registry mirror at ${windowsRegistryDir}`);
    console.log(`Wrote xphere addresses.yaml with ${lines.length} core address(es).`);
  } else {
    console.log(`Prepared Hyperlane registry at ${registryDir}`);
    if (process.platform === "win32") console.log(`Prepared Windows-safe registry mirror at ${windowsRegistryDir}`);
    console.log("No Xphere Hyperlane core addresses recorded yet; run bridge:record-core after core deployment.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
