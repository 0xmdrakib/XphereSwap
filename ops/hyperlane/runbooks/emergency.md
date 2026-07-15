# Bridge Emergency Runbook

## Immediate Containment

1. Keep or set `VITE_BRIDGE_RELEASED=false` and publish the locked preview.
2. Stop new relayer processing for the affected route.
3. Snapshot source transactions, pending message IDs, router balances, validator status, and the latest reviewed artifacts.
4. Obtain approval from the affected chain owner Safes before changing ISM state.

## Pause A Route

Render the existing final security configuration with its Pausable ISM set to `paused: true`, then apply only the affected route:

```bash
# ETH/xETH route
pnpm bridge:render-security -- --route eth --paused
pnpm bridge:hyperlane -- warp apply --id ETH/base-ethereum-xphere --yes

# USDC/xUSDC route
pnpm bridge:render-security -- --route usdc --paused
pnpm bridge:hyperlane -- warp apply --id USDC/base-ethereum-xphere --yes
```

Verify the paused state on Ethereum, Base, and Xphere. Do not rely on frontend locking as the on-chain control.

## Unpause A Route

Unpause only after the root cause is understood, collateral is reconciled, pending messages are reviewed, monitoring is healthy, and every relevant Safe approves:

```bash
# Omit --paused to render paused: false
pnpm bridge:render-security -- --route eth
pnpm bridge:hyperlane -- warp apply --id ETH/base-ethereum-xphere --yes

pnpm bridge:render-security -- --route usdc
pnpm bridge:hyperlane -- warp apply --id USDC/base-ethereum-xphere --yes
```

Run low-value delivery tests in every affected direction before considering frontend release.

## Rollback Conditions

Keep the route paused and do not release when any of the following remains true:

- Router, Mailbox, owner, or ISM differs from the reviewed artifact.
- Validator quorum or relayer monitoring is degraded.
- Destination collateral cannot cover pending withdrawals.
- Aggregate collateral exceeds `$100,000`.
- Rate limits are absent, stale, or not router-bound.
- Any low-value delivery is delayed, reverted, under-delivered, or cannot be matched to its `DispatchId`.
- Safe ownership or pause authority cannot be independently verified.

Rollback means restoring the last reviewed route configuration with `warp apply`, recording the resulting ISM addresses, revalidating artifacts, and leaving the frontend release flag false. Never migrate or sweep user funds automatically.

## Swap And RPC Incidents

The live swap is separate from the bridge. A bridge pause must not alter AMM contracts or LP funds.

For an RPC incident, switch operator and frontend configuration to reviewed backup dedicated RPCs, confirm each chain ID, verify block progress, and confirm log queries before resuming monitoring.
