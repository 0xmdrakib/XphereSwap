import { ethers, network } from "hardhat";
import { MAINNET_ACK } from "./shared/config";

const MIN_DEPLOYER_BALANCE = ethers.parseEther(process.env.MIN_DEPLOYER_BALANCE || "0.05");

const NETWORK_REQUIREMENTS: Record<
  string,
  { chainId: number; rpcEnv?: string; mainnet?: boolean; safeRequired?: boolean }
> = {
  localhost: { chainId: 31337 },
  localEthereum: { chainId: 31338 },
  xphereTestnet: { chainId: 1998991, rpcEnv: "XPHERE_TESTNET_RPC_URL" },
  xphereMainnet: { chainId: 20250217, rpcEnv: "XPHERE_MAINNET_RPC_URL", mainnet: true, safeRequired: true },
  ethereumMainnet: { chainId: 1, rpcEnv: "ETHEREUM_MAINNET_RPC_URL", mainnet: true, safeRequired: true },
  sepolia: { chainId: 11155111, rpcEnv: "SEPOLIA_RPC_URL" },
};

const failures: string[] = [];
const warnings: string[] = [];
const oks: string[] = [];

function isAddress(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^0x[a-fA-F0-9]{40}$/.test(value) &&
      value.toLowerCase() !== "0x0000000000000000000000000000000000000000",
  );
}

function isPrivateKey(value: string | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));
}

function ok(message: string) {
  oks.push(message);
}

function warn(message: string) {
  warnings.push(message);
}

function fail(message: string) {
  failures.push(message);
}

function checkSafeEnv() {
  const admin = network.name === "xphereMainnet" && isAddress(process.env.XPHERE_PROTOCOL_ADMIN_SAFE)
    ? process.env.XPHERE_PROTOCOL_ADMIN_SAFE
    : process.env.PROTOCOL_ADMIN_SAFE;
  const treasury = network.name === "xphereMainnet" && isAddress(process.env.XPHERE_TREASURY_SAFE)
    ? process.env.XPHERE_TREASURY_SAFE
    : process.env.TREASURY_SAFE;
  const adminLabel = network.name === "xphereMainnet" && isAddress(process.env.XPHERE_PROTOCOL_ADMIN_SAFE)
    ? "XPHERE_PROTOCOL_ADMIN_SAFE"
    : "PROTOCOL_ADMIN_SAFE";
  const treasuryLabel = network.name === "xphereMainnet" && isAddress(process.env.XPHERE_TREASURY_SAFE)
    ? "XPHERE_TREASURY_SAFE"
    : "TREASURY_SAFE";
  if (!isAddress(admin)) fail(`${adminLabel} missing or invalid`);
  else ok(`${adminLabel} set`);
  if (!isAddress(treasury)) fail(`${treasuryLabel} missing or invalid`);
  else ok(`${treasuryLabel} set`);
  if (admin && treasury && admin.toLowerCase() === treasury.toLowerCase()) {
    fail(`${adminLabel} and ${treasuryLabel} must be different`);
  }

  const owners = [1, 2, 3, 4, 5].map((index) => process.env[`SAFE_OWNER_${index}`]);
  owners.forEach((owner, index) => {
    if (!isAddress(owner)) fail(`SAFE_OWNER_${index + 1} missing or invalid`);
  });
  const normalizedOwners = owners.filter(isAddress).map((owner) => owner.toLowerCase());
  if (normalizedOwners.length === 5 && new Set(normalizedOwners).size === 5) ok("Safe owners are unique");
  else fail("Safe owners must be 5 unique addresses");

  if (process.env.SAFE_THRESHOLD === "3") ok("SAFE_THRESHOLD is 3");
  else fail("SAFE_THRESHOLD must be 3");
}

async function main() {
  const requirement = NETWORK_REQUIREMENTS[network.name];
  if (!requirement) {
    warn(`No explicit preflight requirements for network ${network.name}`);
  }

  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  if (requirement && chainId !== requirement.chainId) {
    fail(`RPC chainId mismatch: expected ${requirement.chainId}, got ${chainId}`);
  } else {
    ok(`RPC chainId ${chainId}`);
  }

  if (requirement?.rpcEnv) {
    if (process.env[requirement.rpcEnv]) ok(`${requirement.rpcEnv} set`);
    else fail(`${requirement.rpcEnv} must be set explicitly`);
  }

  if (requirement?.mainnet) {
    if (process.env.MAINNET_BETA_ACK === MAINNET_ACK) ok("MAINNET_BETA_ACK set");
    else fail(`MAINNET_BETA_ACK must equal ${MAINNET_ACK}`);
  }

  if (network.name !== "localhost" && network.name !== "localEthereum" && !isPrivateKey(process.env.DEPLOYER_PRIVATE_KEY)) {
    fail("DEPLOYER_PRIVATE_KEY missing or invalid");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    fail("No deployer signer configured");
  } else {
    const address = await deployer.getAddress();
    const balance = await ethers.provider.getBalance(address);
    ok(`deployer ${address}`);
    if (balance < MIN_DEPLOYER_BALANCE) {
      fail(`deployer balance ${ethers.formatEther(balance)} below ${ethers.formatEther(MIN_DEPLOYER_BALANCE)}`);
    } else {
      ok(`deployer balance ${ethers.formatEther(balance)}`);
    }
  }

  if (requirement?.safeRequired) checkSafeEnv();

  if (warnings.length > 0) {
    console.warn(`Preflight warnings (${warnings.length}):`);
    for (const message of warnings) console.warn(`- ${message}`);
  }

  if (failures.length > 0) {
    console.error(`Preflight failed (${failures.length}):`);
    for (const message of failures) console.error(`- ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Preflight passed (${oks.length} checks).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
