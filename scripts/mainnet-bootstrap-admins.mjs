import {
  CHAINS,
  MAINNET_ACK,
  isAddress,
  readEnv,
  validateBridgeOperators,
} from "../ops/hyperlane/scripts/bridge-config.mjs";

async function main() {
  const env = await readEnv();
  if (env.MAINNET_BETA_ACK !== MAINNET_ACK) {
    throw new Error(`MAINNET_BETA_ACK must equal ${MAINNET_ACK}`);
  }

  const missing = Object.values(CHAINS)
    .map((chain) => chain.ownerEnv)
    .filter((key) => !isAddress(env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing chain-specific bridge owner Safe address(es): ${missing.join(", ")}`);
  }

  const errors = validateBridgeOperators(env);
  if (errors.length > 0) throw new Error(errors.join("; "));

  if (isAddress(env.PROTOCOL_ADMIN_SAFE)) {
    console.log("Ignoring legacy PROTOCOL_ADMIN_SAFE for bridge ownership; chain-specific Safe addresses are required.");
  }
  console.log("Bridge admin inputs validated. This command does not deploy or replace any Safe.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
