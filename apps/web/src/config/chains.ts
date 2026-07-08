import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import { mainnet, sepolia } from "wagmi/chains";

const compact = <T,>(items: Array<T | undefined | "">): T[] => items.filter(Boolean) as T[];

export const xphereRpcUrls = compact([
  import.meta.env.VITE_XPHERE_MAINNET_RPC_URL,
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

export const xphereTestnetRpcUrls = compact([
  import.meta.env.VITE_XPHERE_TESTNET_RPC_URL,
  "https://testnet.x-phere.com",
]);

export const usesDedicatedXphereRpc = Boolean(import.meta.env.VITE_XPHERE_MAINNET_RPC_URL);

export const xphere = defineChain({
  id: 20250217,
  name: "Xphere Mainnet",
  nativeCurrency: { name: "Xphere", symbol: "XP", decimals: 18 },
  rpcUrls: {
    default: { http: xphereRpcUrls },
  },
  blockExplorers: {
    default: { name: "Tamsa Explorer", url: "https://xp.tamsa.io" },
  },
});

export const xphereTestnet = defineChain({
  id: 1998991,
  name: "Xphere Testnet",
  nativeCurrency: { name: "Xphere Testnet", symbol: "XPT", decimals: 18 },
  rpcUrls: {
    default: { http: xphereTestnetRpcUrls },
  },
  blockExplorers: {
    default: { name: "Tamsa Testnet", url: "https://xpt.tamsa.io" },
  },
});

export const localHardhat = defineChain({
  id: 31337,
  name: "Local Xphere Demo",
  nativeCurrency: { name: "Local XP", symbol: "XP", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

export const localEthereum = defineChain({
  id: 31338,
  name: "Local Ethereum Demo",
  nativeCurrency: { name: "Local ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8546"] },
  },
});

export const isLocalSwap = import.meta.env.VITE_SWAP_CHAIN === "localhost";
export const isXphereTestnetSwap = import.meta.env.VITE_SWAP_CHAIN === "xphere-testnet";
export const isLocalBridge = import.meta.env.VITE_BRIDGE_MODE === "local";
export const swapChain = isLocalSwap ? localHardhat : isXphereTestnetSwap ? xphereTestnet : xphere;
export const bridgeEthereumChain = isLocalBridge ? localEthereum : mainnet;
export const bridgeXphereChain = isLocalBridge ? localHardhat : isXphereTestnetSwap ? xphereTestnet : xphere;

export const hyperlaneDomains = {
  ethereum: 1,
  xphere: 20250217,
  xphereTestnet: 1998991,
  localEthereum: 31338,
  localXphere: 31337,
} as const;

export const wagmiConfig = getDefaultConfig({
  appName: "Xphere Swap",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "xphere-swap-dev",
  wallets: [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, rabbyWallet, injectedWallet, walletConnectWallet],
    },
  ],
  chains: [localHardhat, localEthereum, xphere, mainnet, xphereTestnet, sepolia],
  ssr: false,
});
