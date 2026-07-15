import {
  CHAINS,
  ROUTES,
  ethDailyCap,
  isAddress,
  isPrivateKey,
  isUrl,
  readArtifact,
  readEnv,
  routeComplete,
  validatorsFromEnv,
} from "../ops/hyperlane/scripts/bridge-config.mjs";

const PUBLIC_XPHERE_RPCS = new Set([
  "https://en-hkg.x-phere.com",
  "https://en-bkk.x-phere.com",
  "https://mainnet.xphere-rpc.com",
]);

function state(status, label, detail = "") {
  console.log(`[${status}] ${label}${detail ? ` - ${detail}` : ""}`);
}

function configured(ready, label, detail = "") {
  state(ready ? "CONFIGURED" : "MISSING", label, detail);
}

function address(value, label) {
  configured(isAddress(value), label, isAddress(value) ? value : "not recorded");
}

async function main() {
  const env = await readEnv();
  const artifacts = Object.fromEntries(
    await Promise.all(Object.keys(CHAINS).map(async (chainName) => [chainName, await readArtifact(chainName)])),
  );

  console.log("XphereSwap Operator Status");
  state(
    env.VITE_BRIDGE_RELEASED === "true" ? "RELEASE FLAG SET" : "NOT LIVE",
    "Bridge public state",
    env.VITE_BRIDGE_RELEASED === "true"
      ? "run full readiness before publishing"
      : "preview-only transactions remain disabled",
  );

  console.log("\n1. Operator inputs");
  configured(isPrivateKey(env.DEPLOYER_PRIVATE_KEY), "DEPLOYER_PRIVATE_KEY", isPrivateKey(env.DEPLOYER_PRIVATE_KEY) ? "set" : "missing");
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    const rpcReady = isUrl(env[chain.rpcEnv]) &&
      !(chainName === "xphere" && PUBLIC_XPHERE_RPCS.has(env[chain.rpcEnv]));
    configured(rpcReady, chain.rpcEnv, env[chain.rpcEnv] || "missing");
    address(env[chain.ownerEnv], `${chain.displayName} route owner Safe`);
  }
  const owners = Object.values(CHAINS).map((chain) => env[chain.ownerEnv]);
  configured(
    owners.every(isAddress) && new Set(owners.map((owner) => owner.toLowerCase())).size === owners.length,
    "Route owner separation",
    "three unique chain-specific contracts required",
  );
  const validators = validatorsFromEnv(env);
  configured(
    validators.every(isAddress) && new Set(validators.map((validator) => validator.toLowerCase())).size === 3,
    "Hyperlane validators",
    "three unique addresses required for 2-of-3 validation",
  );
  address(env.HYPERLANE_RELAYER_ADDRESS, "Hyperlane relayer");
  configured(
    env.BRIDGE_ETH_DAILY_CAP_REVIEWED === "true" && Boolean(ethDailyCap(env)),
    "ETH daily cap",
    env.BRIDGE_ETH_DAILY_CAP_WEI || "missing",
  );

  console.log("\n2. Hyperlane route records");
  for (const [routeKey, route] of Object.entries(ROUTES)) {
    for (const chainName of Object.keys(CHAINS)) {
      const record = artifacts[chainName].bridgeRoutes?.[routeKey];
      const complete = routeComplete(artifacts[chainName], routeKey, chainName);
      const secured = routeComplete(artifacts[chainName], routeKey, chainName, { requireSecurity: true });
      configured(
        complete,
        `${CHAINS[chainName].displayName} ${route.asset} route`,
        complete ? `${record.router}${secured ? " (final security recorded)" : " (phase two pending)"}` : "not recorded",
      );
    }
  }
  address(artifacts.xphere.tokens?.xETH || env.VITE_XPHERE_XETH, "Xphere shared xETH");
  address(artifacts.xphere.tokens?.xUSDC || env.VITE_XPHERE_XUSDC, "Xphere shared xUSDC");

  console.log("\n3. Existing live swap");
  address(artifacts.xphere.contracts?.wXP || env.VITE_XPHERE_WXP, "WXP");
  address(artifacts.xphere.contracts?.factory || env.VITE_XPHERE_FACTORY, "Factory");
  address(artifacts.xphere.contracts?.router || env.VITE_XPHERE_ROUTER, "Router");
  address(artifacts.xphere.contracts?.multicall3 || env.VITE_XPHERE_MULTICALL3, "Multicall3");
  address(artifacts.xphere.tokens?.XEF || env.VITE_XPHERE_XEF, "XEF");

  console.log("\nNext useful commands:");
  console.log("- pnpm mainnet:orchestrate");
  console.log("- pnpm bridge:validate");
  console.log("- pnpm bridge:render-routes");
  console.log("- pnpm bridge:render-security");
  console.log("- pnpm bridge:readiness");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
