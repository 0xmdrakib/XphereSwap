import { spawn } from "node:child_process";

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

function run(label, args, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[${label}] pnpm ${args.join(" ")}`);
    const command = pnpmCommand(args);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  await run("preflight", ["preflight:xphere-testnet"]);
  await run("deploy", ["deploy:swap:xphere-testnet"], {
    DEPLOY_MOCK_BRIDGED_TOKENS: "true",
    DEPLOY_MOCK_XEF: "true",
  });
  await run("seed-liquidity", ["seed:liquidity:xphere-testnet"], {
    LIQUIDITY_MINT_MOCKS: "true",
    SEED_XEF_LIQUIDITY: "true",
  });
  await run("verify", ["verify:xphere-testnet"], { VERIFY_REQUIRE_LIQUIDITY: "true" });
  await run("sync-web-env", ["sync:web-env:xphere-testnet"]);
  await run("build-web", ["build:web"]);
  console.log("Xphere testnet swap deployment pipeline completed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
