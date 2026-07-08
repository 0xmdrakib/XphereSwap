# XphereSwap

XphereSwap is a live Xphere mainnet swap MVP built for the Xphere ecosystem. It provides a Uniswap V2-style AMM on Xphere with XP/WXP support, XEF liquidity support, pool analytics, and a polished wallet-connected frontend.

Live app: [xphereswap.rakibhq.xyz](https://xphereswap.rakibhq.xyz)

Repository: [0xmdrakib/XphereSwap](https://github.com/0xmdrakib/XphereSwap)

## Overview

XphereSwap was built from scratch as a focused Xphere mainnet swap experience. The current release is centered on the live Xphere AMM and liquidity tools. Bridge routes are prepared in the codebase for a later Base/Ethereum rollout, but the public product does not claim live bridge support yet.

The AMM price comes from pool reserves. CoinGecko is used only as a market reference for XP/XEF pricing, pool value display, and DEX-vs-market deviation tracking.

## Features

- Swap on Xphere mainnet through a Uniswap V2-style router.
- Native XP routing through WXP.
- XEF token support on Xphere.
- Add liquidity and remove liquidity flows.
- Live pool reserves, wallet balances, LP balance, LP share, and pool value.
- CoinGecko XP/XEF market reference and DEX-vs-market deviation display.
- WalletConnect, RainbowKit, wagmi, and viem wallet integration.
- Curated wallet list for a cleaner connect modal.
- Xphere-specific gas handling to avoid abnormal wallet fee estimates.
- Receipt-status checks so reverted transactions do not appear as confirmed.
- Hyperlane bridge configs and operator runbooks for future bridge rollout.

## Live Xphere Deployment

| Contract | Address |
| --- | --- |
| Chain ID | `20250217` |
| Router | `0xCd42e90dC373a2807Ba2c5763A9186430f08bB84` |
| Factory | `0x86369FCffa2370E7b1353E46b1794678aE94efdF` |
| WXP | `0xEce69Df85364bFA5c35F87802Acd35d9DD3379da` |
| Multicall3 | `0x51e5815B7d757d55aAF1d1879aD36C7D32dcfe1C` |
| XEF | `0x80252C2D06bbd85699c555fc3633D5B8eE67C9AD` |
| WXP/XEF Pair | `0x1A858990eb730603Ffb1960438c7756ca91B907B` |

Explorer: [Tamsa Xphere Explorer](https://xp.tamsa.io)

## Tech Stack

- Monorepo: pnpm workspaces
- Frontend: Vite, React, TypeScript
- Wallets: RainbowKit, wagmi, viem, WalletConnect
- Contracts: Solidity, Hardhat, TypeScript
- AMM: Uniswap V2-style factory, router, and pair flow
- Bridge preparation: Hyperlane Warp Route configs
- Tests: Hardhat, Playwright

## Project Structure

```text
apps/web              XphereSwap frontend
packages/contracts    Solidity contracts, deploy scripts, tests
ops/hyperlane         Future bridge configs and runbooks
deployments           Public deployment metadata and examples
scripts               Environment, deployment, and utility scripts
```

## Getting Started

Requirements:

- Node.js 20 or 22
- pnpm 11+

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Run the web app:

```bash
pnpm dev:web
```

Build the frontend:

```bash
pnpm build:web
```

Run contract tests:

```bash
pnpm test:contracts
```

Run frontend smoke tests:

```bash
pnpm --filter @xphere-swap/web test
```

## Environment

The frontend includes public fallback addresses for the live Xphere mainnet AMM, so a fresh clone can render the main swap interface without private secrets.

Use `.env.example` as the template for local configuration. Keep real `.env` files private. Do not commit deployer keys, RPC keys, WalletConnect project IDs, local deployment artifacts, generated operator files, build output, or logs.

Useful frontend variables:

```bash
VITE_WALLETCONNECT_PROJECT_ID=
VITE_XPHERE_MAINNET_RPC_URL=
VITE_XPHERE_ROUTER=
VITE_XPHERE_FACTORY=
VITE_XPHERE_WXP=
VITE_XPHERE_XEF=
```

## Local Demo

The repo includes a full local demo for development:

```bash
pnpm demo:local
```

This starts local Xphere/Ethereum-style chains, deploys demo swap and bridge contracts, seeds local liquidity, starts a local relayer, and serves the frontend.

## Bridge Status

Bridge code and Hyperlane configuration are included for the next phase. Mainnet bridge routes are not live in the public MVP yet.

Planned route direction:

- Base or Ethereum to Xphere using Hyperlane Warp Routes
- ETH to xETH on Xphere, then xETH/WXP liquidity for XP access
- USDC/USDT synthetic routes after operator, liquidity, and safety review

## Safety Notes

- The current swap is an MVP and should be reviewed before wider public liquidity promotion.
- Pool pricing is reserve-based and can diverge from market prices when liquidity is thin.
- CoinGecko cannot force AMM prices; it is used as a reference only.
- Production rollout should use team-controlled multisig ownership, production RPCs, market-ratio liquidity, and monitored operators.

## License

MIT
