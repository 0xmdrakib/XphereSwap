import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";
const releaseMode = process.argv.includes("--release");
const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

async function readDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return {};
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

async function readJsonIfExists(relativePath) {
  const path = resolve(process.cwd(), relativePath);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) &&
    String(value).toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

function hasToken(env, artifact, envName, viteName, artifactName) {
  return isAddress(env[envName]) || isAddress(env[viteName]) || isAddress(artifact?.tokens?.[artifactName]);
}

function hasSwapDeployment(artifact) {
  return (
    isAddress(artifact?.contracts?.wXP) &&
    isAddress(artifact?.contracts?.factory) &&
    isAddress(artifact?.contracts?.router) &&
    isAddress(artifact?.contracts?.multicall3)
  );
}

function hasAddress(env, key) {
  return isAddress(env[key]);
}

function isSwapMvp(env) {
  return (
    process.argv.includes("--swap-mvp") ||
    env.DEPLOY_XPHERE_SWAP_MVP === "true" ||
    env.XPHERE_SWAP_MVP === "true" ||
    env.DEPLOY_XPHERE_ONLY_MVP === "true"
  );
}

function hasFullBetaLiquidity(artifact) {
  return (
    artifact?.bridgeRoutes?.seededLiquidity?.xethEnabled === true &&
    isAddress(artifact?.contracts?.wXPxUSDCPair) &&
    isAddress(artifact?.contracts?.wXPxUSDTPair) &&
    isAddress(artifact?.contracts?.xUSDCxUSDTPair) &&
    isAddress(artifact?.contracts?.wXPxETHPair)
  );
}

function assertMainnetIntent(env, artifact) {
  const swapMvp = isSwapMvp(env);
  if (env.MAINNET_BETA_ACK !== MAINNET_ACK) {
    throw new Error(`Refusing mainnet run: MAINNET_BETA_ACK must equal ${MAINNET_ACK}`);
  }
  if (releaseMode && swapMvp) {
    throw new Error("Refusing release mode: DEPLOY_XPHERE_SWAP_MVP=true is only for the Xphere-only swap MVP path");
  }
  if (env.DEPLOY_MOCK_BRIDGED_TOKENS === "true") {
    throw new Error("Refusing mainnet run: DEPLOY_MOCK_BRIDGED_TOKENS must not be true");
  }
  if (env.DEPLOY_MOCK_XEF === "true") {
    throw new Error("Refusing mainnet run: DEPLOY_MOCK_XEF must not be true");
  }
  const hasXphereAdmin =
    hasAddress(env, "XPHERE_PROTOCOL_ADMIN_SAFE") ||
    hasAddress(env, "PROTOCOL_ADMIN_SAFE") ||
    isAddress(artifact?.contracts?.protocolAdminMultisig);
  const hasXphereTreasury =
    hasAddress(env, "XPHERE_TREASURY_SAFE") ||
    hasAddress(env, "TREASURY_SAFE") ||
    isAddress(artifact?.contracts?.treasuryMultisig);
  if (!hasXphereAdmin) {
    throw new Error("Refusing mainnet run: set XPHERE_PROTOCOL_ADMIN_SAFE or PROTOCOL_ADMIN_SAFE");
  }
  if (!hasXphereTreasury) {
    throw new Error("Refusing mainnet run: set XPHERE_TREASURY_SAFE or TREASURY_SAFE");
  }
  const xphereRpc = env.XPHERE_MAINNET_RPC_URL?.replace(/\/$/, "");
  if (!xphereRpc) {
    throw new Error("Refusing mainnet run: XPHERE_MAINNET_RPC_URL must be set to a dedicated endpoint");
  }
  if (PUBLIC_XPHERE_RPCS.has(xphereRpc)) {
    throw new Error("Refusing mainnet run: XPHERE_MAINNET_RPC_URL is a public dev RPC; use a dedicated endpoint");
  }
  if (env.VITE_XEF_OFFICIAL_VERIFIED === "true" && !env.XPHERE_XEF_TOKEN) {
    throw new Error("Refusing mainnet run: VITE_XEF_OFFICIAL_VERIFIED=true requires XPHERE_XEF_TOKEN");
  }
  if (swapMvp && !hasToken(env, artifact, "XPHERE_XEF_TOKEN", "VITE_XPHERE_XEF", "XEF")) {
    throw new Error("Refusing Xphere swap MVP: set XPHERE_XEF_TOKEN or VITE_XPHERE_XEF to the live XEF token address");
  }
  if (!swapMvp && !hasToken(env, artifact, "XPHERE_XUSDC_TOKEN", "VITE_XPHERE_XUSDC", "xUSDC")) {
    throw new Error("Refusing mainnet run: set XPHERE_XUSDC_TOKEN or record the Hyperlane USDC route before deploying the mainnet swap");
  }
  if (!swapMvp && !hasToken(env, artifact, "XPHERE_XUSDT_TOKEN", "VITE_XPHERE_XUSDT", "xUSDT")) {
    throw new Error("Refusing mainnet run: set XPHERE_XUSDT_TOKEN or record the Hyperlane USDT route before deploying the mainnet swap");
  }
  if (releaseMode && !hasToken(env, artifact, "XPHERE_XETH_TOKEN", "VITE_XPHERE_XETH", "xETH")) {
    throw new Error("Refusing release mode: deploy/record the ETH -> xETH Hyperlane route before public beta");
  }
  if (releaseMode && env.SEED_MAINNET_LIQUIDITY !== "true") {
    throw new Error("Refusing release mode: set SEED_MAINNET_LIQUIDITY=true after funding the liquidity wallet");
  }
  if (releaseMode && env.SEED_XETH_LIQUIDITY !== "true" && !hasFullBetaLiquidity(artifact)) {
    throw new Error("Refusing release mode: set SEED_XETH_LIQUIDITY=true and seed WXP/xETH liquidity for ETH-to-XP UX");
  }
}

function run(label, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`[${label}] pnpm ${args.join(" ")}`);
    const command = pnpmCommand(args);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const fileEnv = await readDotEnv();
  const env = { ...fileEnv, ...process.env };
  const existingArtifact = await readJsonIfExists("deployments/xphere-mainnet.local.json");
  assertMainnetIntent(env, existingArtifact);
  if (isSwapMvp(env)) {
    console.log("Running Xphere-only swap MVP path: bridge/stable routes are not required for this deploy.");
  }

  await run("env-doctor", ["env:doctor"], env);
  await run("preflight", ["preflight:xphere-mainnet"], env);
  if (hasSwapDeployment(existingArtifact) && env.FORCE_REDEPLOY_SWAP !== "true") {
    console.log("Existing Xphere mainnet swap deployment artifact found; skipping redeploy. Set FORCE_REDEPLOY_SWAP=true to override.");
  } else {
    await run("deploy-swap", ["deploy:swap:xphere-mainnet"], {
      ...env,
      DEPLOY_XPHERE_SWAP_MVP: isSwapMvp(env) ? "true" : env.DEPLOY_XPHERE_SWAP_MVP,
      DEPLOY_MOCK_BRIDGED_TOKENS: "false",
      DEPLOY_MOCK_XEF: "false",
    });
  }

  if (env.SEED_MAINNET_LIQUIDITY === "true") {
    await run("seed-liquidity", ["seed:liquidity:xphere-mainnet"], env);
  }

  const postDeployArtifact = await readJsonIfExists("deployments/xphere-mainnet.local.json");
  if (releaseMode && !hasFullBetaLiquidity(postDeployArtifact)) {
    throw new Error("Refusing release mode: WXP/xUSDC, WXP/xUSDT, xUSDC/xUSDT, and WXP/xETH liquidity must be recorded");
  }

  await run("verify", ["verify:xphere-mainnet"], {
    ...env,
    VERIFY_XPHERE_SWAP_MVP: isSwapMvp(env) ? "true" : env.VERIFY_XPHERE_SWAP_MVP,
    VERIFY_REQUIRE_LIQUIDITY: env.SEED_MAINNET_LIQUIDITY === "true" ? "true" : "false",
    VERIFY_REQUIRE_STABLES: isSwapMvp(env) ? "false" : env.VERIFY_REQUIRE_STABLES,
  });
  await run("sync-web-env", ["sync:web-env:xphere-mainnet"], env);
  await run("build-web", ["build:web"], env);
  if (isSwapMvp(env)) {
    console.log("Skipping bridge validation in Xphere swap MVP mode; bridge routes stay gated until Ethereum funding is available.");
  } else {
    await run("bridge-validate", ["bridge:validate"], env);
  }

  if (releaseMode) {
    await run("bridge-readiness", ["bridge:readiness"], env);
    console.log("Mainnet beta release gates passed.");
  } else {
    console.log("Xphere mainnet swap deployment pipeline completed. Run pnpm release:mainnet-beta after bridge artifacts and liquidity are ready.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
