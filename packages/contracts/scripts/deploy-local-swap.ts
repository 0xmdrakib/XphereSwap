import { ethers, network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DeploymentArtifact } from "./shared/config";

const MAX_UINT = ethers.MaxUint256;
const SEED_STABLE = ethers.parseUnits("250000", 6);
const SEED_XEF = ethers.parseEther("2500000");
const SEED_WXP = ethers.parseEther("100");
const LOCAL_WXP_DEPOSIT = ethers.parseEther(process.env.LOCAL_WXP_DEPOSIT || "2000");
const FAUCET_NATIVE_BALANCE = ethers.parseEther(process.env.LOCAL_FAUCET_NATIVE_BALANCE || "2000");
const FAUCET_NATIVE_CLAIM = ethers.parseEther(process.env.LOCAL_FAUCET_NATIVE_CLAIM || "25");
const FAUCET_STABLE_BALANCE = ethers.parseUnits(process.env.LOCAL_FAUCET_STABLE_BALANCE || "1000000", 6);
const FAUCET_STABLE_CLAIM = ethers.parseUnits(process.env.LOCAL_FAUCET_STABLE_CLAIM || "5000", 6);
const FAUCET_XEF_BALANCE = ethers.parseEther(process.env.LOCAL_FAUCET_XEF_BALANCE || "10000000");
const FAUCET_XEF_CLAIM = ethers.parseEther(process.env.LOCAL_FAUCET_XEF_CLAIM || "50000");

async function deployContract(name: string, args: unknown[] = [], overrides: Record<string, unknown> = {}) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args, overrides);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return contract as any;
}

async function wait(tx: { wait: () => Promise<unknown> }) {
  await tx.wait();
}

function uniqueAddresses(addresses: Array<string | undefined>) {
  const seen = new Set<string>();
  return addresses
    .filter((address): address is string => {
      if (!address) return false;
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    })
    .filter((address) => {
      const key = address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function approveMax(token: any, spender: string) {
  await wait(await token.approve(spender, MAX_UINT));
}

async function addPool(
  router: any,
  tokenA: string,
  tokenB: string,
  amountA: bigint,
  amountB: bigint,
  recipient: string,
) {
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  await wait(await router.addLiquidity(tokenA, tokenB, amountA, amountB, 0, 0, recipient, deadline));
}

async function main() {
  if (!["hardhat", "localhost"].includes(network.name)) {
    throw new Error("deploy-local-swap must run only on hardhat or localhost");
  }

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const deployerAddress = await deployer.getAddress();
  const extraSeedAccounts = (process.env.LOCAL_SEED_ACCOUNTS || "")
    .split(",")
    .map((item) => item.trim());
  const seedAccounts = uniqueAddresses([
    deployerAddress,
    signers[1] ? await signers[1].getAddress() : undefined,
    signers[2] ? await signers[2].getAddress() : undefined,
    ...extraSeedAccounts,
  ]);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`network=${network.name} chainId=${chainId}`);
  console.log(`deployer=${deployerAddress}`);
  console.log(`seedAccounts=${seedAccounts.join(",")}`);

  const wxp = await deployContract("WXP");
  const factory = await deployContract("UniswapV2Factory", [deployerAddress]);
  const router = await deployContract("XphereV2Router02", [
    await factory.getAddress(),
    await wxp.getAddress(),
  ]);
  const multicall = await deployContract("Multicall3Lite");
  const xusdc = await deployContract("MintableERC20", [
    "Local Xphere Bridged USDC",
    "xUSDC",
    6,
    deployerAddress,
  ]);
  const xusdt = await deployContract("MintableERC20", [
    "Local Xphere Bridged USDT",
    "xUSDT",
    6,
    deployerAddress,
  ]);
  const xef = await deployContract("MintableERC20", [
    "Local Xeffy",
    "XEF",
    18,
    deployerAddress,
  ]);
  const faucet = await deployContract(
    "LocalFaucet",
    [deployerAddress, FAUCET_NATIVE_CLAIM],
    { value: FAUCET_NATIVE_BALANCE },
  );

  for (const account of seedAccounts) {
    await wait(await xusdc.mint(account, SEED_STABLE));
    await wait(await xusdt.mint(account, SEED_STABLE));
    await wait(await xef.mint(account, SEED_XEF));
  }

  const faucetAddress = await faucet.getAddress();
  await wait(await xusdc.mint(faucetAddress, FAUCET_STABLE_BALANCE));
  await wait(await xusdt.mint(faucetAddress, FAUCET_STABLE_BALANCE));
  await wait(await xef.mint(faucetAddress, FAUCET_XEF_BALANCE));
  await wait(await faucet.setTokenAmount(await xusdc.getAddress(), FAUCET_STABLE_CLAIM));
  await wait(await faucet.setTokenAmount(await xusdt.getAddress(), FAUCET_STABLE_CLAIM));
  await wait(await faucet.setTokenAmount(await xef.getAddress(), FAUCET_XEF_CLAIM));

  await wait(await wxp.deposit({ value: LOCAL_WXP_DEPOSIT }));
  for (const account of seedAccounts.filter((account) => account.toLowerCase() !== deployerAddress.toLowerCase())) {
    await wait(await wxp.transfer(account, SEED_WXP));
  }

  const routerAddress = await router.getAddress();
  await approveMax(wxp, routerAddress);
  await approveMax(xusdc, routerAddress);
  await approveMax(xusdt, routerAddress);
  await approveMax(xef, routerAddress);

  await addPool(
    router,
    await xusdc.getAddress(),
    await xusdt.getAddress(),
    ethers.parseUnits("50000", 6),
    ethers.parseUnits("50000", 6),
    deployerAddress,
  );
  await addPool(
    router,
    await wxp.getAddress(),
    await xusdc.getAddress(),
    ethers.parseEther("500"),
    ethers.parseUnits("50000", 6),
    deployerAddress,
  );
  await addPool(
    router,
    await wxp.getAddress(),
    await xusdt.getAddress(),
    ethers.parseEther("500"),
    ethers.parseUnits("50000", 6),
    deployerAddress,
  );
  await addPool(
    router,
    await wxp.getAddress(),
    await xef.getAddress(),
    ethers.parseEther("250"),
    ethers.parseEther("250000"),
    deployerAddress,
  );

  const xusdcxusdtPair = await factory.getPair(await xusdc.getAddress(), await xusdt.getAddress());
  const wxpxusdcPair = await factory.getPair(await wxp.getAddress(), await xusdc.getAddress());
  const wxpxusdtPair = await factory.getPair(await wxp.getAddress(), await xusdt.getAddress());
  const wxpxefPair = await factory.getPair(await wxp.getAddress(), await xef.getAddress());

  const artifact: DeploymentArtifact = {
    chainId,
    contracts: {
      wXP: await wxp.getAddress(),
      factory: await factory.getAddress(),
      router: routerAddress,
      multicall3: await multicall.getAddress(),
      localFaucet: await faucet.getAddress(),
      xUSDCxUSDTPair: xusdcxusdtPair,
      wXPxUSDCPair: wxpxusdcPair,
      wXPxUSDTPair: wxpxusdtPair,
      wXPxEFPair: wxpxefPair,
    },
    tokens: {
      xUSDC: await xusdc.getAddress(),
      xUSDT: await xusdt.getAddress(),
      XEF: await xef.getAddress(),
    },
    router: routerAddress,
    factory: await factory.getAddress(),
    initCodeHash: null,
    bridgeRoutes: {},
  };

  const rootDir = resolve(__dirname, "../../..");
  const outputDir = resolve(rootDir, "deployments");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "localhost.local.json"), `${JSON.stringify(artifact, null, 2)}\n`);

  const envLocal = [
    "# Auto-generated by pnpm deploy:swap:localhost",
    "VITE_SWAP_CHAIN=localhost",
    `VITE_LOCAL_ROUTER=${artifact.contracts.router}`,
    `VITE_LOCAL_FACTORY=${artifact.contracts.factory}`,
    `VITE_LOCAL_WXP=${artifact.contracts.wXP}`,
    `VITE_LOCAL_XUSDC=${artifact.tokens.xUSDC}`,
    `VITE_LOCAL_XUSDT=${artifact.tokens.xUSDT}`,
    `VITE_LOCAL_XEF=${artifact.tokens.XEF}`,
    `VITE_LOCAL_XPHERE_FAUCET=${artifact.contracts.localFaucet}`,
    "VITE_WALLETCONNECT_PROJECT_ID=xphere-swap-dev",
    "",
  ].join("\n");
  await writeFile(resolve(rootDir, "apps/web/.env.local"), envLocal);

  console.log("seeded pools: WXP/xUSDC, WXP/xUSDT, xUSDC/xUSDT, WXP/XEF");
  console.log(`local faucet funded: ${artifact.contracts.localFaucet}`);
  console.log("wrote deployments/localhost.local.json");
  console.log("wrote apps/web/.env.local");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
