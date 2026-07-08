import { Address, getAddress, isAddress } from "viem";

const optionalAddress = (value: string | undefined): Address | undefined => {
  if (!value || !isAddress(value)) return undefined;
  return getAddress(value);
};

const publicXphereMainnet = {
  router: "0xCd42e90dC373a2807Ba2c5763A9186430f08bB84",
  factory: "0x86369FCffa2370E7b1353E46b1794678aE94efdF",
  wxp: "0xEce69Df85364bFA5c35F87802Acd35d9DD3379da",
  xef: "0x80252C2D06bbd85699c555fc3633D5B8eE67C9AD",
} as const;

const xphereMainnetDeployment = {
  router: optionalAddress(import.meta.env.VITE_XPHERE_ROUTER || publicXphereMainnet.router),
  factory: optionalAddress(import.meta.env.VITE_XPHERE_FACTORY || publicXphereMainnet.factory),
  wxp: optionalAddress(import.meta.env.VITE_XPHERE_WXP || publicXphereMainnet.wxp),
  xusdc: optionalAddress(import.meta.env.VITE_XPHERE_XUSDC),
  xusdt: optionalAddress(import.meta.env.VITE_XPHERE_XUSDT),
  xeth: optionalAddress(import.meta.env.VITE_XPHERE_XETH),
  xef: optionalAddress(import.meta.env.VITE_XPHERE_XEF || publicXphereMainnet.xef),
  localFaucet: undefined,
  usdcWarpRouter: optionalAddress(import.meta.env.VITE_XPHERE_USDC_WARP_ROUTER),
  usdtWarpRouter: optionalAddress(import.meta.env.VITE_XPHERE_USDT_WARP_ROUTER),
  nativeWarpRouter: optionalAddress(import.meta.env.VITE_XPHERE_NATIVE_WARP_ROUTER),
};

const localDeployment = {
  router: optionalAddress(import.meta.env.VITE_LOCAL_ROUTER),
  factory: optionalAddress(import.meta.env.VITE_LOCAL_FACTORY),
  wxp: optionalAddress(import.meta.env.VITE_LOCAL_WXP),
  xusdc: optionalAddress(import.meta.env.VITE_LOCAL_XUSDC),
  xusdt: optionalAddress(import.meta.env.VITE_LOCAL_XUSDT),
  xeth: undefined,
  xef: optionalAddress(import.meta.env.VITE_LOCAL_XEF),
  localFaucet: optionalAddress(import.meta.env.VITE_LOCAL_XPHERE_FAUCET),
  usdcWarpRouter: optionalAddress(import.meta.env.VITE_LOCAL_XPHERE_USDC_BRIDGE_ROUTER),
  usdtWarpRouter: optionalAddress(import.meta.env.VITE_LOCAL_XPHERE_USDT_BRIDGE_ROUTER),
  nativeWarpRouter: optionalAddress(import.meta.env.VITE_LOCAL_XPHERE_NATIVE_BRIDGE_ROUTER),
};

const activeSwapDeployment =
  import.meta.env.VITE_SWAP_CHAIN === "localhost" ? localDeployment : xphereMainnetDeployment;

const ethereumMainnetDeployment = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
  localFaucet: undefined,
  usdcWarpRouter: optionalAddress(import.meta.env.VITE_ETHEREUM_USDC_WARP_ROUTER),
  usdtWarpRouter: optionalAddress(import.meta.env.VITE_ETHEREUM_USDT_WARP_ROUTER),
  nativeWarpRouter: optionalAddress(import.meta.env.VITE_ETHEREUM_NATIVE_WARP_ROUTER),
};

const localEthereumDeployment = {
  usdc: optionalAddress(import.meta.env.VITE_LOCAL_ETHEREUM_USDC),
  usdt: optionalAddress(import.meta.env.VITE_LOCAL_ETHEREUM_USDT),
  localFaucet: optionalAddress(import.meta.env.VITE_LOCAL_ETHEREUM_FAUCET),
  usdcWarpRouter: optionalAddress(import.meta.env.VITE_LOCAL_ETHEREUM_USDC_BRIDGE_ROUTER),
  usdtWarpRouter: optionalAddress(import.meta.env.VITE_LOCAL_ETHEREUM_USDT_BRIDGE_ROUTER),
  nativeWarpRouter: optionalAddress(import.meta.env.VITE_LOCAL_ETHEREUM_NATIVE_BRIDGE_ROUTER),
};

const activeEthereumDeployment =
  import.meta.env.VITE_BRIDGE_MODE === "local" ? localEthereumDeployment : ethereumMainnetDeployment;

export const deployments = {
  xphere: activeSwapDeployment,
  xphereMainnet: xphereMainnetDeployment,
  localhost: localDeployment,
  ethereum: activeEthereumDeployment,
  ethereumMainnet: ethereumMainnetDeployment,
  localEthereum: localEthereumDeployment,
};

export const configuredForSwap = Boolean(
  deployments.xphere.router &&
    deployments.xphere.factory &&
    deployments.xphere.wxp,
);
