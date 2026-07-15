import {
  CHAINS,
  ROUTES,
  isAddress,
  normalizedRouteRecord,
  readArtifact,
  readEnv,
  writeArtifact,
} from "./bridge-config.mjs";

function usage() {
  console.error(`Usage:
pnpm bridge:record-route <eth|usdc> \\
  --base-router 0x... --ethereum-router 0x... --xphere-router 0x... --xphere-token 0x... \\
  --base-mailbox 0x... --ethereum-mailbox 0x... --xphere-mailbox 0x... \\
  --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...`);
}

function parseArgs(argv) {
  const [routeKey, ...rest] = argv;
  const options = { routeKey };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

function requiredAddress(value, label) {
  if (!isAddress(value)) throw new Error(`${label} must be a non-zero EVM address`);
  return value;
}

async function main() {
  const env = await readEnv();
  const options = parseArgs(process.argv.slice(2));
  const route = ROUTES[options.routeKey];
  if (!route) throw new Error("Route must be eth or usdc");

  const routers = {};
  const mailboxes = {};
  const isms = {};
  const owners = {};
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    routers[chainName] = requiredAddress(options[`${chainName}-router`], `--${chainName}-router`);
    mailboxes[chainName] = requiredAddress(
      options[`${chainName}-mailbox`] || env[chain.mailboxEnv],
      `--${chainName}-mailbox or ${chain.mailboxEnv}`,
    );
    isms[chainName] = requiredAddress(options[`${chainName}-ism`], `--${chainName}-ism`);
    owners[chainName] = requiredAddress(env[chain.ownerEnv], chain.ownerEnv);
  }
  const xphereToken = requiredAddress(options["xphere-token"], "--xphere-token");

  for (const chainName of Object.keys(CHAINS)) {
    const artifact = await readArtifact(chainName);
    artifact.contracts ||= {};
    artifact.tokens ||= {};
    artifact.bridgeRoutes ||= {};
    artifact.contracts.hyperlaneMailbox = mailboxes[chainName];
    artifact.contracts[options.routeKey === "eth" ? "nativeWarpRouter" : "usdcWarpRouter"] = routers[chainName];
    if (chainName === "xphere") artifact.tokens[route.xphereTokenKey] = xphereToken;
    if (chainName === "base" || chainName === "ethereum") artifact.tokens.USDC ||= route.tokenForChain[chainName];

    const remoteRouters = Object.fromEntries(
      Object.entries(routers).filter(([remoteName]) => remoteName !== chainName),
    );
    artifact.bridgeRoutes[options.routeKey] = normalizedRouteRecord({
      chainName,
      routeKey: options.routeKey,
      mailbox: mailboxes[chainName],
      router: routers[chainName],
      token: chainName === "xphere" ? xphereToken : route.tokenForChain[chainName],
      ism: isms[chainName],
      owner: owners[chainName],
      remoteRouters,
      securityApplied: false,
    });
    await writeArtifact(chainName, artifact);
  }

  console.log(`Recorded phase-one ${route.id} route across Base, Ethereum, and Xphere.`);
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
