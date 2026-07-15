import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
const strict = process.argv.includes("--strict");
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

const checks = [];

function add(status, key, message) {
  checks.push({ status, key, message });
}

function ok(key, message) {
  add("OK", key, message);
}

function warn(key, message) {
  add("WARN", key, message);
}

function missing(key, message) {
  add("MISSING", key, message);
}

function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) && normalized !== "0x0000000000000000000000000000000000000000";
}

function isPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

function isUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readEnvFile() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) {
    warn(".env", "not found; run pnpm env:init");
    return {};
  }
  const env = {};
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function compareEnvTemplate() {
  const envPath = resolve(ROOT, ".env");
  const examplePath = resolve(ROOT, ".env.example");
  if (!existsSync(envPath) || !existsSync(examplePath)) return;

  const [envRaw, exampleRaw] = await Promise.all([readFile(envPath, "utf8"), readFile(examplePath, "utf8")]);
  const keyPattern = /^([A-Za-z_][A-Za-z0-9_]*)=/;
  const envKeys = new Set(
    envRaw
      .split(/\r?\n/)
      .map((line) => line.match(keyPattern)?.[1])
      .filter(Boolean),
  );
  const exampleKeys = exampleRaw
    .split(/\r?\n/)
    .map((line) => line.match(keyPattern)?.[1])
    .filter(Boolean);

  const missingKeys = exampleKeys.filter((key) => !envKeys.has(key));
  if (missingKeys.length > 0) {
    warn(".env schema", `missing keys from .env.example: ${missingKeys.join(", ")}`);
  } else {
    ok(".env schema", "matches .env.example keys");
  }
}

function checkAddress(env, key, requiredFor) {
  if (isAddress(env[key])) ok(key, requiredFor);
  else missing(key, requiredFor);
}

function checkUrl(env, key, requiredFor) {
  if (isUrl(env[key])) ok(key, requiredFor);
  else missing(key, requiredFor);
}

async function main() {
  const env = { ...(await readEnvFile()), ...process.env };
  await compareEnvTemplate();

  if (isPrivateKey(env.DEPLOYER_PRIVATE_KEY)) ok("DEPLOYER_PRIVATE_KEY", "testnet/mainnet deployer");
  else missing("DEPLOYER_PRIVATE_KEY", "needed for testnet/mainnet deployment");

  checkUrl(env, "XPHERE_TESTNET_RPC_URL", "Xphere testnet deploy");
  if (!isUrl(env.XPHERE_MAINNET_RPC_URL)) {
    missing("XPHERE_MAINNET_RPC_URL", "Xphere mainnet deploy");
  } else if (PUBLIC_XPHERE_RPCS.has(env.XPHERE_MAINNET_RPC_URL)) {
    if (strict) missing("XPHERE_MAINNET_RPC_URL", "public RPC is dev-only; use a dedicated endpoint for mainnet beta");
    else warn("XPHERE_MAINNET_RPC_URL", "public RPC is dev-only; use a dedicated endpoint for mainnet beta");
  } else {
    ok("XPHERE_MAINNET_RPC_URL", "Xphere mainnet deploy");
  }
  if (env.SKIP_SEPOLIA_REHEARSAL === "true") {
    warn("SEPOLIA_RPC_URL", "Sepolia rehearsal intentionally skipped by operator");
  } else {
    checkUrl(env, "SEPOLIA_RPC_URL", "Sepolia bridge rehearsal");
  }
  checkUrl(env, "ETHEREUM_MAINNET_RPC_URL", "Ethereum mainnet bridge");
  checkUrl(env, "BASE_MAINNET_RPC_URL", "Base mainnet bridge");

  checkAddress(env, "ETHEREUM_PROTOCOL_ADMIN_SAFE", "Ethereum bridge route owner Safe");
  checkAddress(env, "BASE_PROTOCOL_ADMIN_SAFE", "Base bridge route owner Safe");
  checkAddress(env, "XPHERE_PROTOCOL_ADMIN_SAFE", "Xphere bridge route owner Safe");
  if (
    [env.ETHEREUM_PROTOCOL_ADMIN_SAFE, env.BASE_PROTOCOL_ADMIN_SAFE, env.XPHERE_PROTOCOL_ADMIN_SAFE].every(isAddress) &&
    new Set(
      [env.ETHEREUM_PROTOCOL_ADMIN_SAFE, env.BASE_PROTOCOL_ADMIN_SAFE, env.XPHERE_PROTOCOL_ADMIN_SAFE]
        .map((value) => value.toLowerCase()),
    ).size === 3
  ) {
    ok("BRIDGE_ROUTE_OWNERS", "three unique chain-specific Safe addresses");
  } else {
    missing("BRIDGE_ROUTE_OWNERS", "Ethereum, Base, and Xphere owners must be valid and unique");
  }
  if (isAddress(env.TREASURY_SAFE)) ok("TREASURY_SAFE", "existing swap fee recipient");
  else warn("TREASURY_SAFE", "only needed for future swap fee administration");
  if (isAddress(env.PROTOCOL_ADMIN_SAFE)) warn("PROTOCOL_ADMIN_SAFE", "legacy fallback is ignored for bridge ownership");
  else ok("PROTOCOL_ADMIN_SAFE", "legacy bridge owner fallback is unset");
  if (env.ALLOW_ETHEREUM_PROTOCOL_MULTISIG === "true") {
    missing("ALLOW_ETHEREUM_PROTOCOL_MULTISIG", "unsupported for bridge release; use existing chain-specific Safes");
  } else {
    ok("ALLOW_ETHEREUM_PROTOCOL_MULTISIG", "disabled");
  }
  if (isAddress(env.XPHERE_TREASURY_SAFE)) ok("XPHERE_TREASURY_SAFE", "Xphere-only treasury multisig");
  else warn("XPHERE_TREASURY_SAFE", "optional until Xphere treasury multisig is deployed");
  for (let index = 1; index <= 3; index += 1) {
    checkAddress(env, `HYPERLANE_VALIDATOR_${index}`, "2-of-3 Hyperlane ISM");
  }
  if (isAddress(env.HYPERLANE_RELAYER_ADDRESS)) ok("HYPERLANE_RELAYER_ADDRESS", "operator funding check");
  else missing("HYPERLANE_RELAYER_ADDRESS", "required before bridge beta");
  if (env.BRIDGE_CAPS_ACTIVE === "true") ok("BRIDGE_CAPS_ACTIVE", "bridge caps acknowledged");
  else missing("BRIDGE_CAPS_ACTIVE", "must be true before public bridge beta");
  if (env.BRIDGE_CAPS_LAST_REVIEWED_AT && !Number.isNaN(new Date(env.BRIDGE_CAPS_LAST_REVIEWED_AT).getTime())) {
    ok("BRIDGE_CAPS_LAST_REVIEWED_AT", "cap review timestamp set");
  } else {
    missing("BRIDGE_CAPS_LAST_REVIEWED_AT", "set ISO timestamp after cap/TVL review");
  }

  for (const key of [
    "VITE_BASE_USDC_WARP_ROUTER",
    "VITE_ETHEREUM_USDC_WARP_ROUTER",
    "VITE_XPHERE_USDC_WARP_ROUTER",
    "VITE_BASE_NATIVE_WARP_ROUTER",
    "VITE_ETHEREUM_NATIVE_WARP_ROUTER",
    "VITE_XPHERE_NATIVE_WARP_ROUTER",
    "VITE_BASE_MAILBOX",
    "VITE_ETHEREUM_MAILBOX",
    "VITE_XPHERE_MAILBOX",
  ]) {
    if (isAddress(env[key])) ok(key, "frontend bridge route");
    else warn(key, "needed before public bridge beta");
  }

  if (env.XPHERE_XEF_TOKEN) {
    if (isAddress(env.XPHERE_XEF_TOKEN)) ok("XPHERE_XEF_TOKEN", "candidate XEF token address");
    else missing("XPHERE_XEF_TOKEN", "invalid XEF token address");
  }
  if (env.FORCE_REDEPLOY_SWAP === "true") warn("FORCE_REDEPLOY_SWAP", "enabled; mainnet swap deploy will overwrite previous router/factory/WXP addresses");
  else ok("FORCE_REDEPLOY_SWAP", "disabled");
  if (isAddress(env.XPHERE_XUSDC_TOKEN || env.VITE_XPHERE_XUSDC)) {
    ok("XPHERE_XUSDC_TOKEN", "shared Xphere synthetic USDC address configured");
  } else {
    warn("XPHERE_XUSDC_TOKEN", "needed before the USDC bridge route can be released");
  }
  if (isAddress(env.XPHERE_XETH_TOKEN || env.VITE_XPHERE_XETH)) {
    ok("XPHERE_XETH_TOKEN", "mainnet bridged ETH address configured");
  } else {
    warn("XPHERE_XETH_TOKEN", "needed before ETH can land on Xphere and swap into XP");
  }
  if (env.BRIDGE_ETH_DAILY_CAP_REVIEWED === "true" && /^\d+$/.test(env.BRIDGE_ETH_DAILY_CAP_WEI || "")) {
    const cap = BigInt(env.BRIDGE_ETH_DAILY_CAP_WEI);
    if (cap > 0n && cap % 86_400n === 0n) ok("BRIDGE_ETH_DAILY_CAP_WEI", "reviewed and divisible by 86400");
    else missing("BRIDGE_ETH_DAILY_CAP_WEI", "must be positive and divisible by 86400");
  } else {
    missing("BRIDGE_ETH_DAILY_CAP_WEI", "set a reviewed cap and BRIDGE_ETH_DAILY_CAP_REVIEWED=true");
  }
  if (env.VITE_BRIDGE_RELEASED === "true") warn("VITE_BRIDGE_RELEASED", "live release flag set; run full readiness before publishing");
  else ok("VITE_BRIDGE_RELEASED", "false or unset; bridge remains in preview mode");
  if (env.VITE_XEF_OFFICIAL_VERIFIED === "true" && !isAddress(env.XPHERE_XEF_TOKEN)) {
    missing("VITE_XEF_OFFICIAL_VERIFIED", "cannot be true without XPHERE_XEF_TOKEN");
  } else if (env.VITE_XEF_OFFICIAL_VERIFIED === "true") {
    ok("VITE_XEF_OFFICIAL_VERIFIED", "XEF official verification flag enabled");
  } else {
    warn("VITE_XEF_OFFICIAL_VERIFIED", "leave false until XEF address is official-confirmed");
  }

  if (env.MAINNET_BETA_ACK === MAINNET_ACK) ok("MAINNET_BETA_ACK", "mainnet deploy acknowledgement");
  else missing("MAINNET_BETA_ACK", `must equal ${MAINNET_ACK} before live mainnet deployment`);

  const counts = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { OK: 0, WARN: 0, MISSING: 0 },
  );

  console.log("Environment doctor:");
  for (const check of checks) {
    console.log(`[${check.status}] ${check.key} - ${check.message}`);
  }
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.MISSING} missing`);

  if (strict && counts.MISSING > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
