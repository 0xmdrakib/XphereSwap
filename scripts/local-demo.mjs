import { spawn } from "node:child_process";
import { once } from "node:events";

const children = [];

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

function log(label, message) {
  process.stdout.write(`[${label}] ${message}`);
}

function spawnCommand(label, args, options = {}) {
  const command = pnpmCommand(args);
  const child = spawn(command.command, command.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk) => log(label, chunk.toString()));
  child.stderr.on("data", (chunk) => log(label, chunk.toString()));
  return child;
}

async function runCommand(label, args) {
  const child = spawnCommand(label, args);
  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`${label} failed with exit code ${code}`);
  }
}

async function waitForRpc(label, url, expectedChainIdHex) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      });
      const data = await response.json();
      if (data.result === expectedChainIdHex) {
        console.log(`[${label}] ready (${data.result})`);
        return;
      }
    } catch {
      // Keep polling until the node is ready or the deadline passes.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function stopChildren() {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

async function main() {
  console.log("Starting local Xphere + Ethereum demo...");
  spawnCommand("xphere", ["node:localhost"]);
  spawnCommand("ethereum", ["node:local-ethereum"]);

  await Promise.all([
    waitForRpc("xphere", "http://127.0.0.1:8545", "0x7a69"),
    waitForRpc("ethereum", "http://127.0.0.1:8546", "0x7a6a"),
  ]);

  await runCommand("deploy-swap", ["deploy:swap:localhost"]);
  await runCommand("deploy-bridge-eth", ["deploy:bridge:local-ethereum"]);
  await runCommand("deploy-bridge-xp", ["deploy:bridge:localhost"]);
  await runCommand("preflight-xphere", ["preflight:localhost"]);
  await runCommand("preflight-ethereum", ["preflight:local-ethereum"]);
  await runCommand("verify-xphere", ["verify:localhost"]);
  await runCommand("verify-ethereum", ["verify:local-ethereum"]);
  await runCommand("validate-artifacts", ["bridge:validate"]);
  await runCommand("smoke-swap", ["smoke:local-swap"]);
  await runCommand("smoke-bridge", ["smoke:local-bridge"]);

  spawnCommand("relayer", ["relay:local-bridge"]);
  spawnCommand("web", ["dev:web"]);

  console.log("Local demo is running at http://127.0.0.1:5173/");
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error);
  stopChildren();
  process.exitCode = 1;
});
