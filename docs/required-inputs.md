# Required Inputs

## Current Deliverable

The existing Xphere mainnet swap, liquidity, XP/WXP, and XEF functionality remains live and unchanged.

The bridge code/config/UI is deployment-ready but not live. Current production routes are limited to:

- Ethereum ETH <-> Xphere xETH
- Base ETH <-> Xphere xETH
- Ethereum USDC <-> Xphere xUSDC
- Base USDC <-> Xphere xUSDC

Base <-> Ethereum is not available in the UI. USDT is retained only in the local demo contracts/tests and is not part of production bridge rendering or release gates.

## Required Bridge Inputs

- Node.js 22 for Hyperlane CLI execution.
- Funded `DEPLOYER_PRIVATE_KEY`.
- Dedicated Ethereum, Base, and Xphere RPC URLs.
- Three unique contract owners:
  - `ETHEREUM_PROTOCOL_ADMIN_SAFE`
  - `BASE_PROTOCOL_ADMIN_SAFE`
  - `XPHERE_PROTOCOL_ADMIN_SAFE`
- Three unique Hyperlane validator addresses.
- Funded relayer address.
- Verified Mailbox addresses for all three chains.
- Reviewed ETH daily cap divisible by `86400`.
- Fresh cap review timestamp and active monitoring acknowledgement.
- Phase-one route addresses and phase-two final ISM addresses.

The legacy generic `PROTOCOL_ADMIN_SAFE` is not accepted as a production bridge owner fallback.

Use [operator-input-form.md](operator-input-form.md) for the complete environment checklist.

## Route Deployment Order

```bash
pnpm node:run22 -- pnpm bridge:validate
pnpm node:run22 -- pnpm bridge:prepare-registry
pnpm node:run22 -- pnpm bridge:render-routes

pnpm node:run22 -- pnpm bridge:hyperlane -- warp deploy --id ETH/base-ethereum-xphere
pnpm node:run22 -- pnpm bridge:hyperlane -- warp deploy --id USDC/base-ethereum-xphere

pnpm bridge:sync-artifacts
```

Record phase one manually if automatic sync cannot normalize all three chains:

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

## Final Security

Phase one uses a 2-of-2 aggregation of multisig and Pausable ISMs. Phase two adds a router-bound RateLimited ISM and raises the aggregation threshold to 3-of-3.

```bash
pnpm bridge:render-security
pnpm bridge:apply-security:live
pnpm bridge:record-security eth --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...
pnpm bridge:record-security usdc --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...
```

## Release Gate

Keep `VITE_BRIDGE_RELEASED=false` until:

- All contracts and ownership are verified.
- Aggregate Ethereum/Base collateral is at or below `$100,000`.
- Destination collateral is sufficient for Xphere withdrawals.
- Validator and relayer monitoring is healthy.
- Pause/unpause drills pass for both assets.
- All eight source/destination asset tests pass.
- Xphere/team security approval is recorded.

Then run:

```bash
pnpm bridge:readiness
pnpm bridge:caps:release
pnpm --filter @xphere-swap/web test
pnpm build:web
pnpm release:mainnet-beta
```

No command in the current code-completion workflow deploys contracts, enables Vercel bridge transactions, or publicly claims that the bridge is live.
