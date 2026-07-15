import { spawn } from "node:child_process";
import {
  ROUTES,
  isAddress,
  readArtifact,
  routeComplete,
} from "../ops/hyperlane/scripts/bridge-config.mjs";

const ROOT = process.cwd();
const EXECUTE_LIVE = process.argv.includes("--execute-live");
const RELEASE = process.argv.includes("--release");
const CORE_KEYS = [
  "hyperlaneMailbox",
  "hyperlaneInterchainGasPaymaster",
  "hyperlaneValidatorAnnounce",
  "hyperlaneInterchainSecurityModule",
];

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
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

function printManualStop(title, lines) {
  console.log("");
  console.log(title);
  for (const line of lines) console.log(`- ${line}`);
}

async function loadArtifacts() {
  return {
    base: await readArtifact("base"),
    ethereum: await readArtifact("ethereum"),
    xphere: await readArtifact("xphere"),
  };
}

function hasXphereCore(artifacts) {
  return CORE_KEYS.every((key) => isAddress(artifacts.xphere?.contracts?.[key]));
}

function routeRecorded(artifacts, routeKey, requireSecurity = false) {
  return Object.keys(artifacts).every((chainName) =>
    routeComplete(artifacts[chainName], routeKey, chainName, { requireSecurity }),
  );
}

function recordRouteExample(routeKey) {
  return [
    `pnpm bridge:record-route ${routeKey}`,
    "--base-router 0x... --ethereum-router 0x... --xphere-router 0x...",
    "--xphere-token 0x...",
    "--base-mailbox 0x... --ethereum-mailbox 0x... --xphere-mailbox 0x...",
    "--base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...",
  ].join(" ");
}

async function dryRun() {
  console.log("Mode: non-live bridge completion gate");
  await run("bridge config and artifact validation", ["bridge:validate"]);
  await run("bridge cap configuration", ["bridge:caps"]);
  await run("security apply command preview", ["bridge:apply-security"]);
  await run("web preview build", ["build:web"]);
  printManualStop("Non-live orchestration gate passed. No transaction was sent.", [
    "The Bridge UI remains locked unless VITE_BRIDGE_RELEASED=true and every route address is configured.",
    "Use `pnpm mainnet:orchestrate:live:node22` only after team review, operator funding, and Safe/validator setup.",
    "Use the release command only after phase-two security, delivery drills, monitoring, and emergency-pause approval.",
  ]);
}

async function liveRun() {
  console.log(RELEASE ? "Mode: LIVE bridge release checks" : "Mode: LIVE bridge deployment");
  await run("Node.js live deployment version", ["node:check:live"]);
  await run("mainnet input checklist", ["mainnet:inputs:strict"]);
  await run("deployer funding probe", ["mainnet:funding"]);
  await run("mainnet admin validation", ["mainnet:bootstrap-admins"]);
  await run("mainnet predeploy gate", ["mainnet:predeploy"]);

  let artifacts = await loadArtifacts();
  if (!hasXphereCore(artifacts)) {
    await run("deploy Xphere Hyperlane core", ["bridge:core:deploy"]);
    await run("sync Hyperlane artifacts", ["bridge:sync-artifacts"]);
    artifacts = await loadArtifacts();
    if (!hasXphereCore(artifacts)) {
      printManualStop("Xphere Hyperlane core deployment needs address recording.", [
        "Record Mailbox, InterchainGasPaymaster, ValidatorAnnounce, and default ISM with `pnpm bridge:record-core ...`.",
        "Run the live orchestrator again after verifying the recorded contracts on the explorer.",
      ]);
      return;
    }
  }

  await run("prepare Hyperlane registry", ["bridge:prepare-registry"]);
  await run("render phase-one Warp Routes", ["bridge:render-routes"]);

  for (const [routeKey, route] of Object.entries(ROUTES)) {
    artifacts = await loadArtifacts();
    if (routeRecorded(artifacts, routeKey)) continue;

    await run(`deploy ${route.id}`, ["bridge:hyperlane", "--", "warp", "deploy", "--id", route.id]);
    await run("sync Hyperlane artifacts", ["bridge:sync-artifacts"]);
    artifacts = await loadArtifacts();
    if (!routeRecorded(artifacts, routeKey)) {
      printManualStop(`${route.id} deployment needs normalized address recording.`, [
        "Copy all three routers, Mailboxes, phase-one ISMs, and the Xphere synthetic token from the reviewed deployment output.",
        `Record them with \`${recordRouteExample(routeKey)}\`.`,
        "Verify every address before running the live orchestrator again.",
      ]);
      return;
    }
  }

  const securityComplete = Object.keys(ROUTES).every((routeKey) =>
    routeRecorded(artifacts, routeKey, true),
  );
  if (!securityComplete) {
    await run("apply phase-two bridge security", ["bridge:apply-security:live"]);
    artifacts = await loadArtifacts();
    const unrecorded = Object.keys(ROUTES).filter(
      (routeKey) => !routeRecorded(artifacts, routeKey, true),
    );
    if (unrecorded.length > 0) {
      printManualStop("Phase-two security was applied but final ISM addresses still need recording.", [
        ...unrecorded.map(
          (routeKey) =>
            `Run \`pnpm bridge:record-security ${routeKey} --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...\`.`,
        ),
        "Verify the 3-of-3 aggregation and pause/rate-limit ownership before continuing.",
      ]);
      return;
    }
  }

  await run("sync web environment", ["sync:web-env:xphere-mainnet"]);
  await run("build web preview", ["build:web"]);

  if (RELEASE) {
    await run("bridge release gate", ["release:mainnet-beta"]);
  } else {
    printManualStop("Bridge deployment workflow is recorded, but public release remains locked.", [
      "Keep VITE_BRIDGE_RELEASED=false until all eight low-value delivery tests and the emergency-pause drill pass.",
      "The existing Xphere swap and liquidity deployment were not changed by this bridge workflow.",
    ]);
  }
}

async function main() {
  console.log("XphereSwap mainnet bridge orchestrator");
  if (EXECUTE_LIVE) await liveRun();
  else await dryRun();
}

main().catch((error) => {
  console.error("");
  console.error(error.message);
  process.exitCode = 1;
});
