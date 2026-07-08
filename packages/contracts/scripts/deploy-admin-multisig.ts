import { ethers, network } from "hardhat";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DeploymentArtifact,
  MAINNET_ACK,
  deploymentFilename,
  requireAddressEnv,
} from "./shared/config";

const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

function assertDeployAllowed() {
  if (!["localhost", "xphereTestnet", "xphereMainnet", "ethereumMainnet"].includes(network.name)) {
    throw new Error("deploy-admin-multisig only supports localhost, xphereTestnet, xphereMainnet, and ethereumMainnet");
  }

  if (!["xphereMainnet", "ethereumMainnet"].includes(network.name)) return;

  if (process.env.MAINNET_BETA_ACK !== MAINNET_ACK) {
    throw new Error(`Refusing mainnet admin deploy: set MAINNET_BETA_ACK=${MAINNET_ACK}`);
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("Refusing mainnet admin deploy: DEPLOYER_PRIVATE_KEY is required");
  }

  if (network.name === "xphereMainnet") {
    const rpc = process.env.XPHERE_MAINNET_RPC_URL?.replace(/\/$/, "");
    if (!rpc || PUBLIC_XPHERE_RPCS.has(rpc)) {
      throw new Error("Refusing mainnet admin deploy: use a dedicated XPHERE_MAINNET_RPC_URL");
    }
  }

  if (network.name === "ethereumMainnet") {
    if (!process.env.ETHEREUM_MAINNET_RPC_URL) {
      throw new Error("Refusing Ethereum admin deploy: ETHEREUM_MAINNET_RPC_URL is required");
    }
    if (process.env.ALLOW_ETHEREUM_PROTOCOL_MULTISIG !== "true") {
      throw new Error("Refusing Ethereum admin deploy: set ALLOW_ETHEREUM_PROTOCOL_MULTISIG=true to use ProtocolMultisig instead of a production Safe");
    }
  }
}

async function readExistingArtifact(path: string): Promise<DeploymentArtifact | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as DeploymentArtifact;
}

async function deployMultisig(label: string, owners: string[], threshold: bigint) {
  const factory = await ethers.getContractFactory("ProtocolMultisig");
  const contract = await factory.deploy(owners, threshold);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${label}: ${address}`);
  return address;
}

async function main() {
  assertDeployAllowed();

  const owners = [1, 2, 3, 4, 5].map((index) => requireAddressEnv(`SAFE_OWNER_${index}`));
  const threshold = BigInt(process.env.SAFE_THRESHOLD || "3");
  if (threshold !== 3n) throw new Error("SAFE_THRESHOLD must be 3");

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`network=${network.name} chainId=${chainId}`);
  console.log(`deployer=${deployerAddress}`);

  const protocolAdmin = await deployMultisig("ProtocolMultisig admin", owners, threshold);
  const treasury = await deployMultisig("ProtocolMultisig treasury", owners, threshold);
  if (protocolAdmin.toLowerCase() === treasury.toLowerCase()) {
    throw new Error("Admin and treasury multisig addresses unexpectedly match");
  }

  const outputDir = resolve(__dirname, "../../../deployments");
  const filename = deploymentFilename(network.name);
  const artifactPath = resolve(outputDir, filename);
  const existing = await readExistingArtifact(artifactPath);
  const artifact: DeploymentArtifact = {
    chainId,
    contracts: {
      ...(existing?.contracts || {}),
      protocolAdminMultisig: protocolAdmin,
      treasuryMultisig: treasury,
    },
    tokens: existing?.tokens || {},
    router: existing?.router || null,
    factory: existing?.factory || null,
    initCodeHash: existing?.initCodeHash || null,
    bridgeRoutes: existing?.bridgeRoutes || {},
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const valuesFilename =
    network.name === "ethereumMainnet"
      ? "operator-values.ethereum-admin.generated.local.json"
      : "operator-values.xphere-admin.generated.local.json";
  const valuesPath = resolve(__dirname, "../../../docs", valuesFilename);
  const values =
    network.name === "ethereumMainnet"
      ? {
          PROTOCOL_ADMIN_SAFE: protocolAdmin,
          TREASURY_SAFE: treasury,
        }
      : {
          XPHERE_PROTOCOL_ADMIN_SAFE: protocolAdmin,
          XPHERE_TREASURY_SAFE: treasury,
        };
  await mkdir(resolve(valuesPath, ".."), { recursive: true });
  await writeFile(valuesPath, `${JSON.stringify(values, null, 2)}\n`);

  console.log(`wrote deployments/${filename}`);
  console.log(`wrote docs/${valuesFilename}`);
  console.log(`Apply with: pnpm mainnet:set --file docs/${valuesFilename}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
