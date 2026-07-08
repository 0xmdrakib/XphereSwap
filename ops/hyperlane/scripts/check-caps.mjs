import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const opsDir = resolve(scriptDir, "..");
const repoDir = resolve(opsDir, "..", "..");
const releaseMode = process.argv.includes("--release");

const BALANCE_OF_SELECTOR = "0x70a08231";
const DECIMALS_SELECTOR = "0x313ce567";
const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";
const USD_SCALE = 1_000_000n;
const DAY_MS = 24 * 60 * 60 * 1000;

const checks = [];

function add(status, label, detail) {
  checks.push({ status, label, detail });
}

function ok(label, detail = "") {
  add("OK", label, detail);
}

function warn(label, detail = "") {
  add("WARN", label, detail);
}

function blocked(label, detail = "") {
  add("BLOCKED", label, detail);
}

function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) &&
    normalized !== "0x0000000000000000000000000000000000000000";
}

function isUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(repoDir, ".env");
  if (!existsSync(envPath)) return env;
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || env[match[1]] !== undefined) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function readJson(relativePath) {
  const path = resolve(repoDir, relativePath);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

function padAddress(address) {
  return String(address).toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function word(hex, index) {
  const clean = hex.replace(/^0x/, "");
  return `0x${clean.slice(index * 64, (index + 1) * 64)}`;
}

function uint(hex) {
  return BigInt(hex);
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `RPC ${method} failed`);
  return payload.result;
}

async function call(rpcUrl, to, data) {
  return rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]);
}

async function erc20Balance(rpcUrl, token, holder) {
  const data = `${BALANCE_OF_SELECTOR}${padAddress(holder)}`;
  return uint(await call(rpcUrl, token, data));
}

async function nativeBalance(rpcUrl, holder) {
  return uint(await rpc(rpcUrl, "eth_getBalance", [holder, "latest"]));
}

async function chainlinkEthUsd(rpcUrl, feed) {
  const decimals = Number(uint(await call(rpcUrl, feed, DECIMALS_SELECTOR)));
  const latest = await call(rpcUrl, feed, LATEST_ROUND_DATA_SELECTOR);
  const answer = uint(word(latest, 1));
  return (answer * USD_SCALE) / 10n ** BigInt(decimals);
}

function parseUsd(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole || "0") * USD_SCALE + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

function usdForBalance(balance, decimals, priceUsdScaled) {
  return (balance * priceUsdScaled) / 10n ** BigInt(decimals);
}

function formatUsd(scaled) {
  const sign = scaled < 0n ? "-" : "";
  const value = scaled < 0n ? -scaled : scaled;
  const whole = value / USD_SCALE;
  const fraction = value % USD_SCALE;
  return `${sign}$${whole}.${fraction.toString().padStart(6, "0").slice(0, 2)}`;
}

function validateReviewDate(env) {
  if (!releaseMode) return;
  if (env.BRIDGE_CAPS_ACTIVE !== "true") {
    blocked("BRIDGE_CAPS_ACTIVE", "must be true before public beta release");
  } else {
    ok("BRIDGE_CAPS_ACTIVE", "operator cap controls acknowledged");
  }

  const raw = env.BRIDGE_CAPS_LAST_REVIEWED_AT;
  if (!raw) {
    blocked("BRIDGE_CAPS_LAST_REVIEWED_AT", "set to an ISO timestamp after the latest cap drill");
    return;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    blocked("BRIDGE_CAPS_LAST_REVIEWED_AT", "invalid timestamp");
    return;
  }

  const age = Date.now() - date.getTime();
  if (age < 0 || age > 7 * DAY_MS) {
    blocked("BRIDGE_CAPS_LAST_REVIEWED_AT", "cap review must be within the last 7 days");
  } else {
    ok("BRIDGE_CAPS_LAST_REVIEWED_AT", date.toISOString());
  }
}

async function validateTemplates(config) {
  for (const [asset, route] of Object.entries(config.routes)) {
    const templatePath = resolve(opsDir, "warp-routes", route.template);
    const parsed = YAML.parse(await readFile(templatePath, "utf8"));
    if (parsed.options?.dailyLimitUsd === route.dailyLimitUsd) {
      ok(`${asset} daily cap template`, `$${route.dailyLimitUsd}`);
    } else {
      blocked(`${asset} daily cap template`, `expected ${route.dailyLimitUsd}, got ${parsed.options?.dailyLimitUsd}`);
    }
    if (parsed.options?.totalTvlLimitUsd === route.totalTvlLimitUsd) {
      ok(`${asset} TVL cap template`, `$${route.totalTvlLimitUsd}`);
    } else {
      blocked(`${asset} TVL cap template`, `expected ${route.totalTvlLimitUsd}, got ${parsed.options?.totalTvlLimitUsd}`);
    }
  }
}

async function validateLiveTvl(config, env) {
  const ethereum = await readJson("deployments/ethereum-mainnet.local.json");
  if (!ethereum) {
    const message = "mainnet route artifact not present yet";
    if (releaseMode) blocked("Bridge TVL", message);
    else warn("Bridge TVL", message);
    return;
  }

  if (!isUrl(env.ETHEREUM_MAINNET_RPC_URL)) {
    const message = "ETHEREUM_MAINNET_RPC_URL is required for live TVL checks";
    if (releaseMode) blocked("Bridge TVL RPC", message);
    else warn("Bridge TVL RPC", message);
    return;
  }

  let ethUsd = 0n;
  if (Object.values(config.routes).some((route) => route.priceSource === "chainlink-eth-usd")) {
    const feed = env.BRIDGE_ETH_USD_PRICE_FEED || config.ethUsdFeed;
    if (!isAddress(feed)) {
      blocked("ETH/USD feed", "missing Chainlink feed address");
      return;
    }
    ethUsd = await chainlinkEthUsd(env.ETHEREUM_MAINNET_RPC_URL, feed);
    ok("ETH/USD feed", formatUsd(ethUsd));
  }

  for (const [asset, route] of Object.entries(config.routes)) {
    const router = ethereum.bridgeRoutes?.[route.routeKey]?.sourceRouter || ethereum.contracts?.[`${asset.toLowerCase()}WarpRouter`];
    if (!isAddress(router)) {
      const message = "route router not recorded yet";
      if (releaseMode) blocked(`${asset} TVL`, message);
      else warn(`${asset} TVL`, message);
      continue;
    }

    const balance =
      route.token === "ETH"
        ? await nativeBalance(env.ETHEREUM_MAINNET_RPC_URL, router)
        : await erc20Balance(env.ETHEREUM_MAINNET_RPC_URL, route.token, router);
    const price = route.priceSource === "chainlink-eth-usd" ? ethUsd : parseUsd(route.priceUsd);
    const tvl = usdForBalance(balance, route.decimals, price);
    const cap = parseUsd(route.totalTvlLimitUsd);
    if (tvl <= cap) {
      ok(`${asset} TVL`, `${formatUsd(tvl)} <= ${formatUsd(cap)}`);
    } else {
      blocked(`${asset} TVL`, `${formatUsd(tvl)} exceeds ${formatUsd(cap)}`);
    }
  }
}

async function main() {
  const [env, config] = await Promise.all([
    readEnv(),
    readJson("ops/hyperlane/caps.mainnet.json"),
  ]);
  if (!config) throw new Error("Missing ops/hyperlane/caps.mainnet.json");

  validateReviewDate(env);
  await validateTemplates(config);
  await validateLiveTvl(config, env);

  const counts = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { OK: 0, WARN: 0, BLOCKED: 0 },
  );

  console.log("Bridge cap checks:");
  for (const check of checks) {
    console.log(`[${check.status}] ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
  }
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.BLOCKED} blocked`);

  if (counts.BLOCKED > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
