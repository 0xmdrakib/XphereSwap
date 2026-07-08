import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = process.cwd();
const EXECUTE_LIVE = process.argv.includes("--execute-live");
const RELEASE = process.argv.includes("--release");

const CORE_KEYS = [
  "hyperlaneMailbox",
  "hyperlaneInterchainGasPaymaster",
  "hyperlaneValidatorAnnounce",
  "hyperlaneInterchainSecurityModule",
];

const ROUTES = [
  {
    name: "USDC",
    id: "USDC/ethereum-xphere",
    routeArg: "usdc",
    ethRouterKey: "usdcWarpRouter",
    xphereRouterKey: "usdcWarpRouter",
    xphereTokenKey: "xUSDC",
    recordExample:
      "pnpm bridge:record-route usdc --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...",
  },
  {
    name: "USDT",
    id: "USDT/ethereum-xphere",
    routeArg: "usdt",
    ethRouterKey: "usdtWarpRouter",
    xphereRouterKey: "usdtWarpRouter",
    xphereTokenKey: "xUSDT",
    recordExample:
      "pnpm bridge:record-route usdt --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x...",
  },
  {
    name: "ETH/xETH",
    id: "ETH/ethereum-xphere",
    routeArg: "native",
    ethRouterKey: "nativeWarpRouter",
    xphereRouterKey: "nativeWarpRouter",
    xphereTokenKey: "xETH",
    recordExample:
      "pnpm bridge:record-route native --ethereum-router 0x... --xphere-router 0x... --xphere-token 0xXethToken",
  },
];

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

function isAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) &&
    normalized !== "0x0000000000000000000000000000000000000000";
}

async function readJsonIfExists(relativePath) {
  const path = resolve(ROOT, relativePath);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}

function run(label, args) {
  return new Promise((resolvePromise, reject) => {
    console.log("");
    console.log(`== ${label}: pnpm ${args.join(" ")}`);
    const command = pnpmCommand(args);
    const child = spawn(command.command, command.args, {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${code ?? 1}`));
    });
  });
}

function hasCore(xphere) {
  return CORE_KEYS.every((key) => isAddress(xphere?.contracts?.[key]));
}

function hasSwap(xphere) {
  return (
    isAddress(xphere?.contracts?.wXP) &&
    isAddress(xphere?.contracts?.factory) &&
    isAddress(xphere?.contracts?.router) &&
    isAddress(xphere?.contracts?.multicall3)
  );
}

function hasRoute(route, ethereum, xphere) {
  return (
    isAddress(ethereum?.contracts?.[route.ethRouterKey]) &&
    isAddress(xphere?.contracts?.[route.xphereRouterKey]) &&
    isAddress(xphere?.tokens?.[route.xphereTokenKey])
  );
}

function liquidityReady(xphere) {
  const seeded = xphere?.bridgeRoutes?.seededLiquidity;
  return Boolean(
    seeded &&
      isAddress(xphere?.contracts?.wXPxUSDCPair) &&
      isAddress(xphere?.contracts?.wXPxUSDTPair) &&
      isAddress(xphere?.contracts?.xUSDCxUSDTPair) &&
      isAddress(xphere?.contracts?.wXPxETHPair),
  );
}

function printManualStop(title, lines) {
  console.log("");
  console.log(title);
  for (const line of lines) console.log(`- ${line}`);
}

async function loadArtifacts() {
  return {
    xphere: await readJsonIfExists("deployments/xphere-mainnet.local.json"),
    ethereum: await readJsonIfExists("deployments/ethereum-mainnet.local.json"),
  };
}

async function main() {
  console.log("Xphere mainnet orchestrator");
  console.log(EXECUTE_LIVE ? "Mode: LIVE TRANSACTION EXECUTION" : "Mode: readiness/dry run");

  await run("mainnet input checklist", ["mainnet:inputs"]);
  if (EXECUTE_LIVE) {
    await run("Node.js live deployment version", ["node:check:live"]);
    await run("deployer funding probe", ["mainnet:funding"]);
    await run("mainnet admin bootstrap", ["mainnet:bootstrap-admins"]);
  }
  await run("mainnet predeploy gate", RELEASE ? ["mainnet:predeploy:release"] : ["mainnet:predeploy"]);

  let { xphere, ethereum } = await loadArtifacts();

  if (!EXECUTE_LIVE) {
    printManualStop("Dry run complete. Nothing live was sent.", [
      "Run `pnpm mainnet:orchestrate --execute-live` only from a funded deployer with real RPCs and Safe/validator addresses in `.env`.",
      "Run `pnpm mainnet:orchestrate --execute-live --release` only after route ownership, relayer, validators, liquidity, and emergency controls are ready.",
    ]);
    return;
  }

  if (!hasCore(xphere)) {
    await run("deploy Xphere Hyperlane core", ["bridge:core:deploy"]);
    await run("sync Hyperlane artifacts", ["bridge:sync-artifacts"]);
    ({ xphere, ethereum } = await loadArtifacts());
    if (!hasCore(xphere)) {
      printManualStop("Hyperlane core deploy finished, but core addresses are not recorded yet.", [
        "Copy the Mailbox, InterchainGasPaymaster, ValidatorAnnounce, and ISM addresses from the Hyperlane output.",
        "Record them with `pnpm bridge:record-core --mailbox 0x... --interchain-gas-paymaster 0x... --validator-announce 0x... --interchain-security-module 0x...`.",
        "Then run `pnpm mainnet:orchestrate --execute-live` again.",
      ]);
      return;
    }
  }

  await run("prepare Hyperlane registry", ["bridge:prepare-registry"]);
  await run("render Warp Routes", ["bridge:render-routes"]);

  for (const route of ROUTES) {
    ({ xphere, ethereum } = await loadArtifacts());
    if (hasRoute(route, ethereum, xphere)) continue;

    await run(`deploy ${route.name} Warp Route`, ["bridge:hyperlane", "--", "warp", "deploy", "--id", route.id]);
    await run("sync Hyperlane artifacts", ["bridge:sync-artifacts"]);
    ({ xphere, ethereum } = await loadArtifacts());
    if (!hasRoute(route, ethereum, xphere)) {
      printManualStop(`${route.name} Warp Route deploy finished, but route addresses are not recorded yet.`, [
        "Copy the Ethereum router, Xphere router, and Xphere synthetic token from the Hyperlane output.",
        `Record it with \`${route.recordExample}\`.`,
        "Then run `pnpm mainnet:orchestrate --execute-live` again.",
      ]);
      return;
    }
  }

  ({ xphere } = await loadArtifacts());
  if (!hasSwap(xphere)) {
    await run("deploy Xphere swap", ["deploy:xphere-mainnet"]);
  } else {
    console.log("");
    console.log("Swap deployment artifact already exists; skipping WXP/factory/router deployment.");
  }

  ({ xphere } = await loadArtifacts());
  if (!liquidityReady(xphere)) {
    printManualStop("Swap is deployed, but full mainnet UX still needs liquidity.", [
      "Fund the deployer with XP, xUSDC, xUSDT, and xETH.",
      "Set `SEED_MAINNET_LIQUIDITY=true`, `SEED_XETH_LIQUIDITY=true`, and `LIQUIDITY_MAINNET_ACK=I_UNDERSTAND_LIQUIDITY_SEEDING`.",
      "Run `pnpm deploy:xphere-mainnet` again to seed WXP/xUSDC, WXP/xUSDT, xUSDC/xUSDT, and WXP/xETH.",
    ]);
    return;
  }

  await run("sync web env", ["sync:web-env:xphere-mainnet"]);
  await run("build web", ["build:web"]);

  if (RELEASE) {
    await run("public beta release", ["release:mainnet-beta"]);
  } else {
    await run("release gate preview", ["mainnet:predeploy:release"]);
  }

  console.log("");
  console.log("Mainnet orchestration complete.");
}

main().catch((error) => {
  console.error("");
  console.error(error.message);
  process.exitCode = 1;
});
