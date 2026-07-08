# Operator Input Form

Fill these values in `.env` when you are ready for testnet/mainnet. Do not commit `.env`.

## Minimum For Xphere Testnet

```bash
DEPLOYER_PRIVATE_KEY=
XPHERE_TESTNET_RPC_URL=https://testnet.x-phere.com
```

The deployer must hold enough Xphere testnet gas token for contract deployment and liquidity seeding.

## Required For Mainnet Swap

```bash
DEPLOYER_PRIVATE_KEY=
XPHERE_MAINNET_RPC_URL=
PROTOCOL_ADMIN_SAFE=
TREASURY_SAFE=
XPHERE_XUSDC_TOKEN=
XPHERE_XUSDT_TOKEN=
XPHERE_XETH_TOKEN=
SAFE_OWNER_1=
SAFE_OWNER_2=
SAFE_OWNER_3=
SAFE_OWNER_4=
SAFE_OWNER_5=
SAFE_THRESHOLD=3
MAINNET_BETA_ACK=I_UNDERSTAND_MAINNET_BETA
```

The deployer needs XP for gas and any initial WXP liquidity. `XPHERE_MAINNET_RPC_URL` must be a dedicated endpoint for public beta; the public RPCs are dev-probe only. The Safe owners must be five unique non-zero EVM addresses.

## Mainnet Liquidity

```bash
SEED_MAINNET_LIQUIDITY=true
LIQUIDITY_MAINNET_ACK=I_UNDERSTAND_LIQUIDITY_SEEDING
LIQUIDITY_WXP_PER_STABLE_POOL=
LIQUIDITY_STABLE_PER_WXP_POOL=
LIQUIDITY_STABLE_STABLE_AMOUNT=
SEED_XETH_LIQUIDITY=true
LIQUIDITY_WXP_FOR_XETH_POOL=
LIQUIDITY_XETH_FOR_WXP_POOL=
```

Set these only after the deployer wallet holds the tokens needed for the initial pools.

## Optional XEF

```bash
XPHERE_XEF_TOKEN=
VITE_XEF_OFFICIAL_VERIFIED=false
SEED_XEF_LIQUIDITY=false
LIQUIDITY_WXP_FOR_XEF_POOL=
LIQUIDITY_XEF_FOR_WXP_POOL=
```

Only set `VITE_XEF_OFFICIAL_VERIFIED=true` after the XEF address is confirmed from official Xphere/XEFFY channels or an explorer-verified official contract.

## Required For Ethereum/Xphere Bridge

```bash
ETHEREUM_MAINNET_RPC_URL=
SEPOLIA_RPC_URL=
MIN_XPHERE_DEPLOYER_XP=1
MIN_ETHEREUM_DEPLOYER_ETH=0.1
MIN_SEPOLIA_DEPLOYER_ETH=0.05
HYPERLANE_VALIDATOR_1=
HYPERLANE_VALIDATOR_2=
HYPERLANE_VALIDATOR_3=
HYPERLANE_RELAYER_ADDRESS=
BRIDGE_CAPS_ACTIVE=true
BRIDGE_CAPS_LAST_REVIEWED_AT=
VITE_ETHEREUM_USDC_WARP_ROUTER=
VITE_XPHERE_USDC_WARP_ROUTER=
VITE_ETHEREUM_USDT_WARP_ROUTER=
VITE_XPHERE_USDT_WARP_ROUTER=
VITE_ETHEREUM_NATIVE_WARP_ROUTER=
VITE_XPHERE_NATIVE_WARP_ROUTER=
```

Validators should be three unique addresses controlled on separate hosts. The public beta target is 2-of-3 validator threshold with one relayer, route caps, and emergency pause tested before opening to users. Mainnet ETH bridges to `xETH` on Xphere first; XP output is achieved by swapping `xETH` through the AMM.

## Commands After Filling Inputs

```bash
pnpm mainnet:inputs
pnpm mainnet:set PROTOCOL_ADMIN_SAFE=0x... TREASURY_SAFE=0x...
pnpm mainnet:set --file docs/operator-values.local.json
pnpm env:doctor:strict
pnpm mainnet:funding
pnpm mainnet:predeploy
pnpm mainnet:orchestrate
pnpm mainnet:orchestrate:live
pnpm bridge:caps:release
pnpm mainnet:predeploy:release
pnpm mainnet:orchestrate:release
pnpm deploy:xphere-testnet
pnpm deploy:xphere-mainnet
pnpm bridge:readiness
pnpm release:mainnet-beta
```
