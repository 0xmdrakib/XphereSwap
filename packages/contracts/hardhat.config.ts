import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: "../../.env" });
dotenv.config();

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];
const localhostAccounts = deployerKey ? [deployerKey] : "remote";
const hardhatChainId = Number(process.env.HARDHAT_CHAIN_ID || 31337);

const xphereMainnetRpc =
  process.env.XPHERE_MAINNET_RPC_URL || "https://en-hkg.x-phere.com";
const xphereTestnetRpc =
  process.env.XPHERE_TESTNET_RPC_URL || "https://testnet.x-phere.com";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      {
        version: "0.6.6",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: false,
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: hardhatChainId,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: localhostAccounts,
    },
    localEthereum: {
      url: "http://127.0.0.1:8546",
      chainId: 31338,
      accounts: localhostAccounts,
    },
    xphereMainnet: {
      url: xphereMainnetRpc,
      chainId: 20250217,
      accounts,
    },
    xphereTestnet: {
      url: xphereTestnetRpc,
      chainId: 1998991,
      accounts,
    },
    ethereumMainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC_URL || "http://127.0.0.1:8545",
      chainId: 1,
      accounts,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "http://127.0.0.1:8545",
      chainId: 11155111,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      xphereMainnet: process.env.TAMSA_API_KEY || "verifyplaceholder",
      xphereTestnet: process.env.TAMSA_API_KEY || "verifyplaceholder",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "xphereMainnet",
        chainId: 20250217,
        urls: {
          apiURL: "https://xp.tamsa.io/api",
          browserURL: "https://xp.tamsa.io",
        },
      },
      {
        network: "xphereTestnet",
        chainId: 1998991,
        urls: {
          apiURL: "https://xpt.tamsa.io/api",
          browserURL: "https://xpt.tamsa.io",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
