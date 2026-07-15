import { JsonRpcProvider, Wallet, formatEther, formatUnits, parseEther } from "ethers";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../.env") });
dotenv.config();

type FundingCheck = {
  name: string;
  rpcEnv: string;
  expectedChainId: number;
  nativeSymbol: string;
  minEnv: string;
  defaultMin: string;
  required: boolean;
};

const swapMvpMode =
  process.env.DEPLOY_XPHERE_SWAP_MVP === "true" ||
  process.env.XPHERE_SWAP_MVP === "true" ||
  process.env.DEPLOY_XPHERE_ONLY_MVP === "true";

const checks: FundingCheck[] = [
  {
    name: "Xphere mainnet",
    rpcEnv: "XPHERE_MAINNET_RPC_URL",
    expectedChainId: 20250217,
    nativeSymbol: "XP",
    minEnv: "MIN_XPHERE_DEPLOYER_XP",
    defaultMin: "1",
    required: true,
  },
  {
    name: "Ethereum mainnet",
    rpcEnv: "ETHEREUM_MAINNET_RPC_URL",
    expectedChainId: 1,
    nativeSymbol: "ETH",
    minEnv: "MIN_ETHEREUM_DEPLOYER_ETH",
    defaultMin: "0.1",
    required: !swapMvpMode,
  },
  {
    name: "Base mainnet",
    rpcEnv: "BASE_MAINNET_RPC_URL",
    expectedChainId: 8453,
    nativeSymbol: "ETH",
    minEnv: "MIN_BASE_DEPLOYER_ETH",
    defaultMin: "0.05",
    required: !swapMvpMode,
  },
  {
    name: "Sepolia",
    rpcEnv: "SEPOLIA_RPC_URL",
    expectedChainId: 11155111,
    nativeSymbol: "ETH",
    minEnv: "MIN_SEPOLIA_DEPLOYER_ETH",
    defaultMin: "0.05",
    required: false,
  },
];

const rows: Array<{ status: "OK" | "WARN" | "FAIL"; label: string; detail: string }> = [];

function add(status: "OK" | "WARN" | "FAIL", label: string, detail: string) {
  rows.push({ status, label, detail });
}

function isPrivateKey(value: string | undefined): value is string {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));
}

function isUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function probeNetwork(wallet: Wallet, check: FundingCheck) {
  const rpc = process.env[check.rpcEnv];
  if (check.rpcEnv === "SEPOLIA_RPC_URL" && process.env.SKIP_SEPOLIA_REHEARSAL === "true") {
    add("OK", `${check.name} RPC`, "Sepolia rehearsal intentionally skipped by operator");
    return;
  }
  if (!isUrl(rpc)) {
    add(check.required ? "FAIL" : "WARN", `${check.name} RPC`, `${check.rpcEnv} missing or invalid`);
    return;
  }

  const provider = new JsonRpcProvider(rpc);
  const min = parseEther(process.env[check.minEnv] || check.defaultMin);

  try {
    const [network, blockNumber, feeData, balance] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getFeeData(),
      provider.getBalance(wallet.address),
    ]);
    const chainId = Number(network.chainId);
    if (chainId === check.expectedChainId) {
      add("OK", `${check.name} chainId`, String(chainId));
    } else {
      add("FAIL", `${check.name} chainId`, `expected ${check.expectedChainId}, got ${chainId}`);
    }
    add("OK", `${check.name} block`, String(blockNumber));
    add(
      balance >= min ? "OK" : check.required ? "FAIL" : "WARN",
      `${check.name} deployer balance`,
      `${formatEther(balance)} ${check.nativeSymbol}; minimum ${formatEther(min)} ${check.nativeSymbol}${check.required ? "" : " for bridge/full beta"}`,
    );
    if (feeData.gasPrice) {
      add("OK", `${check.name} gas price`, `${formatUnits(feeData.gasPrice, "gwei")} gwei`);
    } else {
      add("WARN", `${check.name} gas price`, "provider did not return gasPrice");
    }
  } catch (error) {
    add(check.required ? "FAIL" : "WARN", `${check.name} probe`, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  if (!isPrivateKey(process.env.DEPLOYER_PRIVATE_KEY)) {
    add("FAIL", "DEPLOYER_PRIVATE_KEY", "missing or invalid 32-byte private key");
  } else {
    const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY);
    add("OK", "deployer address", wallet.address);
    if (swapMvpMode) {
      add("WARN", "funding mode", "Xphere swap MVP mode: Ethereum gas is not required until bridge deployment");
    }
    for (const check of checks) {
      await probeNetwork(wallet, check);
    }
  }

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { OK: 0, WARN: 0, FAIL: 0 },
  );

  console.log("Mainnet funding probe:");
  for (const row of rows) {
    console.log(`[${row.status}] ${row.label} - ${row.detail}`);
  }
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.FAIL} failures`);

  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
