# Operator Input Form

Fill these values only in the ignored local `.env`. Never commit private keys, authenticated RPC URLs, or generated operator files.

## Existing Xphere Swap

The live XP/WXP and XEF swap deployment is already recorded. Bridge work must not redeploy or change those contracts.

Useful read-only inputs:

```bash
XPHERE_MAINNET_RPC_URL=
XPHERE_XEF_TOKEN=0x80252C2D06bbd85699c555fc3633D5B8eE67C9AD
VITE_XEF_OFFICIAL_VERIFIED=true
```

## Future Bridge Deployment

The bridge is not live. Configure these only after team review:

```bash
DEPLOYER_PRIVATE_KEY=
MAINNET_BETA_ACK=I_UNDERSTAND_MAINNET_BETA
BRIDGE_SECURITY_APPLY_ACK=I_UNDERSTAND_BRIDGE_SECURITY_APPLY

XPHERE_MAINNET_RPC_URL=
ETHEREUM_MAINNET_RPC_URL=
BASE_MAINNET_RPC_URL=
SEPOLIA_RPC_URL=

ETHEREUM_PROTOCOL_ADMIN_SAFE=
BASE_PROTOCOL_ADMIN_SAFE=
XPHERE_PROTOCOL_ADMIN_SAFE=

HYPERLANE_VALIDATOR_1=
HYPERLANE_VALIDATOR_2=
HYPERLANE_VALIDATOR_3=
HYPERLANE_RELAYER_ADDRESS=

ETHEREUM_MAILBOX=
BASE_MAILBOX=
XPHERE_MAILBOX=

BRIDGE_CAPS_ACTIVE=true
BRIDGE_CAPS_LAST_REVIEWED_AT=
BRIDGE_ETH_DAILY_CAP_WEI=
BRIDGE_ETH_DAILY_CAP_REVIEWED=true
BRIDGE_ETH_USD_PRICE_FEED=
```

The three owner addresses must be unique deployed Safe contracts. The legacy `PROTOCOL_ADMIN_SAFE` value is not accepted as a bridge owner fallback.

## Route Outputs

After phase-one deployment and phase-two security application, record:

```bash
XPHERE_XETH_TOKEN=
XPHERE_XUSDC_TOKEN=

VITE_ETHEREUM_NATIVE_WARP_ROUTER=
VITE_BASE_NATIVE_WARP_ROUTER=
VITE_XPHERE_NATIVE_WARP_ROUTER=

VITE_ETHEREUM_USDC_WARP_ROUTER=
VITE_BASE_USDC_WARP_ROUTER=
VITE_XPHERE_USDC_WARP_ROUTER=

VITE_ETHEREUM_MAILBOX=
VITE_BASE_MAILBOX=
VITE_XPHERE_MAILBOX=

VITE_BRIDGE_RELEASED=false
```

Keep `VITE_BRIDGE_RELEASED=false` until all eight low-value delivery tests, collateral checks, monitoring checks, and pause drills pass.

## Funding Thresholds

```bash
MIN_XPHERE_DEPLOYER_XP=1
MIN_ETHEREUM_DEPLOYER_ETH=0.1
MIN_BASE_DEPLOYER_ETH=0.05
MIN_SEPOLIA_DEPLOYER_ETH=0.05
```

Review and increase these thresholds based on live gas estimates before deployment.

## Commands

```bash
pnpm node:run22 -- pnpm mainnet:inputs
pnpm node:run22 -- pnpm mainnet:orchestrate

# Future live work only after approval and funding:
pnpm mainnet:orchestrate:live:node22
pnpm bridge:readiness
pnpm bridge:caps:release
pnpm release:mainnet-beta
```

The release command verifies and builds the frontend; it does not send an on-chain transaction or publish Vercel automatically.
