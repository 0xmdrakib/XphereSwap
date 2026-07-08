# Hyperlane Deployment Runbook

## 1. Preconditions

- `PROTOCOL_ADMIN_SAFE` is a 3-of-5 Safe-controlled admin.
- Dedicated RPCs are configured for Ethereum and Xphere.
- Three validator hosts are online, funded, backed up, and geographically separated.
- Relayer host is funded on both chains.
- Testnet route has completed lock/mint and burn/release drills.

## 2. Install CLI

```bash
pnpm bridge:hyperlane -- --help
```

The repo wrapper uses `npx`, sets a Windows-safe npm cache, and passes the official Hyperlane registry plus the generated local Xphere registry. On this Windows profile, direct `pnpm dlx @hyperlane-xyz/cli` can fail while loading the CLI wasm bundle from a path containing a space.

## 3. Validate local configs

```bash
pnpm bridge:validate
pnpm bridge:caps
pnpm bridge:readiness
pnpm mainnet:orchestrate
```

`bridge:validate` and `bridge:caps` must pass before using the YAML files. `bridge:readiness` is expected to fail until deployer key, Safe addresses, validator addresses, dedicated RPCs, cap acknowledgement, and deployed Warp Route addresses are provided.
`mainnet:orchestrate` performs the full dry gate. Use `pnpm mainnet:orchestrate:live` after funding and `.env` completion to continue live deployment from the current artifacts.

## 4. Register Xphere metadata

Use `ops/hyperlane/chains/xphere-mainnet.yaml` as the chain metadata source. Keep `domainId` equal to `20250217`.

```bash
pnpm bridge:prepare-registry
pnpm bridge:hyperlane -- registry addresses --chain ethereum --contract mailbox
```

If `pnpm bridge:hyperlane -- registry rpc --chain xphere` does not resolve the local Xphere registry on Windows, run the Hyperlane deployment steps from Linux/WSL/CI with Node 20 or 22. The repo still validates the Xphere metadata through `pnpm bridge:validate`.

## 5. Deploy Xphere core

```bash
pnpm bridge:core:deploy
```

Record Mailbox, InterchainGasPaymaster, ValidatorAnnounce, and default ISM addresses in `deployments/xphere-mainnet.local.json`.

```bash
pnpm bridge:sync-artifacts
pnpm bridge:record-core \
  --mailbox 0x... \
  --interchain-gas-paymaster 0x... \
  --validator-announce 0x... \
  --interchain-security-module 0x...
pnpm bridge:prepare-registry
```

## 6. Deploy Warp Routes

Current Hyperlane CLI versions deploy routes from registry route IDs. `pnpm bridge:render-routes` renders the reviewed templates into `ops/hyperlane/generated` and also writes local registry deployment configs under `ops/hyperlane/.registry/deployments/warp_routes`.

```bash
pnpm bridge:render-routes

pnpm bridge:hyperlane -- warp deploy \
  --id USDC/ethereum-xphere

pnpm bridge:hyperlane -- warp deploy \
  --id USDT/ethereum-xphere

pnpm bridge:hyperlane -- warp deploy \
  --id ETH/ethereum-xphere
```

Transfer route ownership to `PROTOCOL_ADMIN_SAFE` before public beta.

After each deployment, record the live routers and Xphere synthetic token addresses:

```bash
pnpm bridge:sync-artifacts
pnpm bridge:record-route usdc --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...
pnpm bridge:record-route usdt --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...
pnpm bridge:record-route native --ethereum-router 0x... --xphere-router 0x... --xphere-token 0xXethToken
```

`bridge:sync-artifacts` reads common Hyperlane registry artifact shapes and records addresses automatically when the CLI writes them. Use the manual `record-*` commands only when the CLI output must be copied from `ops/hyperlane/generated/hyperlane-last.log`.

## 7. Operate validators and relayer

- Validators: 2-of-3 multisig ISM, independent keys, independent hosts.
- Relayer: watches Ethereum and Xphere, funded on both sides, alerting on pending message age.
- Alerts: relayer balance low, validator down, message age over 10 minutes, TVL over caps.

## 8. Frontend config

Set the route addresses:

```bash
VITE_ETHEREUM_USDC_WARP_ROUTER=
VITE_XPHERE_USDC_WARP_ROUTER=
VITE_ETHEREUM_USDT_WARP_ROUTER=
VITE_XPHERE_USDT_WARP_ROUTER=
VITE_ETHEREUM_NATIVE_WARP_ROUTER=
VITE_XPHERE_NATIVE_WARP_ROUTER=
VITE_XPHERE_XETH=
```

Then run:

```bash
pnpm sync:web-env:xphere-mainnet
pnpm bridge:caps:release
pnpm build:web
pnpm release:mainnet-beta
```
