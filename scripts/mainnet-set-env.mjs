import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = process.cwd();
const envPath = resolve(ROOT, ".env");
const examplePath = resolve(ROOT, ".env.example");

function usage() {
  console.error(`Usage:
pnpm mainnet:set KEY=value [KEY=value ...]
pnpm mainnet:set --file path/to/operator-values.local.json

The file form accepts a JSON object: { "KEY": "value" }.
Only keys already present in .env.example are accepted.`);
}

function parseEnv(raw) {
  const entries = [];
  const values = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      const entry = { kind: "kv", key: match[1], value: match[2] };
      entries.push(entry);
      values.set(entry.key, entry);
    } else {
      entries.push({ kind: "raw", value: line });
    }
  }
  return { entries, values };
}

function stringifyEnv(parsed) {
  return `${parsed.entries
    .map((entry) => (entry.kind === "kv" ? `${entry.key}=${entry.value}` : entry.value))
    .join("\n")
    .replace(/\n*$/, "")}\n`;
}

function quoteValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/[\s#"'`]/.test(text)) return JSON.stringify(text);
  return text;
}

function redacted(key, value) {
  if (!value) return "<empty>";
  if (key.includes("PRIVATE") || key.includes("KEY") || key.includes("RPC_URL")) return "<set>";
  return value;
}

async function readAllowedKeys() {
  const raw = await readFile(examplePath, "utf8");
  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter(Boolean),
  );
}

async function readUpdates(argv) {
  if (argv[0] === "--file") {
    const file = argv[1];
    if (!file) throw new Error("--file requires a JSON file path");
    const parsed = JSON.parse(await readFile(resolve(ROOT, file), "utf8"));
    return Object.entries(parsed);
  }

  return argv.map((item) => {
    const index = item.indexOf("=");
    if (index <= 0) throw new Error(`Expected KEY=value, got ${item}`);
    return [item.slice(0, index), item.slice(index + 1)];
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help")) {
    usage();
    process.exitCode = argv.includes("--help") ? 0 : 1;
    return;
  }

  if (!existsSync(envPath)) {
    await copyFile(examplePath, envPath);
    console.log("Created .env from .env.example.");
  }

  const allowed = await readAllowedKeys();
  const updates = await readUpdates(argv);
  const updateKeys = new Set(updates.map(([key]) => key));
  if (updateKeys.has("XPHERE_MAINNET_RPC_URL") && !updateKeys.has("VITE_XPHERE_MAINNET_RPC_URL")) {
    updates.push(["VITE_XPHERE_MAINNET_RPC_URL", updates.find(([key]) => key === "XPHERE_MAINNET_RPC_URL")?.[1] ?? ""]);
  }
  if (updateKeys.has("XPHERE_TESTNET_RPC_URL") && !updateKeys.has("VITE_XPHERE_TESTNET_RPC_URL")) {
    updates.push(["VITE_XPHERE_TESTNET_RPC_URL", updates.find(([key]) => key === "XPHERE_TESTNET_RPC_URL")?.[1] ?? ""]);
  }
  const unknown = updates.map(([key]) => key).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Unknown .env key(s): ${unknown.join(", ")}`);

  const raw = await readFile(envPath, "utf8");
  const parsed = parseEnv(raw);
  const added = [];
  const changed = [];

  for (const [key, rawValue] of updates) {
    const value = quoteValue(rawValue);
    const existing = parsed.values.get(key);
    if (existing) {
      existing.value = value;
      changed.push([key, value]);
    } else {
      const entry = { kind: "kv", key, value };
      parsed.entries.push(entry);
      parsed.values.set(key, entry);
      added.push([key, value]);
    }
  }

  await writeFile(envPath, stringifyEnv(parsed));
  for (const [key, value] of changed) console.log(`Updated ${key}=${redacted(key, value)}`);
  for (const [key, value] of added) console.log(`Added ${key}=${redacted(key, value)}`);
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
