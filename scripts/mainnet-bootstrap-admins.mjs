import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = process.cwd();
const MAINNET_ACK = "I_UNDERSTAND_MAINNET_BETA";

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

function isAddress(value) {
  return (
    /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) &&
    String(value).toLowerCase() !== "0x0000000000000000000000000000000000000000"
  );
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

async function main() {
  let env = await readEnv();
  if (env.MAINNET_BETA_ACK !== MAINNET_ACK) {
    throw new Error(`MAINNET_BETA_ACK must equal ${MAINNET_ACK}`);
  }

  if (!isAddress(env.PROTOCOL_ADMIN_SAFE) || !isAddress(env.TREASURY_SAFE)) {
    if (env.ALLOW_ETHEREUM_PROTOCOL_MULTISIG !== "true") {
      throw new Error(
        "PROTOCOL_ADMIN_SAFE/TREASURY_SAFE are missing. Set existing Safe addresses or ALLOW_ETHEREUM_PROTOCOL_MULTISIG=true.",
      );
    }
    await run("deploy Ethereum admin multisigs", ["deploy:admin:ethereum-mainnet"]);
    await run("apply Ethereum admin multisigs", [
      "mainnet:set",
      "--file",
      "docs/operator-values.ethereum-admin.generated.local.json",
    ]);
    env = await readEnv();
  } else {
    console.log("Ethereum admin and treasury addresses already set; skipping Ethereum admin bootstrap.");
  }

  if (!isAddress(env.XPHERE_PROTOCOL_ADMIN_SAFE) || !isAddress(env.XPHERE_TREASURY_SAFE)) {
    await run("deploy Xphere admin multisigs", ["deploy:admin:xphere-mainnet"]);
    await run("apply Xphere admin multisigs", [
      "mainnet:set",
      "--file",
      "docs/operator-values.xphere-admin.generated.local.json",
    ]);
  } else {
    console.log("Xphere admin and treasury addresses already set; skipping Xphere admin bootstrap.");
  }

  console.log("");
  console.log("Mainnet admin bootstrap complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
