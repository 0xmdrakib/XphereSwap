# Mainnet Beta Gates

Mainnet deployment is blocked unless all items are true.

## Required environment

```bash
MAINNET_BETA_ACK=I_UNDERSTAND_MAINNET_BETA
DEPLOYER_PRIVATE_KEY=
PROTOCOL_ADMIN_SAFE=
TREASURY_SAFE=
SAFE_OWNER_1=
SAFE_OWNER_2=
SAFE_OWNER_3=
SAFE_OWNER_4=
SAFE_OWNER_5=
SAFE_THRESHOLD=3
XPHERE_MAINNET_RPC_URL=
ETHEREUM_MAINNET_RPC_URL=
SEPOLIA_RPC_URL=
HYPERLANE_RELAYER_ADDRESS=
BRIDGE_CAPS_ACTIVE=true
BRIDGE_CAPS_LAST_REVIEWED_AT=
```

## Release gates

- Swap contracts verified on Tamsa.
- Router/factory/WXP addresses are recorded in deployment artifacts.
- Protocol fee recipient is `TREASURY_SAFE`.
- Hyperlane route owner is `PROTOCOL_ADMIN_SAFE`.
- USDC, USDT, and ETH -> xETH route caps are set to `$25k/day/token` and `$100k total TVL`.
- `pnpm bridge:caps:release` passes against templates, recorded routes, and live Ethereum collateral balances.
- Emergency pause drill completed on testnet.
- XEF is not listed by default until the official contract address is verified.

## Mainnet command

```bash
pnpm deploy:xphere-mainnet
pnpm bridge:caps:release
pnpm release:mainnet-beta
```
