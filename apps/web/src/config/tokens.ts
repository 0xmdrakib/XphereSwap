import { Address } from "viem";
import { deployments } from "./deployments";
import { swapChain } from "./chains";

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
    symbol: "XEF",
    name: "XEFFY",
    chainId: swapChain.id,
    decimals: 18,
    address: deployments.xphere.xef,
    verified: Boolean(deployments.xphere.xef && import.meta.env.VITE_XEF_OFFICIAL_VERIFIED !== "false"),
  },
].filter((token) => Boolean(token.address));
