import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const VERSION = "v22.23.1";

function nodeDir() {
  if (process.platform === "win32" && process.arch === "x64") {
    return resolve(ROOT, ".toolchain", `node-${VERSION}-win-x64`);
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return resolve(ROOT, ".toolchain", `node-${VERSION}-linux-x64`, "bin");
  }
  throw new Error(`Unsupported platform for supported Node runner: ${process.platform}/${process.arch}`);
}

function commandFor(argv) {
  if (argv.length === 0) {
    throw new Error("Usage: pnpm node:run22 -- <command> [args...]");
  }
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", ...argv] };
  }
  return { command: argv[0], args: argv.slice(1) };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();

  const binDir = nodeDir();
  const nodeExe = process.platform === "win32" ? resolve(binDir, "node.exe") : resolve(binDir, "node");
  if (!existsSync(nodeExe)) {
    throw new Error("Node 22 is not installed locally. Run `pnpm node:install22` first.");
  }

  const command = commandFor(argv);
  const separator = process.platform === "win32" ? ";" : ":";
  const env = {
    ...process.env,
    PATH: `${binDir}${separator}${process.env.PATH || ""}`,
    Path: `${binDir}${separator}${process.env.Path || process.env.PATH || ""}`,
  };

  const child = spawn(command.command, command.args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
