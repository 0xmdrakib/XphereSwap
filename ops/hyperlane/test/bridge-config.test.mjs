import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import YAML from "yaml";
import {
  BASE_USDC,
  CHAINS,
  ETHEREUM_USDC,
  RATE_LIMIT_PERIOD_SECONDS,
  REPO_DIR,
  ROUTES,
  USDC_DAILY_CAP_UNITS,
  aggregateTvlUsd,
  bridgeReleaseFlagEnabled,
  ethDailyCap,
  finalIsmConfig,
  initialIsmConfig,
  normalizedRouteRecord,
  routeComplete,
  validateBridgeOperators,
} from "../scripts/bridge-config.mjs";

const addresses = Array.from(
  { length: 20 },
  (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
);

test("pins canonical chains, route IDs, and USDC addresses", async () => {
  assert.equal(CHAINS.base.chainId, 8453);
  assert.equal(CHAINS.base.domainId, 8453);
  assert.equal(CHAINS.xphere.chainId, 20250217);
  assert.equal(BASE_USDC, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(ETHEREUM_USDC, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(ROUTES.eth.id, "ETH/base-ethereum-xphere");
  assert.equal(ROUTES.usdc.id, "USDC/base-ethereum-xphere");
  assert.notEqual(ROUTES.eth.generatedDeployName, ROUTES.usdc.generatedDeployName);

  const packageJson = JSON.parse(await readFile(resolve(REPO_DIR, "ops/hyperlane/package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@hyperlane-xyz/cli"], "36.0.0");
  assert.equal(packageJson.dependencies["@hyperlane-xyz/sdk"], "36.0.0");
});

test("builds the required two-phase ISM composition", () => {
  const validators = addresses.slice(0, 3);
  const initial = initialIsmConfig(addresses[3], validators);
  assert.equal(initial.threshold, 2);
  assert.deepEqual(initial.modules.map((module) => module.type), [
    "messageIdMultisigIsm",
    "pausableIsm",
  ]);
  assert.equal(initial.modules[0].threshold, 2);

  const final = finalIsmConfig(addresses[3], validators, USDC_DAILY_CAP_UNITS, addresses[4], true);
  assert.equal(final.threshold, 3);
  assert.deepEqual(final.modules.map((module) => module.type), [
    "messageIdMultisigIsm",
    "pausableIsm",
    "rateLimitedIsm",
  ]);
  assert.equal(final.modules[1].paused, true);
  assert.equal(final.modules[2].recipient, addresses[4]);
  assert.equal(final.modules[2].maxCapacity, String(USDC_DAILY_CAP_UNITS));
});

test("rejects missing or duplicate owners and validators", () => {
  const env = {
    BASE_PROTOCOL_ADMIN_SAFE: addresses[0],
    ETHEREUM_PROTOCOL_ADMIN_SAFE: addresses[1],
    XPHERE_PROTOCOL_ADMIN_SAFE: addresses[2],
    HYPERLANE_VALIDATOR_1: addresses[3],
    HYPERLANE_VALIDATOR_2: addresses[4],
    HYPERLANE_VALIDATOR_3: addresses[5],
  };
  assert.deepEqual(validateBridgeOperators(env), []);
  assert.match(validateBridgeOperators({ ...env, BASE_PROTOCOL_ADMIN_SAFE: addresses[1] })[0], /unique/);
  assert.match(validateBridgeOperators({ ...env, HYPERLANE_VALIDATOR_3: "" })[0], /non-zero/);
});

test("validates rounded ETH caps and aggregates both origin collateral values", () => {
  const valid = RATE_LIMIT_PERIOD_SECONDS * 123n;
  assert.equal(ethDailyCap({ BRIDGE_ETH_DAILY_CAP_WEI: String(valid) }), valid);
  assert.equal(ethDailyCap({ BRIDGE_ETH_DAILY_CAP_WEI: String(valid + 1n) }), undefined);
  assert.equal(ethDailyCap({ BRIDGE_ETH_DAILY_CAP_WEI: "0" }), undefined);
  assert.equal(
    aggregateTvlUsd({
      eth: { ethereum: 10n, base: 20n },
      usdc: { ethereum: 30n, base: 40n },
    }),
    100n,
  );
});

test("requires normalized, canonical, unique three-chain route records", () => {
  const routers = { base: addresses[0], ethereum: addresses[1], xphere: addresses[2] };
  const artifact = { bridgeRoutes: {} };
  artifact.bridgeRoutes.usdc = normalizedRouteRecord({
    chainName: "base",
    routeKey: "usdc",
    mailbox: addresses[3],
    router: routers.base,
    token: BASE_USDC,
    ism: addresses[4],
    owner: addresses[5],
    remoteRouters: { ethereum: routers.ethereum, xphere: routers.xphere },
    securityApplied: true,
  });
  assert.equal(routeComplete(artifact, "usdc", "base", { requireSecurity: true }), true);
  assert.equal(
    routeComplete(
      {
        bridgeRoutes: {
          usdc: { ...artifact.bridgeRoutes.usdc, token: ETHEREUM_USDC },
        },
      },
      "usdc",
      "base",
    ),
    false,
  );
  assert.equal(
    routeComplete(
      {
        bridgeRoutes: {
          usdc: {
            ...artifact.bridgeRoutes.usdc,
            remoteRouters: { ethereum: routers.base, xphere: routers.xphere },
          },
        },
      },
      "usdc",
      "base",
    ),
    false,
  );
});

test("keeps production routes USDT-free and release explicitly gated", async () => {
  const files = [
    ROUTES.eth.template,
    ROUTES.usdc.template,
  ];
  for (const file of files) {
    const config = YAML.parse(
      await readFile(resolve(REPO_DIR, "ops/hyperlane/warp-routes", file), "utf8"),
    );
    assert.doesNotMatch(JSON.stringify(config), /USDT/i);
  }
  assert.equal(bridgeReleaseFlagEnabled({ VITE_BRIDGE_RELEASED: "true" }), true);
  assert.equal(bridgeReleaseFlagEnabled({ VITE_BRIDGE_RELEASED: "false" }), false);
  assert.equal(bridgeReleaseFlagEnabled({}), false);
});
