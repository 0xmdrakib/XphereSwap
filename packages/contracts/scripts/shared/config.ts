import { network } from "hardhat";

export const XPHERE_MAINNET = {
  name: "xphereMainnet",
  chainId: 20250217,
  nativeCurrency: { name: "Xphere", symbol: "XP", decimals: 18 },
  rpcUrls: ["https://en-hkg.x-phere.com", "https://en-bkk.x-phere.com", "https://mainnet.xphere-rpc.com"],
  explorer: "https://xp.tamsa.io",
};

export const XPHERE_TESTNET = {
  name: "xphereTestnet",
  chainId: 1998991,
  nativeCurrency: { name: "Xphere Testnet", symbol: "XPT", decimals: 18 },
  rpcUrls: ["https://testnet.x-phere.com"],
  explorer: "https://xpt.tamsa.io",
};

export const ETHEREUM_MAINNET_TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};

export const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

export type DeploymentArtifact = {
  chainId: number;
  contracts: Record<string, string>;
  tokens: Record<string, string | null>;
  router: string | null;
  factory: string | null;
  initCodeHash: string | null;
  bridgeRoutes: Record<string, unknown>;
};

export function deploymentFilename(networkName: string): string {
  const names: Record<string, string> = {
    localhost: "localhost.local.json",
    localEthereum: "local-ethereum.local.json",
    xphereMainnet: "xphere-mainnet.local.json",
    xphereTestnet: "xphere-testnet.local.json",
    ethereumMainnet: "ethereum-mainnet.local.json",
    sepolia: "ethereum-sepolia.local.json",
  };
  return names[networkName] || `${networkName}.local.json`;
}

export function requireAddressEnv(name: string): string {
  const value = process.env[name];
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value) || value.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${name} must be a non-zero checksummed or lowercase EVM address`);
  }
  return value;
}

export function assertMainnetBetaGates(): void {
  if (!["xphereMainnet", "ethereumMainnet"].includes(network.name)) {
    return;
  }

  if (process.env.MAINNET_BETA_ACK !== MAINNET_ACK) {
    throw new Error(`Refusing mainnet deploy: set MAINNET_BETA_ACK=${MAINNET_ACK}`);
  }

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("Refusing mainnet deploy: DEPLOYER_PRIVATE_KEY is required");
  }

  const adminSafe =
    network.name === "xphereMainnet" && process.env.XPHERE_PROTOCOL_ADMIN_SAFE
      ? requireAddressEnv("XPHERE_PROTOCOL_ADMIN_SAFE")
      : requireAddressEnv("PROTOCOL_ADMIN_SAFE");
  const treasurySafe =
    network.name === "xphereMainnet" && process.env.XPHERE_TREASURY_SAFE
      ? requireAddressEnv("XPHERE_TREASURY_SAFE")
      : requireAddressEnv("TREASURY_SAFE");
  if (adminSafe.toLowerCase() === treasurySafe.toLowerCase()) {
    throw new Error("PROTOCOL_ADMIN_SAFE and TREASURY_SAFE must be separate addresses");
  }

  const owners = [1, 2, 3, 4, 5].map((index) => requireAddressEnv(`SAFE_OWNER_${index}`));
  const uniqueOwners = new Set(owners.map((owner) => owner.toLowerCase()));
  if (uniqueOwners.size !== owners.length) {
    throw new Error("Safe owners must be unique");
  }

  if (process.env.SAFE_THRESHOLD !== "3") {
    throw new Error("SAFE_THRESHOLD must be 3 for the mainnet beta gate");
  }

  if (network.name === "xphereMainnet") {
    const rpc = process.env.XPHERE_MAINNET_RPC_URL?.replace(/\/$/, "");
    if (!rpc) {
      throw new Error("XPHERE_MAINNET_RPC_URL must be explicitly set for mainnet deploy");
    }
    if (PUBLIC_XPHERE_RPCS.has(rpc)) {
      throw new Error("XPHERE_MAINNET_RPC_URL is a public dev RPC; use a dedicated endpoint for mainnet deploy");
    }
  }

  if (network.name === "ethereumMainnet" && !process.env.ETHEREUM_MAINNET_RPC_URL) {
    throw new Error("ETHEREUM_MAINNET_RPC_URL must be explicitly set for mainnet deploy");
  }
}

export function requireAdminSafe(): string {
  if (network.name === "xphereMainnet" && process.env.XPHERE_PROTOCOL_ADMIN_SAFE) {
    return requireAddressEnv("XPHERE_PROTOCOL_ADMIN_SAFE");
  }
  if (["xphereMainnet", "ethereumMainnet"].includes(network.name)) {
    return requireAddressEnv("PROTOCOL_ADMIN_SAFE");
  }
  return process.env.PROTOCOL_ADMIN_SAFE || "";
}
