# Hyperlane Mainnet Deployment Runbook

## Current State

The bridge is not live. This runbook prepares Ethereum <-> Xphere and Base <-> Xphere routes for a future reviewed release. It does not authorize public use, Vercel transaction enablement, or a live-bridge announcement.

Production assets:

- Native ETH on Ethereum and Base -> one shared xETH synthetic token on Xphere.
- Official USDC on Ethereum and Base -> one shared xUSDC synthetic token on Xphere.
- Base <-> Ethereum is not exposed in the XphereSwap UI.

## 1. Preconditions

- Run repository tooling through Node 22.
- Use dedicated RPCs for Ethereum, Base, and Xphere.
- Configure three unique contract owners:
  - `ETHEREUM_PROTOCOL_ADMIN_SAFE`
  - `BASE_PROTOCOL_ADMIN_SAFE`
  - `XPHERE_PROTOCOL_ADMIN_SAFE`
- Do not use `PROTOCOL_ADMIN_SAFE` as a bridge owner fallback.
- Configure three unique validator signers and a funded relayer.
- Fund the deployer above the reviewed thresholds:
  - Xphere: `MIN_XPHERE_DEPLOYER_XP` (probe default: 1 XP)
  - Ethereum: `MIN_ETHEREUM_DEPLOYER_ETH` (probe default: 0.1 ETH)
  - Base: `MIN_BASE_DEPLOYER_ETH` (probe default: 0.05 ETH)
- Set `BRIDGE_ETH_DAILY_CAP_WEI` to a reviewed positive value divisible by `86400`.
- Keep `VITE_BRIDGE_RELEASED=false`.

Run the non-live gate first:

```bash
pnpm node:run22 -- pnpm mainnet:orchestrate
```

## 2. Validate The Pinned Toolchain

Hyperlane CLI and SDK are pinned to `36.0.0`. The wrapper uses the workspace binary and a Windows-safe mirrored bundle when the repository path contains spaces.

```bash
pnpm node:run22 -- pnpm bridge:hyperlane -- --version
pnpm node:run22 -- pnpm bridge:validate
pnpm node:run22 -- pnpm bridge:caps
```

## 3. Prepare Registry And Xphere Core

```bash
pnpm node:run22 -- pnpm bridge:prepare-registry
pnpm node:run22 -- pnpm bridge:core:deploy
pnpm node:run22 -- pnpm bridge:sync-artifacts
```

If automatic sync cannot identify the Xphere core addresses, record the reviewed output:

```bash
pnpm bridge:record-core \
  --mailbox 0x... \
  --interchain-gas-paymaster 0x... \
  --validator-announce 0x... \
  --interchain-security-module 0x...
```

Verify each address on the relevant explorer before continuing.

## 4. Phase One Route Deployment

Phase one uses a 2-of-2 static aggregation of:

- 2-of-3 message-ID multisig ISM.
- Safe-owned Pausable ISM.

```bash
pnpm node:run22 -- pnpm bridge:render-routes
pnpm node:run22 -- pnpm bridge:hyperlane -- warp deploy --id ETH/base-ethereum-xphere
pnpm node:run22 -- pnpm bridge:hyperlane -- warp deploy --id USDC/base-ethereum-xphere
pnpm node:run22 -- pnpm bridge:sync-artifacts
```

If sync does not produce complete normalized artifacts, record each route manually:

```bash
pnpm bridge:record-route eth \
  --base-router 0x... --ethereum-router 0x... --xphere-router 0x... \
  --xphere-token 0x... \
  --base-mailbox 0x... --ethereum-mailbox 0x... --xphere-mailbox 0x... \
  --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...

pnpm bridge:record-route usdc \
  --base-router 0x... --ethereum-router 0x... --xphere-router 0x... \
  --xphere-token 0x... \
  --base-mailbox 0x... --ethereum-mailbox 0x... --xphere-mailbox 0x... \
  --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...
```

Confirm the xETH address is shared by both ETH origins and the xUSDC address is shared by both USDC origins.

## 5. Phase Two Security Apply

Phase two updates every router to a 3-of-3 static aggregation:

- 2-of-3 message-ID multisig ISM.
- Safe-owned Pausable ISM.
- Router-bound RateLimited ISM.

USDC uses `24,999,926,400` base units per day. ETH uses the reviewed `BRIDGE_ETH_DAILY_CAP_WEI`.

```bash
pnpm node:run22 -- pnpm bridge:render-security
pnpm node:run22 -- pnpm bridge:apply-security:live
```

Record the final ISMs after verifying the applied configuration:

```bash
pnpm bridge:record-security eth \
  --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...

pnpm bridge:record-security usdc \
  --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...
```

## 6. Frontend Preview Sync

```bash
pnpm sync:web-env:xphere-mainnet
pnpm build:web
```

Required public fields include all three Mailboxes, six routers, xETH, xUSDC, Base/Ethereum RPCs, and Xphere RPC. Leave `VITE_BRIDGE_RELEASED=false`; the Bridge UI must continue to show `Not live` and disable Quote/Bridge actions.

## 7. Release Drills

Before changing the release flag, complete low-value delivery tests for:

1. Ethereum ETH -> Xphere xETH
2. Base ETH -> Xphere xETH
3. Xphere xETH -> Ethereum ETH
4. Xphere xETH -> Base ETH
5. Ethereum USDC -> Xphere xUSDC
6. Base USDC -> Xphere xUSDC
7. Xphere xUSDC -> Ethereum USDC
8. Xphere xUSDC -> Base USDC

For every test, retain source transaction hash, `DispatchId`, destination delivery evidence, quoted gas, delivered amount, and elapsed time.

Release also requires:

- Fresh aggregate collateral check below `$100,000`.
- Validator and relayer monitoring.
- Funded destination collateral for Xphere withdrawals.
- Successful pause and unpause drill for both assets.
- Team security approval.

Only after approval:

```bash
pnpm bridge:readiness
pnpm bridge:caps:release
pnpm release:mainnet-beta
```

The release command sends no on-chain transaction and does not publish Vercel automatically.
