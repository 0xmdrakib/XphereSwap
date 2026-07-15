import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  bridgeAssets,
  bridgeChains,
  bridgeConfigurationComplete,
  destinationOptions,
  isSupportedBridgePair,
  routeConfigured,
  type BridgeAssetConfig,
  type BridgeAssetKey,
  type BridgeChainConfig,
  type BridgeChainKey,
} from "./config";

const addresses = Array.from(
  { length: 20 },
  (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}` as Address,
);

function configuredRegistry() {
  let addressIndex = 0;
  const nextAddress = () => addresses[addressIndex++];
  const chains = Object.fromEntries(
    (Object.keys(bridgeChains) as BridgeChainKey[]).map((key) => [
      key,
      { ...bridgeChains[key], mailbox: nextAddress() },
    ]),
  ) as Record<BridgeChainKey, BridgeChainConfig>;
  const assets = Object.fromEntries(
    (Object.keys(bridgeAssets) as BridgeAssetKey[]).map((assetKey) => {
      const asset = bridgeAssets[assetKey];
      const chain = Object.fromEntries(
        (Object.keys(asset.chain) as BridgeChainKey[]).map((chainKey) => {
          const config = asset.chain[chainKey];
          return [
            chainKey,
            {
              ...config,
              router: nextAddress(),
              token: config.native ? undefined : config.token || nextAddress(),
            },
          ];
        }),
      ) as BridgeAssetConfig["chain"];
      return [assetKey, { ...asset, chain }];
    }),
  ) as Record<BridgeAssetKey, BridgeAssetConfig>;
  return { assets, chains };
}

describe("bridge route registry", () => {
  it("allows only the four Xphere directions", () => {
    expect(isSupportedBridgePair("ethereum", "xphere")).toBe(true);
    expect(isSupportedBridgePair("base", "xphere")).toBe(true);
    expect(isSupportedBridgePair("xphere", "ethereum")).toBe(true);
    expect(isSupportedBridgePair("xphere", "base")).toBe(true);
    expect(isSupportedBridgePair("ethereum", "base")).toBe(false);
    expect(isSupportedBridgePair("base", "ethereum")).toBe(false);
    expect(isSupportedBridgePair("xphere", "xphere")).toBe(false);
  });

  it("returns constrained destination choices", () => {
    expect(destinationOptions("ethereum")).toEqual(["xphere"]);
    expect(destinationOptions("base")).toEqual(["xphere"]);
    expect(destinationOptions("xphere")).toEqual(["ethereum", "base"]);
  });

  it("requires Mailboxes, routers, and tokens for both assets in all directions", () => {
    const registry = configuredRegistry();
    expect(bridgeConfigurationComplete(registry.assets, registry.chains)).toBe(true);
    expect(routeConfigured("base", "xphere", "usdc", registry.assets, registry.chains)).toBe(true);

    registry.assets.usdc.chain.base.router = undefined;
    expect(routeConfigured("base", "xphere", "usdc", registry.assets, registry.chains)).toBe(false);
    expect(bridgeConfigurationComplete(registry.assets, registry.chains)).toBe(false);
  });
});
