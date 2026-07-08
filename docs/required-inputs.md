# Required Inputs

This project is built so deployment work can be done by the operator once the few unavoidable external inputs are available.

## Xphere Testnet Swap

Required:

- `DEPLOYER_PRIVATE_KEY`: funded with Xphere testnet gas token.
- `XPHERE_TESTNET_RPC_URL`: default can be `https://testnet.x-phere.com`.

Command:

```bash
pnpm env:init
pnpm env:doctor:strict
pnpm deploy:xphere-testnet
```

The testnet pipeline deploys `WXP`, factory, router, Multicall, mock `xUSDC`, mock `xUSDT`, mock `XEF`, seeds the default pools, verifies the deployment, updates `apps/web/.env.local`, and builds the web app.

## Mainnet Swap

Required:

- Node.js 20 or 22 for any live deployment command.
- `DEPLOYER_PRIVATE_KEY`: funded with XP.
- `XPHERE_MAINNET_RPC_URL`: dedicated RPC required for public beta; public RPC is only for dev probes.
- `PROTOCOL_ADMIN_SAFE`: admin multisig.
- `TREASURY_SAFE`: fee recipient multisig.
- `SAFE_OWNER_1` through `SAFE_OWNER_5`: unique owners.
- `SAFE_THRESHOLD=3`.
- `MAINNET_BETA_ACK=I_UNDERSTAND_MAINNET_BETA`.
- `XPHERE_XUSDC_TOKEN` and `XPHERE_XUSDT_TOKEN`, or recorded Hyperlane route artifacts, before a stablecoin swap deployment can verify.
- `XPHERE_XETH_TOKEN`, or a recorded ETH -> xETH Hyperlane route, before public beta release.
- Initial liquidity wallet and amounts for WXP/xUSDC, WXP/xUSDT, xUSDC/xUSDT, and WXP/xETH if ETH-to-XP UX is enabled.
- Optional XEF address through `XPHERE_XEF_TOKEN` only after official confirmation. RPC inspection confirms `0x80252C2D06bbd85699c555fc3633D5B8eE67C9AD` has symbol `XEF` and 18 decimals on Xphere, but public default listing should wait for official Xphere/XEFFY confirmation.

The deployer, Safe-owner EOAs, Hyperlane validators, and relayer can be generated locally:

```bash
pnpm mainnet:generate-operators
pnpm mainnet:set --file docs/operator-values.generated.local.json
pnpm mainnet:inputs
```

This leaves dedicated RPC URLs, `PROTOCOL_ADMIN_SAFE`, `TREASURY_SAFE`, funding, and release liquidity as the unavoidable live inputs.

For Xphere-only swap ownership before the Ethereum bridge Safe is ready:

```bash
pnpm deploy:admin:xphere-mainnet
pnpm mainnet:set --file docs/operator-values.xphere-admin.generated.local.json
```

This deploys `ProtocolMultisig` admin and treasury contracts on Xphere and fills `XPHERE_PROTOCOL_ADMIN_SAFE` plus `XPHERE_TREASURY_SAFE`. It does not replace the Ethereum Safe requirement for Hyperlane bridge ownership.

Commands:

```bash
pnpm node:install22
pnpm mainnet:probe
pnpm mainnet:status
pnpm mainnet:funding
pnpm mainnet:predeploy
pnpm mainnet:orchestrate
pnpm mainnet:orchestrate:live:node22
pnpm deploy:xphere-mainnet
```

This guarded pipeline runs environment checks, Xphere mainnet preflight, swap deployment, optional liquidity seeding when `SEED_MAINNET_LIQUIDITY=true`, verification, frontend env sync, and web build. It refuses to run with mock-token deployment flags enabled.

If `deployments/xphere-mainnet.local.json` already contains WXP, factory, router, and Multicall addresses, the guarded pipeline skips redeployment unless `FORCE_REDEPLOY_SWAP=true`.

## Ethereum/Xphere Hyperlane Bridge

Required:

- `ETHEREUM_MAINNET_RPC_URL`.
- `SEPOLIA_RPC_URL` for rehearsal.
- `HYPERLANE_VALIDATOR_1`.
- `HYPERLANE_VALIDATOR_2`.
- `HYPERLANE_VALIDATOR_3`.
- `HYPERLANE_RELAYER_ADDRESS`.
- `BRIDGE_CAPS_ACTIVE=true` after cap enforcement/monitoring is configured.
- `BRIDGE_CAPS_LAST_REVIEWED_AT` as a recent ISO timestamp after live cap/TVL review.
- Funded validator and relayer hosts.
- Hyperlane core addresses after deployment.
- Warp Route router addresses for USDC and USDT on both chains.
- ETH -> xETH Warp Route router addresses only after the route is reviewed, funded, capped, and tested.

After Warp Route deployment, set:

```bash
XPHERE_XUSDC_TOKEN=
XPHERE_XUSDT_TOKEN=
XPHERE_XETH_TOKEN=
VITE_ETHEREUM_USDC_WARP_ROUTER=
VITE_XPHERE_USDC_WARP_ROUTER=
VITE_ETHEREUM_USDT_WARP_ROUTER=
VITE_XPHERE_USDT_WARP_ROUTER=
VITE_ETHEREUM_NATIVE_WARP_ROUTER=
VITE_XPHERE_NATIVE_WARP_ROUTER=
```

Or record the routes directly into deployment artifacts:

```bash
pnpm bridge:record-core --mailbox 0x... --interchain-gas-paymaster 0x... --validator-announce 0x... --interchain-security-module 0x...
pnpm bridge:prepare-registry
pnpm bridge:render-routes
pnpm bridge:hyperlane -- warp deploy --id USDC/ethereum-xphere
pnpm bridge:hyperlane -- warp deploy --id USDT/ethereum-xphere
pnpm bridge:hyperlane -- warp deploy --id ETH/ethereum-xphere
pnpm bridge:record-route usdc --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...
pnpm bridge:record-route usdt --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...
pnpm bridge:record-route native --ethereum-router 0x... --xphere-router 0x... --xphere-token 0xXethToken
pnpm sync:web-env:xphere-mainnet
```

Then run:

```bash
pnpm bridge:validate
pnpm bridge:caps:release
pnpm bridge:readiness
```

For the final public beta gate, after liquidity and bridge artifacts are ready:

```bash
SEED_MAINNET_LIQUIDITY=true
SEED_XETH_LIQUIDITY=true
pnpm release:mainnet-beta
```

## Still Gated

- XEF default mainnet pool is intentionally blocked until the official XEF token address is verified from Xphere/XEFFY official sources or explorer-verified contracts.
- Mainnet must not expose a direct 1:1 ETH/XP bridge. ETH lands as `xETH`; users get XP by swapping through a funded WXP/xETH pool after Safe ownership, caps, validator health, relayer health, emergency pause, and release liquidity are checked.
