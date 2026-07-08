const supportedMajors = new Set([20, 22]);
const releaseMode = process.argv.includes("--release");
const liveMode = process.argv.includes("--live") || releaseMode;
const current = process.versions.node;
const major = Number(current.split(".")[0]);

if (supportedMajors.has(major)) {
  console.log(`Node.js ${current} is supported for Xphere deployment.`);
} else {
  const message = `Node.js ${current} is not supported for live deployment. Use Node 20 or 22 before sending mainnet transactions.`;
  if (liveMode) {
    console.error(message);
    process.exitCode = 1;
  } else {
    console.warn(`[WARN] ${message}`);
  }
}
