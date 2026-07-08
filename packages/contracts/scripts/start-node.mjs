import { spawn } from "node:child_process";

const [, , port = "8545", chainId = "31337"] = process.argv;
const command =
  process.platform === "win32"
    ? { bin: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", "exec", "hardhat", "node", "--hostname", "127.0.0.1", "--port", port] }
    : { bin: "pnpm", args: ["exec", "hardhat", "node", "--hostname", "127.0.0.1", "--port", port] };

const child = spawn(
  command.bin,
  command.args,
  {
    env: { ...process.env, HARDHAT_CHAIN_ID: chainId },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
