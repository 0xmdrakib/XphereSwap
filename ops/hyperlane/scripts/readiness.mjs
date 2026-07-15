import {
  CHAINS,
  MAINNET_ACK,
  ROUTES,
  SECURITY_APPLY_ACK,
  ethDailyCap,
  isAddress,
  isPrivateKey,
  isUrl,
  readArtifact,
  readEnv,
  routeComplete,
  validatorsFromEnv,
} from "./bridge-config.mjs";

const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);
const checks = [];

function add(status, label, detail) {
  checks.push({ status, label, detail });
}
const ok = (label, detail = "") => add("OK", label, detail);
const warn = (label, detail = "") => add("WARN", label, detail);
const blocked = (label, detail = "") => add("BLOCKED", label, detail);

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

async function requireContract(rpcUrl, address, label) {
  if (!isAddress(address)) {
    blocked(label, "missing or invalid address");
    return;
  }
  try {
    const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
    if (code && code !== "0x") ok(label, "contract code verified");
    else blocked(label, "address has no contract code");
  } catch (error) {
    blocked(label, `RPC verification failed: ${error.message}`);
  }
}

function validateReviewDate(env) {
  const reviewed = new Date(env.BRIDGE_CAPS_LAST_REVIEWED_AT || "");
  const age = Date.now() - reviewed.getTime();
  if (!Number.isNaN(reviewed.getTime()) && age >= 0 && age <= 7 * 86_400_000) {
    ok("BRIDGE_CAPS_LAST_REVIEWED_AT", reviewed.toISOString());
  } else {
    blocked("BRIDGE_CAPS_LAST_REVIEWED_AT", "must be reviewed within seven days");
  }
}

async function main() {
  const env = await readEnv();
  const artifacts = Object.fromEntries(
    await Promise.all(Object.keys(CHAINS).map(async (chainName) => [chainName, await readArtifact(chainName)])),
  );

  if (isPrivateKey(env.DEPLOYER_PRIVATE_KEY)) ok("DEPLOYER_PRIVATE_KEY", "set");
  else blocked("DEPLOYER_PRIVATE_KEY", "missing or invalid");
  if (env.MAINNET_BETA_ACK === MAINNET_ACK) ok("MAINNET_BETA_ACK", "set");
  else blocked("MAINNET_BETA_ACK", `must equal ${MAINNET_ACK}`);
  if (env.BRIDGE_SECURITY_APPLY_ACK === SECURITY_APPLY_ACK) ok("BRIDGE_SECURITY_APPLY_ACK", "set");
  else blocked("BRIDGE_SECURITY_APPLY_ACK", `must equal ${SECURITY_APPLY_ACK}`);

  for (const [chainName, chain] of Object.entries(CHAINS)) {
    if (isUrl(env[chain.rpcEnv])) ok(chain.rpcEnv, "URL set");
    else blocked(chain.rpcEnv, "missing or invalid URL");
    if (chainName === "xphere" && PUBLIC_XPHERE_RPCS.has(env[chain.rpcEnv])) {
      blocked(chain.rpcEnv, "public fallback RPC cannot be used for release");
    }
  }

  const owners = Object.values(CHAINS).map((chain) => env[chain.ownerEnv]);
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    if (isAddress(env[chain.ownerEnv])) ok(chain.ownerEnv, "address set");
    else blocked(chain.ownerEnv, "missing or invalid Safe address");
    if (isUrl(env[chain.rpcEnv]) && isAddress(env[chain.ownerEnv])) {
      await requireContract(env[chain.rpcEnv], env[chain.ownerEnv], `${chainName} route owner Safe`);
    }
  }
  if (owners.every(isAddress) && new Set(owners.map((owner) => owner.toLowerCase())).size === owners.length) {
    ok("Route owner separation", "three unique Safe contracts");
  } else {
    blocked("Route owner separation", "Ethereum, Base, and Xphere owners must be unique");
  }

  const validators = validatorsFromEnv(env);
  if (validators.every(isAddress) && new Set(validators.map((value) => value.toLowerCase())).size === 3) {
    ok("Hyperlane validators", "three unique validators");
  } else {
    blocked("Hyperlane validators", "three unique addresses required");
  }
  if (isAddress(env.HYPERLANE_RELAYER_ADDRESS)) ok("HYPERLANE_RELAYER_ADDRESS", "set");
  else blocked("HYPERLANE_RELAYER_ADDRESS", "missing");

  if (env.BRIDGE_CAPS_ACTIVE === "true") ok("BRIDGE_CAPS_ACTIVE", "enabled");
  else blocked("BRIDGE_CAPS_ACTIVE", "must be true");
  validateReviewDate(env);
  if (env.BRIDGE_ETH_DAILY_CAP_REVIEWED === "true" && ethDailyCap(env)) {
    ok("BRIDGE_ETH_DAILY_CAP_WEI", env.BRIDGE_ETH_DAILY_CAP_WEI);
  } else {
    blocked("BRIDGE_ETH_DAILY_CAP_WEI", "reviewed positive value divisible by 86400 required");
  }

  for (const [chainName, chain] of Object.entries(CHAINS)) {
    const artifact = artifacts[chainName];
    if (artifact.chainId === chain.chainId) ok(`${chain.artifact} chainId`, String(chain.chainId));
    else blocked(`${chain.artifact} chainId`, `expected ${chain.chainId}, got ${artifact.chainId}`);
    for (const routeKey of Object.keys(ROUTES)) {
      const record = artifact.bridgeRoutes?.[routeKey];
      if (routeComplete(artifact, routeKey, chainName, { requireSecurity: true })) {
        ok(`${chainName} ${routeKey} route`, "recorded with final security");
      } else {
        blocked(`${chainName} ${routeKey} route`, "missing normalized route or final security record");
      }
      if (isUrl(env[chain.rpcEnv]) && record) {
        await requireContract(env[chain.rpcEnv], record.mailbox, `${chainName} ${routeKey} Mailbox`);
        await requireContract(env[chain.rpcEnv], record.router, `${chainName} ${routeKey} router`);
        await requireContract(env[chain.rpcEnv], record.interchainSecurityModule, `${chainName} ${routeKey} final ISM`);
      }
      if (record?.owner && env[chain.ownerEnv] && record.owner.toLowerCase() !== env[chain.ownerEnv].toLowerCase()) {
        blocked(`${chainName} ${routeKey} owner`, "artifact owner differs from configured Safe");
      }
    }
  }

  const xphere = artifacts.xphere;
  for (const key of ["wXP", "factory", "router", "multicall3"]) {
    if (isAddress(xphere.contracts?.[key])) ok(`Xphere swap ${key}`, "recorded");
    else blocked(`Xphere swap ${key}`, "missing");
  }
  if (isAddress(xphere.tokens?.XEF) && env.VITE_XEF_OFFICIAL_VERIFIED === "true") {
    ok("XEF official verification", "configured");
  } else {
    warn("XEF official verification", "swap remains usable, but verified flag should match the live XEF address");
  }

  if (env.VITE_BRIDGE_RELEASED === "true") ok("VITE_BRIDGE_RELEASED", "explicit live release flag set");
  else blocked("VITE_BRIDGE_RELEASED", "must remain false until every release gate passes");

  const counts = checks.reduce((acc, check) => ({ ...acc, [check.status]: acc[check.status] + 1 }), {
    OK: 0,
    WARN: 0,
    BLOCKED: 0,
  });
  console.log("Mainnet bridge readiness:");
  for (const check of checks) console.log(`[${check.status}] ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
  console.log(`Summary: ${counts.OK} OK, ${counts.WARN} warnings, ${counts.BLOCKED} blocked`);
  if (counts.BLOCKED > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
