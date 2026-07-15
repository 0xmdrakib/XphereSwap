import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import YAML from "yaml";
import {
  CHAINS,
  OPS_DIR,
  REGISTRY_DIR,
  ROUTES,
  WINDOWS_REGISTRY_DIR,
  isAddress,
  normalizedRouteRecord,
  readArtifact,
  readEnv,
  writeArtifact,
} from "./bridge-config.mjs";

async function readStructured(path) {
  const raw = await readFile(path, "utf8");
  return extname(path).toLowerCase() === ".json" ? JSON.parse(raw) : YAML.parse(raw);
}

async function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(json|ya?ml)$/i.test(entry.name)) files.push(path);
    }
  }
  await walk(root);
  return files;
}

function normalize(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function flatten(value, path = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, [...path, String(index)]));
  const rows = [];
  for (const [key, child] of Object.entries(value)) {
    const next = [...path, key];
    if (isAddress(child)) rows.push({ path: next, value: child });
    rows.push(...flatten(child, next));
  }
  return rows;
}

function uniquePick(rows, includes, excludes = []) {
  const matches = rows.filter((row) => {
    const path = normalize(row.path.join("."));
    return includes.some((value) => path.includes(normalize(value))) &&
      !excludes.some((value) => path.includes(normalize(value)));
  });
  const unique = Array.from(new Set(matches.map((row) => row.value)));
  return unique.length === 1 ? unique[0] : undefined;
}

function chainRows(data, chainName) {
  return flatten(data).filter((row) => row.path.some((part) => normalize(part) === normalize(chainName)));
}

function addressesFromData(data) {
  const result = {};
  for (const chainName of Object.keys(CHAINS)) {
    const rows = chainRows(data, chainName);
    result[chainName] = {
      router: uniquePick(rows, ["router"], ["remoteRouter"]),
      token: chainName === "xphere"
        ? uniquePick(rows, ["syntheticToken", "tokenAddress", "addressOrDenom", "token"], ["router"])
        : undefined,
      ism: uniquePick(rows, ["interchainSecurityModule", "deployedIsm", "ism"], ["factory"]),
    };
  }
  return result;
}

async function syncCore() {
  const roots = [REGISTRY_DIR];
  if (process.platform === "win32") roots.push(WINDOWS_REGISTRY_DIR);
  for (const chainName of Object.keys(CHAINS)) {
    const artifact = await readArtifact(chainName);
    artifact.contracts ||= {};
    for (const root of roots) {
      const path = resolve(root, "chains", chainName, "addresses.yaml");
      if (!existsSync(path)) continue;
      const data = await readStructured(path);
      const mailbox = data.mailbox;
      if (isAddress(mailbox)) artifact.contracts.hyperlaneMailbox = mailbox;
      if (chainName === "xphere") {
        const mapping = {
          interchainGasPaymaster: "hyperlaneInterchainGasPaymaster",
          validatorAnnounce: "hyperlaneValidatorAnnounce",
          interchainSecurityModule: "hyperlaneInterchainSecurityModule",
          proxyAdmin: "hyperlaneProxyAdmin",
        };
        for (const [source, target] of Object.entries(mapping)) {
          if (isAddress(data[source])) artifact.contracts[target] = data[source];
        }
      }
    }
    await writeArtifact(chainName, artifact);
  }
}

async function syncRoute(routeKey, env) {
  const route = ROUTES[routeKey];
  const roots = [
    resolve(REGISTRY_DIR, "deployments", "warp_routes", route.registryAsset),
    resolve(WINDOWS_REGISTRY_DIR, "deployments", "warp_routes", route.registryAsset),
  ];
  const files = (await Promise.all(roots.map(listFiles))).flat();
  const found = {};
  for (const file of files) {
    const next = addressesFromData(await readStructured(file));
    for (const chainName of Object.keys(CHAINS)) {
      found[chainName] = { ...(found[chainName] || {}), ...Object.fromEntries(
        Object.entries(next[chainName]).filter(([, value]) => isAddress(value)),
      ) };
    }
  }
  if (!Object.keys(CHAINS).every((chainName) => isAddress(found[chainName]?.router))) return false;
  const xphereToken = found.xphere?.token;
  if (!isAddress(xphereToken)) return false;

  const routers = Object.fromEntries(Object.keys(CHAINS).map((chainName) => [chainName, found[chainName].router]));
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    const artifact = await readArtifact(chainName);
    artifact.contracts ||= {};
    artifact.tokens ||= {};
    artifact.bridgeRoutes ||= {};
    artifact.contracts[routeKey === "eth" ? "nativeWarpRouter" : "usdcWarpRouter"] = routers[chainName];
    if (chainName === "xphere") artifact.tokens[route.xphereTokenKey] = xphereToken;
    if (chainName !== "xphere" && routeKey === "usdc") artifact.tokens.USDC = route.tokenForChain[chainName];
    const mailbox = artifact.contracts.hyperlaneMailbox || env[chain.mailboxEnv];
    const existing = artifact.bridgeRoutes[routeKey];
    artifact.bridgeRoutes[routeKey] = normalizedRouteRecord({
      chainName,
      routeKey,
      mailbox,
      router: routers[chainName],
      token: chainName === "xphere" ? xphereToken : route.tokenForChain[chainName],
      ism: found[chainName]?.ism || existing?.interchainSecurityModule,
      owner: env[chain.ownerEnv] || existing?.owner,
      remoteRouters: Object.fromEntries(Object.entries(routers).filter(([name]) => name !== chainName)),
      securityApplied: existing?.securityApplied === true,
    });
    await writeArtifact(chainName, artifact);
  }
  console.log(`Synced ${route.id} route artifacts.`);
  return true;
}

async function main() {
  const env = await readEnv();
  await syncCore();
  let routes = 0;
  for (const routeKey of Object.keys(ROUTES)) {
    if (await syncRoute(routeKey, env)) routes += 1;
  }
  if (routes === 0) console.log("No complete three-chain Warp Route artifacts found to sync.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
