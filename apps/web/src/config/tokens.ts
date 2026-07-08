import { Address } from "viem";
import { deployments } from "./deployments";
import { isLocalBridge, swapChain } from "./chains";

export type TokenConfig = {
  symbol: string;
  name: string;
  chainId: number;
  decimals: number;
  address?: Address;
  verified: boolean;
  native?: boolean;
  badge?: string;
  note?: string;
};

export const xphereSwapTokens: TokenConfig[] = [
  {
    symbol: "XP",
    name: "Xphere",
    chainId: swapChain.id,
    decimals: 18,
    address: deployments.xphere.wxp,
    verified: true,
    native: true,
  },
  {
    symbol: "WXP",
    name: "Wrapped Xphere",
    chainId: swapChain.id,
    decimals: 18,
    address: deployments.xphere.wxp,
    verified: true,
  },
  {
    symbol: "xETH",
    name: "Xphere Bridged ETH",
    chainId: swapChain.id,
    decimals: 18,
    address: deployments.xphere.xeth,
    verified: true,
  },
  {
    symbol: "xUSDC",
    name: "Xphere Bridged USDC",
    chainId: swapChain.id,
    decimals: 6,
    address: deployments.xphere.xusdc,
    verified: true,
  },
  {
    symbol: "xUSDT",
    name: "Xphere Bridged USDT",
    chainId: swapChain.id,
    decimals: 6,
    address: deployments.xphere.xusdt,
    verified: true,
  },
  {
    symbol: "XEF",
    name: "XEFFY",
    chainId: swapChain.id,
    decimals: 18,
    address: deployments.xphere.xef,
    verified: Boolean(deployments.xphere.xef && import.meta.env.VITE_XEF_OFFICIAL_VERIFIED !== "false"),
  },
].filter((token) => Boolean(token.address));

export const bridgeAssets = [
  {
    symbol: isLocalBridge ? "ETH/XP" : "ETH",
    sourceSymbol: "ETH",
    destinationSymbol: isLocalBridge ? "XP" : "xETH",
    decimals: 18,
    ethereumNative: true,
    xphereNative: isLocalBridge,
    ethereumToken: undefined,
    xphereToken: isLocalBridge ? undefined : deployments.xphere.xeth,
    ethereumRouter: deployments.ethereum.nativeWarpRouter,
    xphereRouter: deployments.xphere.nativeWarpRouter,
  },
  {
    symbol: "USDC",
    sourceSymbol: "USDC",
    destinationSymbol: "xUSDC",
    decimals: 6,
    ethereumNative: false,
    xphereNative: false,
    ethereumToken: deployments.ethereum.usdc,
    xphereToken: deployments.xphere.xusdc,
    ethereumRouter: deployments.ethereum.usdcWarpRouter,
    xphereRouter: deployments.xphere.usdcWarpRouter,
  },
  {
    symbol: "USDT",
    sourceSymbol: "USDT",
    destinationSymbol: "xUSDT",
    decimals: 6,
    ethereumNative: false,
    xphereNative: false,
    ethereumToken: deployments.ethereum.usdt,
    xphereToken: deployments.xphere.xusdt,
    ethereumRouter: deployments.ethereum.usdtWarpRouter,
    xphereRouter: deployments.xphere.usdtWarpRouter,
  },
] as const;
