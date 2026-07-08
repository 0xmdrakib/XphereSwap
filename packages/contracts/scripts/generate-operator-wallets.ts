import { Wallet } from "ethers";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const docsDir = resolve(repoRoot, "docs");
const secretsPath = resolve(docsDir, "operator-hot-wallets.local.secret.json");
const valuesPath = resolve(docsDir, "operator-values.generated.local.json");
const force = process.argv.includes("--force");

type WalletRecord = {
  address: string;
  privateKey: string;
  purpose: string;
};

function wallet(purpose: string): WalletRecord {
  const item = Wallet.createRandom();
  return {
    address: item.address,
    privateKey: item.privateKey,
    purpose,
  };
}

async function main() {
  if (!force && (existsSync(secretsPath) || existsSync(valuesPath))) {
    throw new Error(
      "Operator wallet files already exist. Move them somewhere safe or rerun with --force to replace them.",
    );
  }

  const deployer = wallet("Deploys Xphere swap contracts and Hyperlane contracts; fund with XP and ETH.");
  const safeOwners = [1, 2, 3, 4, 5].map((index) =>
    wallet(`Protocol multisig owner ${index}; import into separate secure wallets before public beta.`),
  );
  const validators = [1, 2, 3].map((index) =>
    wallet(`Hyperlane validator ${index}; run on a separate host for beta.`),
  );
  const relayer = wallet("Hyperlane relayer funding/monitoring wallet; fund with operational gas.");
  const reviewedAt = new Date().toISOString();

  const values = {
    DEPLOYER_PRIVATE_KEY: deployer.privateKey,
    MAINNET_BETA_ACK: "I_UNDERSTAND_MAINNET_BETA",
    SAFE_OWNER_1: safeOwners[0].address,
    SAFE_OWNER_2: safeOwners[1].address,
    SAFE_OWNER_3: safeOwners[2].address,
    SAFE_OWNER_4: safeOwners[3].address,
    SAFE_OWNER_5: safeOwners[4].address,
    SAFE_THRESHOLD: "3",
    HYPERLANE_VALIDATOR_1: validators[0].address,
    HYPERLANE_VALIDATOR_2: validators[1].address,
    HYPERLANE_VALIDATOR_3: validators[2].address,
    HYPERLANE_RELAYER_ADDRESS: relayer.address,
    BRIDGE_CAPS_ACTIVE: "true",
    BRIDGE_CAPS_LAST_REVIEWED_AT: reviewedAt,
  };

  const secrets = {
    generatedAt: reviewedAt,
    warning:
      "Keep this file offline and uncommitted. These are live hot-wallet keys. For public beta, migrate admin authority to real Safe-controlled wallets.",
    deployer,
    safeOwners,
    validators,
    relayer,
    valuesFile: "docs/operator-values.generated.local.json",
  };

  await mkdir(docsDir, { recursive: true });
  await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`);
  await writeFile(valuesPath, `${JSON.stringify(values, null, 2)}\n`);

  console.log("Generated operator hot wallets.");
  console.log(`Secret keys: ${secretsPath}`);
  console.log(`Env values:  ${valuesPath}`);
  console.log("");
  console.log("Addresses to fund/use:");
  console.log(`- deployer: ${deployer.address}`);
  console.log(`- relayer:  ${relayer.address}`);
  validators.forEach((item, index) => console.log(`- validator ${index + 1}: ${item.address}`));
  safeOwners.forEach((item, index) => console.log(`- Safe owner ${index + 1}: ${item.address}`));
  console.log("");
  console.log("Still required from operator: dedicated RPC URLs, PROTOCOL_ADMIN_SAFE, TREASURY_SAFE, and funds.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
