import { spawn } from "node:child_process";
import { MAINNET_ACK, ROUTES, SECURITY_APPLY_ACK, readEnv } from "./bridge-config.mjs";

const executeLive = process.argv.includes("--execute-live");

function pnpmCommand(args) {
  if (process.platform === "win32") return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  return { command: "pnpm", args };
}

function run(label, args) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n== ${label}: pnpm ${args.join(" ")}`);
    const command = pnpmCommand(args);
    const child = spawn(command.command, command.args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${code ?? 1}`));
    });
  });
}

async function main() {
  if (!executeLive) {
    console.log("Bridge security apply dry run. No transaction was sent.");
    console.log("Required live sequence:");
    console.log("- pnpm bridge:render-security");
    for (const route of Object.values(ROUTES)) {
      console.log(`- pnpm bridge:hyperlane -- warp apply --id ${route.id} --yes`);
    }
    console.log("- pnpm bridge:sync-artifacts");
    console.log("- pnpm bridge:record-security <eth|usdc> --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...");
    return;
  }

  const env = await readEnv();
  if (env.MAINNET_BETA_ACK !== MAINNET_ACK) throw new Error(`MAINNET_BETA_ACK must equal ${MAINNET_ACK}`);
  if (env.BRIDGE_SECURITY_APPLY_ACK !== SECURITY_APPLY_ACK) {
    throw new Error(`BRIDGE_SECURITY_APPLY_ACK must equal ${SECURITY_APPLY_ACK}`);
  }
  await run("render final security configs", ["bridge:render-security"]);
  for (const route of Object.values(ROUTES)) {
    await run(`apply ${route.id} security`, ["bridge:hyperlane", "--", "warp", "apply", "--id", route.id, "--yes"]);
  }
  await run("sync route artifacts", ["bridge:sync-artifacts"]);
  console.log("\nSecurity apply transactions completed. Record and verify final ISM addresses before release.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
