import { CHAINS, ROUTES, isAddress, readArtifact, writeArtifact } from "./bridge-config.mjs";

function usage() {
  console.error(`Usage:
pnpm bridge:record-security <eth|usdc> --base-ism 0x... --ethereum-ism 0x... --xphere-ism 0x...`);
}

function parseArgs(argv) {
  const [routeKey, ...rest] = argv;
  const options = { routeKey };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`Invalid argument ${key || ""}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!ROUTES[options.routeKey]) throw new Error("Route must be eth or usdc");
  for (const chainName of Object.keys(CHAINS)) {
    const ism = options[`${chainName}-ism`];
    if (!isAddress(ism)) throw new Error(`--${chainName}-ism must be a non-zero EVM address`);
    const artifact = await readArtifact(chainName);
    const record = artifact.bridgeRoutes?.[options.routeKey];
    if (!record) throw new Error(`${chainName} ${options.routeKey} route must be recorded first`);
    record.interchainSecurityModule = ism;
    record.securityApplied = true;
    await writeArtifact(chainName, artifact);
  }
  console.log(`Recorded final ${ROUTES[options.routeKey].id} security modules.`);
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
