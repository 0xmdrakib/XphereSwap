import { getAddress, isAddress, type Address, type Chain } from "viem";
import { bridgeBaseChain, bridgeEthereumChain, bridgeXphereChain, hyperlaneDomains } from "../../config/chains";
import { deployments } from "../../config/deployments";

export type BridgeChainKey = "ethereum" | "base" | "xphere";
export type BridgeAssetKey = "eth" | "usdc";

export type BridgeChainConfig = {
  key: BridgeChainKey;
  chain: Chain;
  domain: number;
  mailbox?: Address;
  explorer: string;
};

export type BridgeAssetConfig = {
  key: BridgeAssetKey;
  label: string;
  decimals: number;
  dailyCapLabel: string;
  chain: Record<
    BridgeChainKey,
    {
      symbol: string;
      native: boolean;
      token?: Address;
      router?: Address;
    }
  >;
};

declare global {
  interface Window {
    __XPHERE_BRIDGE_TEST_CONFIG__?: Record<string, string>;
  }
}

function runtimeValue(key: string) {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  return window.__XPHERE_BRIDGE_TEST_CONFIG__?.[key];
}

function runtimeAddress(key: string, fallback?: Address) {
  const value = runtimeValue(key);
  return value && isAddress(value) ? getAddress(value) : fallback;
}

export const bridgeChains: Record<BridgeChainKey, BridgeChainConfig> = {
  ethereum: {
    key: "ethereum",
    chain: bridgeEthereumChain,
    domain: hyperlaneDomains.ethereum,
    mailbox: runtimeAddress("VITE_ETHEREUM_MAILBOX", deployments.ethereum.mailbox),
    explorer: "https://etherscan.io",
  },
  base: {
    key: "base",
    chain: bridgeBaseChain,
    domain: hyperlaneDomains.base,
    mailbox: runtimeAddress("VITE_BASE_MAILBOX", deployments.base.mailbox),
    explorer: "https://basescan.org",
  },
  xphere: {
    key: "xphere",
    chain: bridgeXphereChain,
    domain: hyperlaneDomains.xphere,
    mailbox: runtimeAddress("VITE_XPHERE_MAILBOX", deployments.xphere.mailbox),
    explorer: "https://xp.tamsa.io",
  },
};

export const bridgeAssets: Record<BridgeAssetKey, BridgeAssetConfig> = {
  eth: {
    key: "eth",
    label: "ETH",
    decimals: 18,
    dailyCapLabel: "Operator-reviewed ETH cap",
    chain: {
      ethereum: {
        symbol: "ETH",
        native: true,
        router: runtimeAddress("VITE_ETHEREUM_NATIVE_WARP_ROUTER", deployments.ethereum.nativeWarpRouter),
      },
      base: {
        symbol: "ETH",
        native: true,
        router: runtimeAddress("VITE_BASE_NATIVE_WARP_ROUTER", deployments.base.nativeWarpRouter),
      },
      xphere: {
        symbol: "xETH",
        native: false,
        token: runtimeAddress("VITE_XPHERE_XETH", deployments.xphere.xeth),
        router: runtimeAddress("VITE_XPHERE_NATIVE_WARP_ROUTER", deployments.xphere.nativeWarpRouter),
      },
    },
  },
  usdc: {
    key: "usdc",
    label: "USDC",
    decimals: 6,
    dailyCapLabel: "About 25,000 USDC/day",
    chain: {
      ethereum: {
        symbol: "USDC",
        native: false,
        token: deployments.ethereum.usdc,
        router: runtimeAddress("VITE_ETHEREUM_USDC_WARP_ROUTER", deployments.ethereum.usdcWarpRouter),
      },
      base: {
        symbol: "USDC",
        native: false,
        token: deployments.base.usdc,
        router: runtimeAddress("VITE_BASE_USDC_WARP_ROUTER", deployments.base.usdcWarpRouter),
      },
      xphere: {
        symbol: "xUSDC",
        native: false,
        token: runtimeAddress("VITE_XPHERE_XUSDC", deployments.xphere.xusdc),
        router: runtimeAddress("VITE_XPHERE_USDC_WARP_ROUTER", deployments.xphere.usdcWarpRouter),
      },
    },
  },
};

export const bridgeReleased =
  import.meta.env.VITE_BRIDGE_RELEASED === "true" || runtimeValue("VITE_BRIDGE_RELEASED") === "true";

export function isSupportedBridgePair(source: BridgeChainKey, destination: BridgeChainKey) {
  return source !== destination && (source === "xphere" || destination === "xphere");
}

export function destinationOptions(source: BridgeChainKey): BridgeChainKey[] {
  return source === "xphere" ? ["ethereum", "base"] : ["xphere"];
}

export function routeConfigured(
  source: BridgeChainKey,
  destination: BridgeChainKey,
  asset: BridgeAssetKey,
  assets: Record<BridgeAssetKey, BridgeAssetConfig> = bridgeAssets,
  chains: Record<BridgeChainKey, BridgeChainConfig> = bridgeChains,
) {
  if (!isSupportedBridgePair(source, destination)) return false;
  const sourceAsset = assets[asset].chain[source];
  const destinationAsset = assets[asset].chain[destination];
  return Boolean(
    chains[source].mailbox &&
      chains[destination].mailbox &&
      sourceAsset.router &&
      destinationAsset.router &&
      (sourceAsset.native || sourceAsset.token) &&
      (destinationAsset.native || destinationAsset.token),
  );
}

export function bridgeConfigurationComplete(
  assets: Record<BridgeAssetKey, BridgeAssetConfig> = bridgeAssets,
  chains: Record<BridgeChainKey, BridgeChainConfig> = bridgeChains,
) {
  return (Object.keys(assets) as BridgeAssetKey[]).every((asset) =>
  ([
    ["ethereum", "xphere"],
    ["base", "xphere"],
    ["xphere", "ethereum"],
    ["xphere", "base"],
  ] as Array<[BridgeChainKey, BridgeChainKey]>).every(([source, destination]) =>
    routeConfigured(source, destination, asset, assets, chains),
  ),
  );
}

export const bridgeConfigComplete = bridgeConfigurationComplete();

export const bridgeTransactionsEnabled = bridgeReleased && bridgeConfigComplete;
