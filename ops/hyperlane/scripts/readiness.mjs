import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "../../..");

const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

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

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(repoDir, ".env");
  if (!(await exists(envPath))) return env;

  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;
    env[key] = value.replace(/^["']|["']$/g, "");
  }
  return env;
}

function requireAddress(env, key) {
  const value = env[key];
  if (isAddress(value)) ok(key, "address set");
  else blocked(key, "missing or invalid EVM address");
}

function requireUrl(env, key) {
  const value = env[key];
  if (isUrl(value)) ok(key, "URL set");
  else blocked(key, "missing or invalid URL");
}

function requireWarpRouter(env, key) {
  const value = env[key];
  if (isAddress(value)) ok(key, "router address set");
  else blocked(key, "missing until Hyperlane Warp Route deployment is complete");
}

async function validateArtifact(relativePath, expectedChainId, requiredContracts = [], requiredTokens = []) {
  const artifactPath = resolve(repoDir, relativePath);
  if (!(await exists(artifactPath))) {
    blocked(relativePath, "deployment artifact not written yet");
    return;
  }

  try {
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    if (artifact.chainId === expectedChainId) ok(`${relativePath} chainId`, String(expectedChainId));
    else blocked(`${relativePath} chainId`, `expected ${expectedChainId}, got ${artifact.chainId}`);

    for (const contractName of requiredContracts) {
      const value = artifact.contracts?.[contractName] ?? artifact[contractName];
      if (isAddress(value)) ok(`${relativePath} ${contractName}`, "address recorded");
      else blocked(`${relativePath} ${contractName}`, "missing address");
    }
    for (const tokenName of requiredTokens) {
      const value = artifact.tokens?.[tokenName];
      if (isAddress(value)) ok(`${relativePath} ${tokenName}`, "token address recorded");
      else blocked(`${relativePath} ${tokenName}`, "missing token address");
    }
  } catch (error) {
    blocked(relativePath, `invalid JSON: ${error.message}`);
  }
}

function validateSafe(env) {
  requireAddress(env, "PROTOCOL_ADMIN_SAFE");
  requireAddress(env, "TREASURY_SAFE");

  const admin = String(env.PROTOCOL_ADMIN_SAFE || "").toLowerCase();
  const treasury = String(env.TREASURY_SAFE || "").toLowerCase();
  if (admin && treasury && admin === treasury) {
    blocked("Safe separation", "PROTOCOL_ADMIN_SAFE and TREASURY_SAFE must be different");
  } else if (admin && treasury) {
    ok("Safe separation", "admin and treasury are separate");
  }

  const owners = [];
  for (let index = 1; index <= 5; index += 1) {
    const key = `SAFE_OWNER_${index}`;
    const value = env[key];
    if (isAddress(value)) {
      ok(key, "owner address set");
      owners.push(value.toLowerCase());
    } else {
      blocked(key, "missing or invalid Safe owner address");
    }
  }

  if (owners.length === 5 && new Set(owners).size === owners.length) {
    ok("Safe owners unique", "5 unique owners");
  } else {
    blocked("Safe owners unique", "owners must be 5 unique addresses");
  }

  if (env.SAFE_THRESHOLD === "3") ok("SAFE_THRESHOLD", "3-of-5");
  else blocked("SAFE_THRESHOLD", "must be 3 for beta");
}

function validateHyperlaneOperators(env) {
  const validators = [];
  for (let index = 1; index <= 3; index += 1) {
    const key = `HYPERLANE_VALIDATOR_${index}`;
    const value = env[key];
    if (isAddress(value)) {
      ok(key, "validator address set");
      validators.push(value.toLowerCase());
    } else {
      blocked(key, "missing validator signer address");
    }
  }

  if (validators.length === 3 && new Set(validators).size === validators.length) {
    ok("Hyperlane validator uniqueness", "3 unique validators");
  } else {
    blocked("Hyperlane validator uniqueness", "validators must be unique");
  }

  if (isAddress(env.HYPERLANE_RELAYER_ADDRESS)) {
    ok("HYPERLANE_RELAYER_ADDRESS", "relayer address set");
  } else {
    blocked("HYPERLANE_RELAYER_ADDRESS", "relayer funding/monitoring address is required for public beta");
  }
}

async function main() {
  const env = await readEnv();

  if (isPrivateKey(env.DEPLOYER_PRIVATE_KEY)) ok("DEPLOYER_PRIVATE_KEY", "set");
  else blocked("DEPLOYER_PRIVATE_KEY", "missing or invalid 32-byte private key");

  if (env.MAINNET_BETA_ACK === MAINNET_ACK) ok("MAINNET_BETA_ACK", "explicit beta acknowledgement set");
  else blocked("MAINNET_BETA_ACK", `must equal ${MAINNET_ACK}`);

  requireUrl(env, "XPHERE_MAINNET_RPC_URL");
  requireUrl(env, "ETHEREUM_MAINNET_RPC_URL");
  if (env.SKIP_SEPOLIA_REHEARSAL === "true") {
    warn("SEPOLIA_RPC_URL", "Sepolia rehearsal intentionally skipped by operator");
  } else {
    requireUrl(env, "SEPOLIA_RPC_URL");
  }
  requireUrl(env, "XPHERE_TESTNET_RPC_URL");

  if (PUBLIC_XPHERE_RPCS.has(env.XPHERE_MAINNET_RPC_URL)) {
    blocked("XPHERE_MAINNET_RPC_URL", "public RPC is acceptable for development, but public beta needs a dedicated endpoint");
  }

  validateSafe(env);
  validateHyperlaneOperators(env);

  requireWarpRouter(env, "VITE_ETHEREUM_USDC_WARP_ROUTER");
  requireWarpRouter(env, "VITE_XPHERE_USDC_WARP_ROUTER");
  requireWarpRouter(env, "VITE_ETHEREUM_USDT_WARP_ROUTER");
  requireWarpRouter(env, "VITE_XPHERE_USDT_WARP_ROUTER");
  requireWarpRouter(env, "VITE_ETHEREUM_NATIVE_WARP_ROUTER");
  requireWarpRouter(env, "VITE_XPHERE_NATIVE_WARP_ROUTER");

  if (isAddress(env.XPHERE_XEF_TOKEN || env.VITE_XPHERE_XEF)) {
    if (env.VITE_XEF_OFFICIAL_VERIFIED === "true") {
      ok("XEF official verification", "enabled by operator");
    } else {
      warn("XEF official verification", "XEF address is configured but default trust is not enabled");
    }
  } else {
    warn("XEF token", "not configured; XEF pool should stay hidden from mainnet defaults");
  }

  await validateArtifact(
    "deployments/xphere-mainnet.local.json",
    20250217,
    ["wXP", "factory", "router", "multicall3", "wXPxUSDCPair", "wXPxUSDTPair", "xUSDCxUSDTPair", "wXPxETHPair"],
    ["xUSDC", "xUSDT", "xETH"],
  );
  await validateArtifact("deployments/ethereum-mainnet.local.json", 1);

  const xphereArtifactPath = resolve(repoDir, "deployments/xphere-mainnet.local.json");
  if (await exists(xphereArtifactPath)) {
    try {
      const artifact = JSON.parse(await readFile(xphereArtifactPath, "utf8"));
      if (artifact.bridgeRoutes?.seededLiquidity?.xethEnabled === true) {
        ok("WXP/xETH liquidity", "ETH-to-XP swap path seeded");
      } else {
        blocked("WXP/xETH liquidity", "seed WXP/xETH before advertising ETH-to-XP public UX");
      }
    } catch {
      blocked("WXP/xETH liquidity", "could not inspect xphere-mainnet artifact");
    }
  }

  const counts = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { OK: 0, WARN: 0, BLOCKED: 0 },
  );

  console.log("Mainnet beta readiness:");
  for (const check of checks) {
    console.log(`[${check.status}] ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
  }
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.BLOCKED} blocked`);

  if (counts.BLOCKED > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
