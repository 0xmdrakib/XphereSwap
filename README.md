# XphereSwap

XphereSwap is a live Xphere mainnet swap MVP built for the Xphere ecosystem. It provides a Uniswap V2-style AMM on Xphere with XP/WXP support, XEF liquidity support, pool analytics, and a polished wallet-connected frontend.

Live app: [xphereswap.rakibhq.xyz](https://xphereswap.rakibhq.xyz)

---

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
- Tests: Hardhat, Vitest, Playwright

## Bridge Status

Bridge code and Hyperlane configuration are included for the next phase. Mainnet bridge routes are not live in the public MVP yet.

Planned route direction:

- Ethereum or Base to Xphere using shared Hyperlane Warp Routes
- Native ETH to one shared xETH token on Xphere
- Official Ethereum/Base USDC to one shared xUSDC token on Xphere
- Xphere withdrawals back to Ethereum or Base after collateral and safety review

Base-to-Ethereum routing and production USDT bridging are not included. The Bridge screen remains visibly `Not live` with transaction actions disabled.

## Safety Notes

- The current swap is an MVP and should be reviewed before wider public liquidity promotion.
- Pool pricing is reserve-based and can diverge from market prices when liquidity is thin.
- CoinGecko cannot force AMM prices; it is used as a reference only.
- Production rollout should use team-controlled multisig ownership, production RPCs, market-ratio liquidity, and monitored operators.

## License

This project is licensed under the [MIT License](./LICENSE).
