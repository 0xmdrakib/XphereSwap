import { spawn } from "node:child_process";
import { readEnv } from "../ops/hyperlane/scripts/bridge-config.mjs";

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

function run(label, args) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n== ${label}: pnpm ${args.join(" ")}`);
    const command = pnpmCommand(args);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${code ?? 1}`));
    });
  });
}

async function main() {
  const env = await readEnv();
  if (env.VITE_BRIDGE_RELEASED !== "true") {
    throw new Error("VITE_BRIDGE_RELEASED must equal true only after team approval and all bridge release drills");
  }

  console.log("XphereSwap bridge release verification");
  console.log("This command verifies release state and builds the frontend. It sends no on-chain transaction.");
  await run("Node.js release version", ["node:check:live"]);
  await run("bridge configuration", ["bridge:validate"]);
  await run("bridge readiness", ["bridge:readiness"]);
  await run("bridge collateral caps", ["bridge:caps:release"]);
  await run("sync public frontend config", ["sync:web-env:xphere-mainnet"]);
  await run("build released frontend", ["build:web"]);
  console.log("\nBridge release checks passed. Frontend publication remains an explicit operator action.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
