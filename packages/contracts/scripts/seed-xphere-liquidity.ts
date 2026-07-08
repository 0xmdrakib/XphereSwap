import { ethers, network } from "hardhat";
import { resolve } from "node:path";
import { deploymentFilename, MAINNET_ACK } from "./shared/config";
import { readDeploymentArtifact, writeDeploymentArtifact } from "./shared/artifacts";

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function mint(address,uint256)",
];
const WXP_ABI = [
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const ROUTER_ABI = [
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];

type SeedAmounts = {
  wxpPerStablePool: bigint;
  stablePerWxpPool: bigint;
  stableStableAmount: bigint;
  wxpForXethPool: bigint;
  xethForWxpPool: bigint;
  wxpForXefPool: bigint;
  xefForWxpPool: bigint;
};

function envAmount(name: string, fallback: string, decimals: number): bigint {
  const raw = process.env[name] || fallback;
  return ethers.parseUnits(raw, decimals);
}

function applySlippage(value: bigint): bigint {
  const bps = BigInt(process.env.LIQUIDITY_SLIPPAGE_BPS || "100");
  return (value * (10_000n - bps)) / 10_000n;
}

function isXphereSwapMvp(): boolean {
  return (
    network.name === "xphereMainnet" &&
    (process.env.DEPLOY_XPHERE_SWAP_MVP === "true" ||
      process.env.XPHERE_SWAP_MVP === "true" ||
      process.env.DEPLOY_XPHERE_ONLY_MVP === "true")
  );
}

function requireMainnetAck() {
  if (network.name !== "xphereMainnet") return;
  if (process.env.MAINNET_BETA_ACK !== MAINNET_ACK) {
    throw new Error(`Refusing mainnet liquidity seed: set MAINNET_BETA_ACK=${MAINNET_ACK}`);
  }
  if (process.env.LIQUIDITY_MAINNET_ACK !== "I_UNDERSTAND_LIQUIDITY_SEEDING") {
    throw new Error("Refusing mainnet liquidity seed: set LIQUIDITY_MAINNET_ACK=I_UNDERSTAND_LIQUIDITY_SEEDING");
  }
}

async function wait(tx: { wait: () => Promise<unknown> }) {
  await tx.wait();
}

async function ensureTokenBalance(token: any, holder: string, amount: bigint, label: string) {
  const balance = BigInt(await token.balanceOf(holder));
  if (balance >= amount) return;

  if (process.env.LIQUIDITY_MINT_MOCKS !== "true") {
    throw new Error(`${label} balance too low and LIQUIDITY_MINT_MOCKS is not true`);
  }

  let owner: string;
  try {
    owner = await token.owner();
  } catch {
    throw new Error(`${label} does not expose owner(); cannot mint`);
  }

  if (owner.toLowerCase() !== holder.toLowerCase()) {
    throw new Error(`${label} owner is ${owner}; deployer ${holder} cannot mint`);
  }

  const deficit = amount - balance;
  await wait(await token.mint(holder, deficit));
  console.log(`minted ${deficit} ${label}`);
}

async function addPool(
  router: any,
  tokenA: string,
  tokenB: string,
  amountA: bigint,
  amountB: bigint,
  recipient: string,
  label: string,
) {
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  await wait(
    await router.addLiquidity(
      tokenA,
      tokenB,
      amountA,
      amountB,
      applySlippage(amountA),
      applySlippage(amountB),
      recipient,
      deadline,
    ),
  );
  console.log(`seeded ${label}`);
}

async function main() {
  if (!["localhost", "xphereTestnet", "xphereMainnet"].includes(network.name)) {
    throw new Error("seed-xphere-liquidity only supports localhost, xphereTestnet, and xphereMainnet");
  }
  requireMainnetAck();

  const artifactFile = process.env.SEED_ARTIFACT || deploymentFilename(network.name);
  const artifactPath = resolve(__dirname, "../../../deployments", artifactFile);
  const artifact = await readDeploymentArtifact(artifactPath);
  if (!artifact) throw new Error(`Missing deployment artifact ${artifactFile}`);

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const routerAddress = artifact.contracts.router;
  const factoryAddress = artifact.contracts.factory;
  const wxpAddress = artifact.contracts.wXP;
  const xusdcAddress = artifact.tokens.xUSDC;
  const xusdtAddress = artifact.tokens.xUSDT;
  const xethAddress = artifact.tokens.xETH;
  const xefAddress = artifact.tokens.XEF;
  const stableLiquidityRequired = !isXphereSwapMvp();

  if (!routerAddress || !factoryAddress || !wxpAddress) {
    throw new Error("Deployment artifact must include router, factory, and wXP");
  }
  if (stableLiquidityRequired && (!xusdcAddress || !xusdtAddress)) {
    throw new Error("Deployment artifact must include xUSDC and xUSDT unless DEPLOY_XPHERE_SWAP_MVP=true");
  }

  const wxp = new ethers.Contract(wxpAddress, WXP_ABI, deployer);
  const xusdc = xusdcAddress ? new ethers.Contract(xusdcAddress, ERC20_ABI, deployer) : undefined;
  const xusdt = xusdtAddress ? new ethers.Contract(xusdtAddress, ERC20_ABI, deployer) : undefined;
  const xeth = xethAddress ? new ethers.Contract(xethAddress, ERC20_ABI, deployer) : undefined;
  const xef = xefAddress ? new ethers.Contract(xefAddress, ERC20_ABI, deployer) : undefined;
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, deployer);
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, ethers.provider);

  const amounts: SeedAmounts = {
    wxpPerStablePool: envAmount("LIQUIDITY_WXP_PER_STABLE_POOL", "1", 18),
    stablePerWxpPool: envAmount("LIQUIDITY_STABLE_PER_WXP_POOL", "100", 6),
    stableStableAmount: envAmount("LIQUIDITY_STABLE_STABLE_AMOUNT", "100", 6),
    wxpForXethPool: envAmount("LIQUIDITY_WXP_FOR_XETH_POOL", "1", 18),
    xethForWxpPool: envAmount("LIQUIDITY_XETH_FOR_WXP_POOL", "0.01", 18),
    wxpForXefPool: envAmount("LIQUIDITY_WXP_FOR_XEF_POOL", "1", 18),
    xefForWxpPool: envAmount("LIQUIDITY_XEF_FOR_WXP_POOL", "1000", 18),
  };

  if (
    stableLiquidityRequired &&
    (amounts.wxpPerStablePool === 0n || amounts.stablePerWxpPool === 0n || amounts.stableStableAmount === 0n)
  ) {
    throw new Error("Liquidity seed amounts must be greater than zero");
  }

  if (process.env.SEED_XETH_LIQUIDITY === "true" && !xethAddress) {
    throw new Error("SEED_XETH_LIQUIDITY=true requires artifact token xETH from the ETH -> xETH route");
  }
  const shouldSeedXeth = Boolean(xethAddress && process.env.SEED_XETH_LIQUIDITY === "true");
  const shouldSeedXef = Boolean(xefAddress && process.env.SEED_XEF_LIQUIDITY === "true");
  if (process.env.SEED_XEF_LIQUIDITY === "true" && !xefAddress) {
    throw new Error("SEED_XEF_LIQUIDITY=true requires artifact token XEF");
  }
  const requiredWxp =
    (stableLiquidityRequired ? amounts.wxpPerStablePool * 2n : 0n) +
    (shouldSeedXeth ? amounts.wxpForXethPool : 0n) +
    (shouldSeedXef ? amounts.wxpForXefPool : 0n);
  const requiredXusdc = stableLiquidityRequired ? amounts.stablePerWxpPool + amounts.stableStableAmount : 0n;
  const requiredXusdt = stableLiquidityRequired ? amounts.stablePerWxpPool + amounts.stableStableAmount : 0n;

  const wxpBalance = BigInt(await wxp.balanceOf(deployerAddress));
  if (wxpBalance < requiredWxp) {
    const depositAmount = requiredWxp - wxpBalance;
    await wait(await wxp.deposit({ value: depositAmount }));
    console.log(`wrapped ${ethers.formatEther(depositAmount)} XP into WXP`);
  }

  if (stableLiquidityRequired && xusdc && xusdt) {
    await ensureTokenBalance(xusdc, deployerAddress, requiredXusdc, "xUSDC");
    await ensureTokenBalance(xusdt, deployerAddress, requiredXusdt, "xUSDT");
  }
  if (shouldSeedXeth && xeth) {
    await ensureTokenBalance(xeth, deployerAddress, amounts.xethForWxpPool, "xETH");
  }
  if (shouldSeedXef && xef) {
    await ensureTokenBalance(xef, deployerAddress, amounts.xefForWxpPool, "XEF");
  }

  if (requiredWxp > 0n) {
    await wait(await wxp.approve(routerAddress, requiredWxp));
  }
  if (stableLiquidityRequired && xusdc && xusdt) {
    await wait(await xusdc.approve(routerAddress, requiredXusdc));
    await wait(await xusdt.approve(routerAddress, requiredXusdt));
  }
  if (shouldSeedXeth && xeth) {
    await wait(await xeth.approve(routerAddress, amounts.xethForWxpPool));
  }
  if (shouldSeedXef && xef) {
    await wait(await xef.approve(routerAddress, amounts.xefForWxpPool));
  }

  if (stableLiquidityRequired && xusdcAddress && xusdtAddress) {
    await addPool(
      router,
      wxpAddress,
      xusdcAddress,
      amounts.wxpPerStablePool,
      amounts.stablePerWxpPool,
      deployerAddress,
      "WXP/xUSDC",
    );
    await addPool(
      router,
      wxpAddress,
      xusdtAddress,
      amounts.wxpPerStablePool,
      amounts.stablePerWxpPool,
      deployerAddress,
      "WXP/xUSDT",
    );
    await addPool(
      router,
      xusdcAddress,
      xusdtAddress,
      amounts.stableStableAmount,
      amounts.stableStableAmount,
      deployerAddress,
      "xUSDC/xUSDT",
    );
  }
  if (shouldSeedXeth && xethAddress) {
    await addPool(
      router,
      wxpAddress,
      xethAddress,
      amounts.wxpForXethPool,
      amounts.xethForWxpPool,
      deployerAddress,
      "WXP/xETH",
    );
  }
  if (shouldSeedXef && xefAddress) {
    await addPool(
      router,
      wxpAddress,
      xefAddress,
      amounts.wxpForXefPool,
      amounts.xefForWxpPool,
      deployerAddress,
      "WXP/XEF",
    );
  }

  if (stableLiquidityRequired && xusdcAddress && xusdtAddress) {
    artifact.contracts.wXPxUSDCPair = await factory.getPair(wxpAddress, xusdcAddress);
    artifact.contracts.wXPxUSDTPair = await factory.getPair(wxpAddress, xusdtAddress);
    artifact.contracts.xUSDCxUSDTPair = await factory.getPair(xusdcAddress, xusdtAddress);
  }
  if (shouldSeedXeth && xethAddress) {
    artifact.contracts.wXPxETHPair = await factory.getPair(wxpAddress, xethAddress);
  }
  if (shouldSeedXef && xefAddress) {
    artifact.contracts.wXPxEFPair = await factory.getPair(wxpAddress, xefAddress);
  }
  artifact.bridgeRoutes = {
    ...(artifact.bridgeRoutes || {}),
    seededLiquidity: {
      by: deployerAddress,
      stableEnabled: stableLiquidityRequired,
      wxpPerStablePool: ethers.formatEther(amounts.wxpPerStablePool),
      stablePerWxpPool: ethers.formatUnits(amounts.stablePerWxpPool, 6),
      stableStableAmount: ethers.formatUnits(amounts.stableStableAmount, 6),
      xethEnabled: shouldSeedXeth,
      wxpForXethPool: shouldSeedXeth ? ethers.formatEther(amounts.wxpForXethPool) : "0",
      xethForWxpPool: shouldSeedXeth ? ethers.formatEther(amounts.xethForWxpPool) : "0",
      xefEnabled: shouldSeedXef,
      wxpForXefPool: shouldSeedXef ? ethers.formatEther(amounts.wxpForXefPool) : "0",
      xefForWxpPool: shouldSeedXef ? ethers.formatEther(amounts.xefForWxpPool) : "0",
    },
  };

  await writeDeploymentArtifact(artifactPath, artifact);
  console.log(`updated deployments/${artifactFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
