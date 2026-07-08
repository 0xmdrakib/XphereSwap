import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = process.cwd();
const OUT = resolve(ROOT, "docs", "mainnet-inputs.generated.md");
const OUT_VALUES = resolve(ROOT, "docs", "operator-values.missing.generated.json");
const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
const strict = process.argv.includes("--strict");
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

const ZERO = "0x0000000000000000000000000000000000000000";

const sections = [
  {
    title: "Private and RPC Inputs",
    items: [
      ["DEPLOYER_PRIVATE_KEY", "Private key for the deployment wallet. Put this in .env only; do not paste it in chat."],
      ["XPHERE_MAINNET_RPC_URL", "Dedicated Xphere mainnet RPC. Public RPC works for dev probes, but beta should use a dedicated endpoint."],
      ["ETHEREUM_MAINNET_RPC_URL", "Ethereum mainnet RPC for Hyperlane and funding checks."],
      ["SEPOLIA_RPC_URL", "Sepolia RPC for bridge rehearsal before mainnet release."],
      ["SKIP_SEPOLIA_REHEARSAL", "Set true only when the operator intentionally bypasses Sepolia and deploys direct to mainnet."],
      ["MAINNET_BETA_ACK", `Must be ${MAINNET_ACK} before live mainnet transactions.`],
    ],
  },
  {
    title: "Admin and Treasury",
    items: [
      ["PROTOCOL_ADMIN_SAFE", "Admin multisig address. Ethereum should use Safe; Xphere should use Safe or the chosen multisig admin."],
      ["TREASURY_SAFE", "Separate fee/protocol treasury multisig address."],
      ["ALLOW_ETHEREUM_PROTOCOL_MULTISIG", "Set true to let the orchestrator deploy ProtocolMultisig admin/treasury on Ethereum instead of using existing Safe addresses."],
      ["XPHERE_PROTOCOL_ADMIN_SAFE", "Optional Xphere-only ProtocolMultisig address from `pnpm deploy:admin:xphere-mainnet`."],
      ["XPHERE_TREASURY_SAFE", "Optional Xphere-only treasury multisig address from `pnpm deploy:admin:xphere-mainnet`."],
      ["SAFE_OWNER_1", "Owner 1 of the 3-of-5 admin group."],
      ["SAFE_OWNER_2", "Owner 2 of the 3-of-5 admin group."],
      ["SAFE_OWNER_3", "Owner 3 of the 3-of-5 admin group."],
      ["SAFE_OWNER_4", "Owner 4 of the 3-of-5 admin group."],
      ["SAFE_OWNER_5", "Owner 5 of the 3-of-5 admin group."],
      ["SAFE_THRESHOLD", "Must be 3."],
    ],
  },
  {
    title: "Hyperlane Operators",
    items: [
      ["HYPERLANE_VALIDATOR_1", "Validator signer address on host 1."],
      ["HYPERLANE_VALIDATOR_2", "Validator signer address on host 2."],
      ["HYPERLANE_VALIDATOR_3", "Validator signer address on host 3."],
      ["HYPERLANE_RELAYER_ADDRESS", "Relayer funding/monitoring address."],
      ["BRIDGE_CAPS_ACTIVE", "Must be true only after bridge caps are configured and monitored."],
      ["BRIDGE_CAPS_LAST_REVIEWED_AT", "ISO timestamp of the latest cap/TVL review before public beta."],
    ],
  },
  {
    title: "Bridge Outputs To Record After Deployment",
    items: [
      ["XPHERE_XUSDC_TOKEN", "Xphere synthetic USDC token from Hyperlane USDC route."],
      ["XPHERE_XUSDT_TOKEN", "Xphere synthetic USDT token from Hyperlane USDT route."],
      ["XPHERE_XETH_TOKEN", "Xphere synthetic ETH token from Hyperlane ETH route."],
      ["VITE_ETHEREUM_USDC_WARP_ROUTER", "Ethereum USDC Warp Route router."],
      ["VITE_XPHERE_USDC_WARP_ROUTER", "Xphere xUSDC Warp Route router."],
      ["VITE_ETHEREUM_USDT_WARP_ROUTER", "Ethereum USDT Warp Route router."],
      ["VITE_XPHERE_USDT_WARP_ROUTER", "Xphere xUSDT Warp Route router."],
      ["VITE_ETHEREUM_NATIVE_WARP_ROUTER", "Ethereum native ETH Warp Route router."],
      ["VITE_XPHERE_NATIVE_WARP_ROUTER", "Xphere xETH Warp Route router."],
    ],
  },
  {
    title: "Liquidity Release Inputs",
    items: [
      ["SEED_MAINNET_LIQUIDITY", "Set true only when the deployment wallet holds the initial pool tokens."],
      ["LIQUIDITY_MAINNET_ACK", "Must be I_UNDERSTAND_LIQUIDITY_SEEDING before live liquidity seeding."],
      ["LIQUIDITY_WXP_PER_STABLE_POOL", "WXP amount for WXP/xUSDC and WXP/xUSDT pools."],
      ["LIQUIDITY_STABLE_PER_WXP_POOL", "xUSDC or xUSDT amount paired with WXP."],
      ["LIQUIDITY_STABLE_STABLE_AMOUNT", "xUSDC and xUSDT amounts for the stable pool."],
      ["SEED_XETH_LIQUIDITY", "Set true when xETH is deployed and funded for ETH-to-XP UX."],
      ["LIQUIDITY_WXP_FOR_XETH_POOL", "WXP amount for WXP/xETH pool."],
      ["LIQUIDITY_XETH_FOR_WXP_POOL", "xETH amount for WXP/xETH pool."],
    ],
  },
];

function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) && normalized !== ZERO;
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

async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(ROOT, ".env");
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

function statusFor(key, value, env) {
  if (key === "DEPLOYER_PRIVATE_KEY") return isPrivateKey(value) ? "READY" : "NEEDED";
  if (key === "XPHERE_PROTOCOL_ADMIN_SAFE" || key === "XPHERE_TREASURY_SAFE") {
    return isAddress(value) ? "READY" : "LATER";
  }
  if ((key === "PROTOCOL_ADMIN_SAFE" || key === "TREASURY_SAFE") && env.ALLOW_ETHEREUM_PROTOCOL_MULTISIG === "true") {
    return isAddress(value) ? "READY" : "LATER";
  }
  if (key === "ALLOW_ETHEREUM_PROTOCOL_MULTISIG") return value === "true" ? "READY" : "LATER";
  if (key === "XPHERE_MAINNET_RPC_URL") return isUrl(value) && !PUBLIC_XPHERE_RPCS.has(value) ? "READY" : "NEEDED";
  if (key === "SEPOLIA_RPC_URL" && env.SKIP_SEPOLIA_REHEARSAL === "true") return "READY";
  if (key === "SKIP_SEPOLIA_REHEARSAL") return value === "true" ? "READY" : "LATER";
  if (key.endsWith("_URL")) return isUrl(value) ? "READY" : "NEEDED";
  if (key === "MAINNET_BETA_ACK") return value === MAINNET_ACK ? "READY" : "NEEDED";
  if (key === "BRIDGE_CAPS_ACTIVE") return value === "true" ? "READY" : "NEEDED";
  if (key === "BRIDGE_CAPS_LAST_REVIEWED_AT") {
    const date = new Date(value || "");
    return value && !Number.isNaN(date.getTime()) ? "READY" : "NEEDED";
  }
  if (key === "SAFE_THRESHOLD") return value === "3" ? "READY" : "NEEDED";
  if (key === "SEED_MAINNET_LIQUIDITY") return value === "true" ? "READY" : "LATER";
  if (key === "SEED_XETH_LIQUIDITY") return value === "true" ? "READY" : "LATER";
  if (key === "LIQUIDITY_MAINNET_ACK") {
    return value === "I_UNDERSTAND_LIQUIDITY_SEEDING" ? "READY" : "LATER";
  }
  if (key.startsWith("LIQUIDITY_")) return value ? "READY" : "LATER";
  if (key.startsWith("VITE_") || key.startsWith("XPHERE_X")) return isAddress(value) ? "READY" : "LATER";
  if (key.includes("SAFE") || key.includes("VALIDATOR") || key.includes("RELAYER")) {
    return isAddress(value) ? "READY" : "NEEDED";
  }
  return value ? "READY" : "NEEDED";
}

function displayValue(key, value) {
  if (!value) return "";
  if (key === "DEPLOYER_PRIVATE_KEY") return "<set>";
  if (key.includes("PRIVATE")) return "<set>";
  return value;
}

async function main() {
  const env = await readEnv();
  const lines = [
    "# Mainnet Inputs Generated Checklist",
    "",
    "Generated from the current `.env`. Private values are never printed.",
    "",
  ];

  const summary = { READY: 0, NEEDED: 0, LATER: 0 };
  const needed = [];
  const valuesTemplate = {};

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    lines.push("| Status | Key | Current | Why it matters |");
    lines.push("|---|---|---|---|");
    for (const [key, description] of section.items) {
      const status = statusFor(key, env[key], env);
      summary[status] += 1;
      if (status === "NEEDED") {
        needed.push(key);
        valuesTemplate[key] = defaultValueForMissingKey(key);
      }
      lines.push(`| ${status} | \`${key}\` | ${displayValue(key, env[key]) || "-"} | ${description} |`);
    }
    lines.push("");
  }

  lines.push("## Command Order", "");
  lines.push("```bash");
  lines.push("pnpm mainnet:inputs");
  lines.push("pnpm mainnet:orchestrate");
  lines.push("# After the dry run is clean and the deployer is funded:");
  lines.push("pnpm mainnet:orchestrate:live");
  lines.push("# After bridge operators, ownership, route addresses, and liquidity are ready:");
  lines.push("pnpm mainnet:orchestrate:release");
  lines.push("");
  lines.push("# Manual sequence, if you do not use the orchestrator:");
  lines.push("pnpm mainnet:predeploy");
  lines.push("pnpm bridge:core:deploy");
  lines.push("pnpm bridge:sync-artifacts");
  lines.push("pnpm bridge:record-core --mailbox 0x... --interchain-gas-paymaster 0x... --validator-announce 0x... --interchain-security-module 0x...");
  lines.push("pnpm bridge:prepare-registry");
  lines.push("pnpm bridge:render-routes");
  lines.push("pnpm bridge:hyperlane -- warp deploy --id USDC/ethereum-xphere");
  lines.push("pnpm bridge:hyperlane -- warp deploy --id USDT/ethereum-xphere");
  lines.push("pnpm bridge:hyperlane -- warp deploy --id ETH/ethereum-xphere");
  lines.push("pnpm bridge:sync-artifacts");
  lines.push("pnpm bridge:record-route usdc --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...");
  lines.push("pnpm bridge:record-route usdt --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...");
  lines.push("pnpm bridge:record-route native --ethereum-router 0x... --xphere-router 0x... --xphere-token 0xXethToken");
  lines.push("pnpm deploy:xphere-mainnet");
  lines.push("pnpm mainnet:predeploy:release");
  lines.push("pnpm release:mainnet-beta");
  lines.push("```", "");

  await mkdir(resolve(ROOT, "docs"), { recursive: true });
  await writeFile(OUT, `${lines.join("\n")}\n`);
  await writeFile(OUT_VALUES, `${JSON.stringify(valuesTemplate, null, 2)}\n`);

  console.log("Mainnet input checklist:");
  console.log(`READY=${summary.READY} NEEDED=${summary.NEEDED} LATER=${summary.LATER}`);
  if (needed.length > 0) {
    console.log(`Needed now: ${needed.join(", ")}`);
  } else {
    console.log("No immediate human inputs are missing.");
  }
  console.log("Wrote docs/mainnet-inputs.generated.md");
  console.log("Wrote docs/operator-values.missing.generated.json");

  if (strict && summary.NEEDED > 0) process.exitCode = 1;
}

function defaultValueForMissingKey(key) {
  if (key === "MAINNET_BETA_ACK") return MAINNET_ACK;
  if (key === "SAFE_THRESHOLD") return "3";
  if (key === "BRIDGE_CAPS_ACTIVE") return "true";
  if (key === "SKIP_SEPOLIA_REHEARSAL") return "false";
  if (key === "ALLOW_ETHEREUM_PROTOCOL_MULTISIG") return "false";
  return "";
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
