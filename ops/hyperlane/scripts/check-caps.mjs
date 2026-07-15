import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import {
  OPS_DIR,
  REPO_DIR,
  ROUTES,
  TOTAL_TVL_CAP_USD,
  USDC_DAILY_CAP_UNITS,
  aggregateTvlUsd,
  ethDailyCap,
  isAddress,
  isUrl,
  readEnv,
  readJson,
} from "./bridge-config.mjs";

const releaseMode = process.argv.includes("--release");
const BALANCE_OF_SELECTOR = "0x70a08231";
const DECIMALS_SELECTOR = "0x313ce567";
const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";
const USD_SCALE = 1_000_000n;
const DAY_MS = 86_400_000;
const checks = [];

function add(status, label, detail) {
  checks.push({ status, label, detail });
}
const ok = (label, detail = "") => add("OK", label, detail);
const warn = (label, detail = "") => add("WARN", label, detail);
const blocked = (label, detail = "") => add("BLOCKED", label, detail);

function padAddress(address) {
  return String(address).toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `${method} failed`);
  return payload.result;
}

async function call(rpcUrl, to, data) {
  return rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]);
}

async function erc20Balance(rpcUrl, token, holder) {
  return BigInt(await call(rpcUrl, token, `${BALANCE_OF_SELECTOR}${padAddress(holder)}`));
}

async function nativeBalance(rpcUrl, holder) {
  return BigInt(await rpc(rpcUrl, "eth_getBalance", [holder, "latest"]));
}

function word(hex, index) {
  const clean = hex.replace(/^0x/, "");
  return `0x${clean.slice(index * 64, (index + 1) * 64)}`;
}

async function chainlinkEthUsd(rpcUrl, feed) {
  const decimals = Number(BigInt(await call(rpcUrl, feed, DECIMALS_SELECTOR)));
  const latest = await call(rpcUrl, feed, LATEST_ROUND_DATA_SELECTOR);
  return (BigInt(word(latest, 1)) * USD_SCALE) / 10n ** BigInt(decimals);
}

function parseUsd(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole || "0") * USD_SCALE + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

function usdForBalance(balance, decimals, price) {
  return (balance * price) / 10n ** BigInt(decimals);
}

function formatUsd(value) {
  const whole = value / USD_SCALE;
  const fraction = (value % USD_SCALE).toString().padStart(6, "0").slice(0, 2);
  return `$${whole}.${fraction}`;
}

function validateReview(env) {
  if (!releaseMode) return;
  if (env.BRIDGE_CAPS_ACTIVE === "true") ok("BRIDGE_CAPS_ACTIVE", "acknowledged");
  else blocked("BRIDGE_CAPS_ACTIVE", "must be true for release");
  const reviewed = new Date(env.BRIDGE_CAPS_LAST_REVIEWED_AT || "");
  const age = Date.now() - reviewed.getTime();
  if (!Number.isNaN(reviewed.getTime()) && age >= 0 && age <= 7 * DAY_MS) {
    ok("BRIDGE_CAPS_LAST_REVIEWED_AT", reviewed.toISOString());
  } else {
    blocked("BRIDGE_CAPS_LAST_REVIEWED_AT", "review must be within seven days");
  }
  if (env.BRIDGE_ETH_DAILY_CAP_REVIEWED === "true" && ethDailyCap(env)) {
    ok("BRIDGE_ETH_DAILY_CAP_WEI", env.BRIDGE_ETH_DAILY_CAP_WEI);
  } else {
    blocked("BRIDGE_ETH_DAILY_CAP_WEI", "reviewed positive value divisible by 86400 required");
  }
}

async function validateTemplates(config, env) {
  const usdc = YAML.parse(await readFile(resolve(OPS_DIR, "warp-routes", ROUTES.usdc.template), "utf8"));
  const eth = YAML.parse(await readFile(resolve(OPS_DIR, "warp-routes", ROUTES.eth.template), "utf8"));
  if (BigInt(usdc.options?.finalSecurity?.rateLimitCapacity || 0) === USDC_DAILY_CAP_UNITS) {
    ok("USDC on-chain daily capacity", `${USDC_DAILY_CAP_UNITS} base units`);
  } else blocked("USDC on-chain daily capacity", "template mismatch");
  if (eth.options?.finalSecurity?.rateLimitEnv === "BRIDGE_ETH_DAILY_CAP_WEI") ok("ETH rate limit input", "env-driven");
  else blocked("ETH rate limit input", "template mismatch");
  if (config.aggregateTvlLimitUsd === TOTAL_TVL_CAP_USD) ok("Aggregate TVL cap", `$${TOTAL_TVL_CAP_USD}`);
  else blocked("Aggregate TVL cap", "config mismatch");
  if (!releaseMode && !ethDailyCap(env)) warn("ETH daily capacity", "not set yet; release remains blocked");
}

async function validateLiveTvl(config, env) {
  const artifacts = {};
  for (const [chainName, origin] of Object.entries(config.origins)) {
    artifacts[chainName] = await readJson(origin.artifact);
    if (!artifacts[chainName]) {
      (releaseMode ? blocked : warn)(`${chainName} collateral`, "route artifact not recorded yet");
    }
    if (!isUrl(env[origin.rpcEnv])) {
      (releaseMode ? blocked : warn)(`${chainName} RPC`, `${origin.rpcEnv} missing`);
    }
  }
  if (Object.values(artifacts).some((artifact) => !artifact) ||
      Object.values(config.origins).some((origin) => !isUrl(env[origin.rpcEnv]))) return;

  const feed = env.BRIDGE_ETH_USD_PRICE_FEED || config.ethUsdFeed;
  if (!isAddress(feed)) {
    blocked("ETH/USD feed", "missing");
    return;
  }
  const ethUsd = await chainlinkEthUsd(env.ETHEREUM_MAINNET_RPC_URL, feed);
  ok("ETH/USD feed", formatUsd(ethUsd));

  const collateralUsd = {};
  for (const [routeKey, route] of Object.entries(config.routes)) {
    collateralUsd[routeKey] = {};
    for (const [chainName, origin] of Object.entries(config.origins)) {
      const artifact = artifacts[chainName];
      const router = artifact.bridgeRoutes?.[routeKey]?.router;
      if (!isAddress(router)) {
        (releaseMode ? blocked : warn)(`${chainName} ${routeKey} TVL`, "router not recorded");
        continue;
      }
      const rpcUrl = env[origin.rpcEnv];
      const balance = route.tokens[chainName] === "ETH"
        ? await nativeBalance(rpcUrl, router)
        : await erc20Balance(rpcUrl, route.tokens[chainName], router);
      const price = route.priceSource === "chainlink-eth-usd" ? ethUsd : parseUsd(route.priceUsd);
      collateralUsd[routeKey][chainName] = usdForBalance(balance, route.decimals, price);
    }
    const routeTvl = Object.values(collateralUsd[routeKey]).reduce((total, value) => total + value, 0n);
    ok(`${routeKey.toUpperCase()} aggregate collateral`, formatUsd(routeTvl));
  }
  const aggregate = aggregateTvlUsd(collateralUsd);
  const cap = parseUsd(config.aggregateTvlLimitUsd);
  if (aggregate <= cap) ok("Total bridge collateral", `${formatUsd(aggregate)} <= ${formatUsd(cap)}`);
  else blocked("Total bridge collateral", `${formatUsd(aggregate)} exceeds ${formatUsd(cap)}`);
}

async function main() {
  const [env, config] = await Promise.all([readEnv(), readJson("ops/hyperlane/caps.mainnet.json")]);
  if (!config) throw new Error("Missing caps.mainnet.json");
  validateReview(env);
  await validateTemplates(config, env);
  await validateLiveTvl(config, env);
  const counts = checks.reduce((acc, check) => ({ ...acc, [check.status]: acc[check.status] + 1 }), {
    OK: 0,
    WARN: 0,
    BLOCKED: 0,
  });
  console.log("Bridge cap checks:");
  for (const check of checks) console.log(`[${check.status}] ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.BLOCKED} blocked`);
  if (counts.BLOCKED > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
