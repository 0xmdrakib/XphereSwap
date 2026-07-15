import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MAINNET_ACK,
  SECURITY_APPLY_ACK,
  ethDailyCap,
  isAddress,
  isPrivateKey,
  isUrl,
  readEnv,
} from "../ops/hyperlane/scripts/bridge-config.mjs";

const ROOT = process.cwd();
const OUT = resolve(ROOT, "docs", "mainnet-inputs.generated.md");
const OUT_VALUES = resolve(ROOT, "docs", "operator-values.missing.generated.json");
const strict = process.argv.includes("--strict");
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

const sections = [
  {
    title: "Private And RPC Inputs",
    items: [
      ["DEPLOYER_PRIVATE_KEY", "Deployment wallet key. Keep it only in the ignored local .env."],
      ["XPHERE_MAINNET_RPC_URL", "Dedicated Xphere mainnet RPC."],
      ["ETHEREUM_MAINNET_RPC_URL", "Dedicated Ethereum mainnet RPC."],
      ["BASE_MAINNET_RPC_URL", "Dedicated Base mainnet RPC."],
      ["SEPOLIA_RPC_URL", "Rehearsal RPC unless SKIP_SEPOLIA_REHEARSAL=true is explicitly reviewed."],
      ["MAINNET_BETA_ACK", `Must equal ${MAINNET_ACK} before any live deployment command.`],
    ],
  },
  {
    title: "Chain-Specific Safe Owners",
    items: [
      ["ETHEREUM_PROTOCOL_ADMIN_SAFE", "Ethereum route owner and Pausable ISM owner Safe."],
      ["BASE_PROTOCOL_ADMIN_SAFE", "Base route owner and Pausable ISM owner Safe."],
      ["XPHERE_PROTOCOL_ADMIN_SAFE", "Xphere route owner and Pausable ISM owner Safe."],
      ["PROTOCOL_ADMIN_SAFE", "Legacy value only; it is not accepted as a bridge owner fallback."],
    ],
  },
  {
    title: "Hyperlane Operators And Safety",
    items: [
      ["HYPERLANE_VALIDATOR_1", "Validator signer 1."],
      ["HYPERLANE_VALIDATOR_2", "Validator signer 2."],
      ["HYPERLANE_VALIDATOR_3", "Validator signer 3."],
      ["HYPERLANE_RELAYER_ADDRESS", "Funded relayer address monitored on all three chains."],
      ["ETHEREUM_MAILBOX", "Verified Ethereum Mailbox contract."],
      ["BASE_MAILBOX", "Verified Base Mailbox contract."],
      ["XPHERE_MAILBOX", "Deployed and verified Xphere Mailbox contract."],
      ["BRIDGE_ETH_DAILY_CAP_WEI", "Reviewed ETH destination capacity, positive and divisible by 86400."],
      ["BRIDGE_ETH_DAILY_CAP_REVIEWED", "Must be true after cap review."],
      ["BRIDGE_CAPS_ACTIVE", "Must be true after monitoring and pause controls are active."],
      ["BRIDGE_CAPS_LAST_REVIEWED_AT", "ISO timestamp no older than seven days at release."],
      ["BRIDGE_SECURITY_APPLY_ACK", `Must equal ${SECURITY_APPLY_ACK} before phase-two live apply.`],
    ],
  },
  {
    title: "Recorded Route Outputs",
    items: [
      ["XPHERE_XUSDC_TOKEN", "Single shared xUSDC synthetic token on Xphere."],
      ["XPHERE_XETH_TOKEN", "Single shared xETH synthetic token on Xphere."],
      ["VITE_ETHEREUM_USDC_WARP_ROUTER", "Ethereum USDC collateral router."],
      ["VITE_BASE_USDC_WARP_ROUTER", "Base USDC collateral router."],
      ["VITE_XPHERE_USDC_WARP_ROUTER", "Xphere xUSDC synthetic router."],
      ["VITE_ETHEREUM_NATIVE_WARP_ROUTER", "Ethereum native ETH router."],
      ["VITE_BASE_NATIVE_WARP_ROUTER", "Base native ETH router."],
      ["VITE_XPHERE_NATIVE_WARP_ROUTER", "Xphere xETH synthetic router."],
      ["VITE_BRIDGE_RELEASED", "Keep false until every release gate and delivery drill passes."],
    ],
  },
];

function statusFor(key, value, env) {
  if (key === "DEPLOYER_PRIVATE_KEY") return isPrivateKey(value) ? "READY" : "NEEDED";
  if (key === "XPHERE_MAINNET_RPC_URL") {
    return isUrl(value) && !PUBLIC_XPHERE_RPCS.has(value) ? "READY" : "NEEDED";
  }
  if (key === "SEPOLIA_RPC_URL" && env.SKIP_SEPOLIA_REHEARSAL === "true") return "READY";
  if (key.endsWith("_RPC_URL")) return isUrl(value) ? "READY" : "NEEDED";
  if (key === "MAINNET_BETA_ACK") return value === MAINNET_ACK ? "READY" : "NEEDED";
  if (key === "BRIDGE_SECURITY_APPLY_ACK") return value === SECURITY_APPLY_ACK ? "READY" : "NEEDED";
  if (key === "BRIDGE_ETH_DAILY_CAP_WEI") return ethDailyCap(env) ? "READY" : "NEEDED";
  if (key === "BRIDGE_ETH_DAILY_CAP_REVIEWED" || key === "BRIDGE_CAPS_ACTIVE") {
    return value === "true" ? "READY" : "NEEDED";
  }
  if (key === "BRIDGE_CAPS_LAST_REVIEWED_AT") {
    return value && !Number.isNaN(new Date(value).getTime()) ? "READY" : "NEEDED";
  }
  if (key === "VITE_BRIDGE_RELEASED") return value === "true" ? "RELEASE" : "LATER";
  if (key === "PROTOCOL_ADMIN_SAFE") return value ? "LATER" : "READY";
  if (key.includes("SAFE") || key.includes("VALIDATOR") || key.includes("RELAYER") || key.includes("MAILBOX")) {
    return isAddress(value) ? "READY" : "NEEDED";
  }
  if (key.startsWith("VITE_") || key.startsWith("XPHERE_X")) return isAddress(value) ? "READY" : "LATER";
  return value ? "READY" : "NEEDED";
}

function displayValue(key, value) {
  if (!value) return "";
  if (key.includes("PRIVATE")) return "<set>";
  if (key.endsWith("_RPC_URL")) return "<set>";
  return value;
}

function defaultValue(key) {
  if (key === "MAINNET_BETA_ACK") return MAINNET_ACK;
  if (key === "BRIDGE_SECURITY_APPLY_ACK") return SECURITY_APPLY_ACK;
  if (key === "BRIDGE_ETH_DAILY_CAP_REVIEWED" || key === "BRIDGE_CAPS_ACTIVE") return "true";
  return "";
}

async function main() {
  const env = await readEnv();
  const lines = [
    "# XphereSwap Bridge Mainnet Inputs",
    "",
    "Generated from the current ignored `.env`. Private values and RPC URLs are never printed.",
    "",
  ];
  const summary = { READY: 0, NEEDED: 0, LATER: 0, RELEASE: 0 };
  const needed = [];
  const valuesTemplate = {};

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    lines.push("| Status | Key | Current | Purpose |", "|---|---|---|---|");
    for (const [key, purpose] of section.items) {
      const status = statusFor(key, env[key], env);
      summary[status] += 1;
      if (status === "NEEDED") {
        needed.push(key);
        valuesTemplate[key] = defaultValue(key);
      }
      lines.push(`| ${status} | \`${key}\` | ${displayValue(key, env[key]) || "-"} | ${purpose} |`);
    }
    lines.push("");
  }

  lines.push(
    "## Command Order",
    "",
    "```bash",
    "pnpm mainnet:orchestrate",
    "# Future live deployment after review and funding:",
    "pnpm mainnet:orchestrate:live:node22",
    "",
    "# Manual route sequence:",
    "pnpm bridge:prepare-registry",
    "pnpm bridge:render-routes",
    "pnpm bridge:hyperlane -- warp deploy --id ETH/base-ethereum-xphere",
    "pnpm bridge:hyperlane -- warp deploy --id USDC/base-ethereum-xphere",
    "pnpm bridge:sync-artifacts",
    "pnpm bridge:record-route eth --base-router 0x... --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x... --base-mailbox 0x... --ethereum-mailbox 0x... --xphere-mailbox 0x... --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...",
    "pnpm bridge:record-route usdc --base-router 0x... --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x... --base-mailbox 0x... --ethereum-mailbox 0x... --xphere-mailbox 0x... --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...",
    "pnpm bridge:render-security",
    "pnpm bridge:apply-security:live",
    "pnpm bridge:record-security eth --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...",
    "pnpm bridge:record-security usdc --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...",
    "```",
    "",
  );

  await mkdir(resolve(ROOT, "docs"), { recursive: true });
  await writeFile(OUT, `${lines.join("\n")}\n`);
  await writeFile(OUT_VALUES, `${JSON.stringify(valuesTemplate, null, 2)}\n`);

  console.log("Bridge mainnet input checklist:");
  console.log(
    `READY=${summary.READY} NEEDED=${summary.NEEDED} LATER=${summary.LATER} RELEASE=${summary.RELEASE}`,
  );
  console.log(needed.length > 0 ? `Needed before live deployment: ${needed.join(", ")}` : "Live deployment inputs are present.");
  console.log("Generated ignored operator checklist files under docs/.");
  if (strict && needed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
