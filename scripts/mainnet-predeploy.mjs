import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const releaseMode = process.argv.includes("--release");
const ROOT = process.cwd();

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

function buildChecks(env) {
  const adminBootstrapPending =
    env.ALLOW_ETHEREUM_PROTOCOL_MULTISIG === "true" &&
    (!isAddress(env.PROTOCOL_ADMIN_SAFE) || !isAddress(env.TREASURY_SAFE));

  return [
  {
    label: "Node.js live deployment version",
    args: [releaseMode ? "node:check:live" : "node:check"],
    required: releaseMode,
  },
  {
    label: "Environment strict gate",
    args: ["env:doctor:strict"],
    required: true,
  },
  {
    label: "Operator status summary",
    args: ["mainnet:status"],
    required: false,
  },
  {
    label: "Xphere live read-only probe",
    args: ["mainnet:probe"],
    required: true,
  },
  {
    label: "Deployer funding probe",
    args: ["mainnet:funding"],
    required: true,
  },
  {
    label: "Hyperlane registry prep",
    args: ["bridge:prepare-registry"],
    required: true,
  },
  {
    label: "Hyperlane Warp Route render",
    args: ["bridge:render-routes"],
    required: !adminBootstrapPending,
  },
  {
    label: "Bridge config/artifact validation",
    args: ["bridge:validate"],
    required: true,
  },
  {
    label: "Bridge cap config check",
    args: ["bridge:caps"],
    required: true,
  },
  ...(releaseMode
    ? [
        {
      label: "Public beta readiness gate",
      args: ["bridge:readiness"],
      required: true,
    },
    {
      label: "Bridge cap release gate",
      args: ["bridge:caps:release"],
      required: true,
    },
      ]
    : []),
  ];
}

function pnpmCommand(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

function run(label, args) {
  return new Promise((resolve) => {
    const command = pnpmCommand(args);
    console.log("");
    console.log(`== ${label}: pnpm ${args.join(" ")}`);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const env = await readEnv();
  const checks = buildChecks(env);
  const results = [];
  for (const check of checks) {
    const code = await run(check.label, check.args);
    results.push({ ...check, code });
  }

  console.log("");
  console.log("Mainnet predeploy summary:");
  for (const result of results) {
    const status = result.code === 0 ? "OK" : result.required ? "FAIL" : "WARN";
    console.log(`[${status}] ${result.label} (${result.args.join(" ")})`);
  }

  const failed = results.filter((result) => result.required && result.code !== 0);
  if (failed.length > 0) {
    console.log("");
    console.log("Predeploy gate is not ready. Fix the failing required checks before any live transaction.");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Predeploy gate passed. It is safe to proceed to the first live deployment command.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
