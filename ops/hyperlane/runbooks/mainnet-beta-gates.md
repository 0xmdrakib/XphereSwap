# Bridge Mainnet Release Gates

The bridge is not live. The existing Xphere swap remains independent from these release gates.

## Required Environment

```bash
MAINNET_BETA_ACK=I_UNDERSTAND_MAINNET_BETA
BRIDGE_SECURITY_APPLY_ACK=I_UNDERSTAND_BRIDGE_SECURITY_APPLY
DEPLOYER_PRIVATE_KEY=
ETHEREUM_PROTOCOL_ADMIN_SAFE=
BASE_PROTOCOL_ADMIN_SAFE=
XPHERE_PROTOCOL_ADMIN_SAFE=
ETHEREUM_MAINNET_RPC_URL=
BASE_MAINNET_RPC_URL=
XPHERE_MAINNET_RPC_URL=
ETHEREUM_MAILBOX=
BASE_MAILBOX=
XPHERE_MAILBOX=
HYPERLANE_VALIDATOR_1=
HYPERLANE_VALIDATOR_2=
HYPERLANE_VALIDATOR_3=
HYPERLANE_RELAYER_ADDRESS=
BRIDGE_CAPS_ACTIVE=true
BRIDGE_CAPS_LAST_REVIEWED_AT=
BRIDGE_ETH_DAILY_CAP_WEI=
BRIDGE_ETH_DAILY_CAP_REVIEWED=true
VITE_BRIDGE_RELEASED=false
```

## Contract And Ownership Gates

- Ethereum, Base, and Xphere owner addresses are unique deployed contracts.
- The generic legacy `PROTOCOL_ADMIN_SAFE` is not used as a bridge owner fallback.
- ETH and USDC artifacts contain normalized records for all three chains.
- All six routers and all three Mailboxes have verified bytecode.
- Xphere has one shared xETH and one shared xUSDC.
- Final ISMs are recorded after phase-two `warp apply`.
- Every final ISM is a 3-of-3 aggregation with multisig, pause, and router-bound rate limit modules.

## Capacity Gates

- USDC effective daily capacity is `24,999,926,400` base units.
- ETH capacity is reviewed, positive, and divisible by `86400`.
- Ethereum and Base collateral is summed across both assets.
- Aggregate bridge collateral is at or below `$100,000`.
- Destination collateral is funded before any Xphere -> origin release test.

## Operational Gates

- Three validators are online on independent operator hosts.
- Relayer is funded on Ethereum, Base, and Xphere.
- Monitoring covers validator health, relayer balance, delivery age, paused state, and collateral cap usage.
- Pause/unpause drill succeeds for ETH and USDC.
- All eight asset/direction delivery tests in `deploy-hyperlane.md` succeed.
- Xphere/team security approval is recorded.

## Final Verification

```bash
pnpm node:run22 -- pnpm bridge:validate
pnpm node:run22 -- pnpm bridge:readiness
pnpm node:run22 -- pnpm bridge:caps:release
pnpm node:run22 -- pnpm --filter @xphere-swap/web test
pnpm node:run22 -- pnpm build:web
```

Only after every gate passes may an operator set `VITE_BRIDGE_RELEASED=true`, rerun `pnpm release:mainnet-beta`, and explicitly publish the frontend. Until then, public wording must remain `Bridge not live`.
