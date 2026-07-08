import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "../../..");
const repoRegistryDir = resolve(scriptDir, "../.registry");
const windowsRegistryDir = "C:\\tmp\\xphere-hyperlane-registry";
const registryDir = process.platform === "win32" ? windowsRegistryDir : repoRegistryDir;
const npmCacheDir = "C:\\tmp\\npm-cache";

async function readEnv() {
  const env = { ...process.env };
  const envPath = resolve(repoDir, ".env");
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

function commandFor(args) {
  const fullArgs = [
    "npx",
    "-y",
    "@hyperlane-xyz/cli",
    ...args,
    "--registry",
    "https://github.com/hyperlane-xyz/hyperlane-registry",
    "--registry",
    registryDir,
  ];

  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", ...fullArgs] };
  }
  return { command: "npx", args: fullArgs.slice(1) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (args.length === 0) {
    console.error("Usage: pnpm bridge:hyperlane -- <hyperlane-cli-args>");
    console.error("Example: pnpm bridge:hyperlane -- registry list --type mainnet");
    process.exitCode = 1;
    return;
  }

  await mkdir(resolve(scriptDir, "../generated"), { recursive: true });
  if (process.platform === "win32") await mkdir(npmCacheDir, { recursive: true });

  const env = await readEnv();
  const childEnv = {
    ...process.env,
    ...env,
  };
  const signerKey = env.HYP_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (signerKey) childEnv.HYP_KEY = signerKey;
  else delete childEnv.HYP_KEY;
  if (process.platform === "win32") {
    childEnv.npm_config_cache = env.npm_config_cache || npmCacheDir;
  }

  const command = commandFor(args);
  const output = [];
  const child = spawn(command.command, command.args, {
    cwd: repoDir,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output.push(chunk);
    process.stderr.write(chunk);
  });

  child.on("exit", async (code) => {
    await writeFile(resolve(scriptDir, "../generated/hyperlane-last.log"), Buffer.concat(output));
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
