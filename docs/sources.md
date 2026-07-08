# Source Notes

- Xphere docs: https://docs.x-phere.com/
- Xphere site: https://www.x-phere.com/
- XEFFY docs: https://docs.xeffy.io/
- XEFFY whitepaper: https://whitepaper.xeffy.io/Whitepaper.pdf
- Hyperlane docs: https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane
- Uniswap V2 architecture: https://developers.uniswap.org/docs/protocols/v2/concepts/architecture

Verified Xphere values used by this repo:

- Mainnet Chain ID: `20250217`
- Native token: `XP`
- Mainnet public RPCs: `https://en-hkg.x-phere.com`, `https://en-bkk.x-phere.com`, `https://mainnet.xphere-rpc.com`
- Explorer: `https://xp.tamsa.io`
- Testnet Chain ID: `1998991`
- Testnet RPC: `https://testnet.x-phere.com`

Implementation notes:

- LiFi public chain metadata checked at `https://li.quest/v1/chains` did not include chain ID `20250217` on July 8, 2026, so this repo does not rely on LiFi for Xphere routes.
- `https://mainnet.xphere-rpc.com` returned `eth_chainId=0x134fe69` (`20250217`) on July 8, 2026. It is included as a public wallet fallback, not as a replacement for a dedicated beta RPC.
- Xphere RPC read for candidate XEF address `0x80252C2D06bbd85699c555fc3633D5B8eE67C9AD` returned `symbol=XEF`, `decimals=18`, and total supply `6000000000000000000000000000`. The frontend keeps it gated unless `VITE_XEF_OFFICIAL_VERIFIED=true` is set after official confirmation.
- Local ETH/XP bridge is a functional demo route using native collateral/release contracts on both local chains. Mainnet does not use a direct 1:1 ETH/XP bridge; ETH is bridged as Xphere synthetic `xETH`, then swapped into XP/WXP through AMM liquidity.
