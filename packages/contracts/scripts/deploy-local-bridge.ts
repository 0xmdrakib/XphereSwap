import { ethers, network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DeploymentArtifact } from "./shared/config";
import {
  readDeploymentArtifact,
  repoRootFromContractsScript,
  writeDeploymentArtifact,
} from "./shared/artifacts";

const LOCAL_ETHEREUM_DOMAIN = 31338;
const LOCAL_XPHERE_DOMAIN = 31337;
const LOCAL_SEED_AMOUNT = ethers.parseUnits("250000", 6);
const BRIDGE_LIQUIDITY = ethers.parseUnits("1000000", 6);
const NATIVE_BRIDGE_LIQUIDITY = ethers.parseEther(process.env.LOCAL_NATIVE_BRIDGE_LIQUIDITY || "1000");
const FAUCET_NATIVE_BALANCE = ethers.parseEther(process.env.LOCAL_ETHEREUM_FAUCET_NATIVE_BALANCE || "2000");
const FAUCET_NATIVE_CLAIM = ethers.parseEther(process.env.LOCAL_ETHEREUM_FAUCET_NATIVE_CLAIM || "25");
const FAUCET_STABLE_BALANCE = ethers.parseUnits(process.env.LOCAL_ETHEREUM_FAUCET_STABLE_BALANCE || "1000000", 6);
const FAUCET_STABLE_CLAIM = ethers.parseUnits(process.env.LOCAL_ETHEREUM_FAUCET_STABLE_CLAIM || "5000", 6);

async function deployContract(name: string, args: unknown[] = [], overrides: Record<string, unknown> = {}) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args, overrides);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return contract as any;
}

async function main() {
  if (!["localhost", "localEthereum"].includes(network.name)) {
    throw new Error("deploy-local-bridge must run with --network localhost or --network localEthereum");
  }

  const [deployer, account1, account2] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const repoRoot = repoRootFromContractsScript(__dirname);
  const deploymentsDir = resolve(repoRoot, "deployments");
  await mkdir(deploymentsDir, { recursive: true });

  if (network.name === "localEthereum") {
    console.log(`network=${network.name} chainId=${chainId}`);
    const usdc = await deployContract("MintableERC20", ["Local Ethereum USDC", "USDC", 6, deployerAddress]);
    const usdt = await deployContract("MintableERC20", ["Local Ethereum USDT", "USDT", 6, deployerAddress]);
    const usdcRouter = await deployContract("LocalERC20Bridge", [
      await usdc.getAddress(),
      LOCAL_ETHEREUM_DOMAIN,
      LOCAL_XPHERE_DOMAIN,
      0,
      deployerAddress,
    ]);
    const usdtRouter = await deployContract("LocalERC20Bridge", [
      await usdt.getAddress(),
      LOCAL_ETHEREUM_DOMAIN,
      LOCAL_XPHERE_DOMAIN,
      0,
      deployerAddress,
    ]);
    const nativeRouter = await deployContract(
      "LocalNativeBridge",
      [LOCAL_ETHEREUM_DOMAIN, LOCAL_XPHERE_DOMAIN, deployerAddress],
      { value: NATIVE_BRIDGE_LIQUIDITY },
    );
    const faucet = await deployContract(
      "LocalFaucet",
      [deployerAddress, FAUCET_NATIVE_CLAIM],
      { value: FAUCET_NATIVE_BALANCE },
    );

    const seedAccounts = [
      deployerAddress,
      account1 ? await account1.getAddress() : undefined,
      account2 ? await account2.getAddress() : undefined,
    ].filter((address): address is string => Boolean(address));
    for (const account of seedAccounts) {
      await (await usdc.mint(account, LOCAL_SEED_AMOUNT)).wait();
      await (await usdt.mint(account, LOCAL_SEED_AMOUNT)).wait();
    }
    const faucetAddress = await faucet.getAddress();
    await (await usdc.mint(faucetAddress, FAUCET_STABLE_BALANCE)).wait();
    await (await usdt.mint(faucetAddress, FAUCET_STABLE_BALANCE)).wait();
    await (await faucet.setTokenAmount(await usdc.getAddress(), FAUCET_STABLE_CLAIM)).wait();
    await (await faucet.setTokenAmount(await usdt.getAddress(), FAUCET_STABLE_CLAIM)).wait();

    const artifact: DeploymentArtifact = {
      chainId,
      contracts: {
        usdcRouter: await usdcRouter.getAddress(),
        usdtRouter: await usdtRouter.getAddress(),
        nativeBridgeRouter: await nativeRouter.getAddress(),
        localFaucet: await faucet.getAddress(),
      },
      tokens: {
        USDC: await usdc.getAddress(),
        USDT: await usdt.getAddress(),
      },
      router: null,
      factory: null,
      initCodeHash: null,
      bridgeRoutes: {
        localUsdc: {
          router: await usdcRouter.getAddress(),
          token: await usdc.getAddress(),
          remoteDomain: LOCAL_XPHERE_DOMAIN,
        },
        localUsdt: {
          router: await usdtRouter.getAddress(),
          token: await usdt.getAddress(),
          remoteDomain: LOCAL_XPHERE_DOMAIN,
        },
        localNative: {
          router: await nativeRouter.getAddress(),
          token: "ETH",
          remoteToken: "XP",
          remoteDomain: LOCAL_XPHERE_DOMAIN,
          liquidity: ethers.formatEther(NATIVE_BRIDGE_LIQUIDITY),
        },
      },
    };
    await writeDeploymentArtifact(resolve(deploymentsDir, "local-ethereum.local.json"), artifact);
    console.log("wrote deployments/local-ethereum.local.json");
    return;
  }

  console.log(`network=${network.name} chainId=${chainId}`);
  const xphereArtifactPath = resolve(deploymentsDir, "localhost.local.json");
  const xphereArtifact = await readDeploymentArtifact(xphereArtifactPath);
  if (!xphereArtifact?.tokens.xUSDC || !xphereArtifact.tokens.xUSDT) {
    throw new Error("Run pnpm deploy:swap:localhost before deploying the local bridge");
  }

  const xusdc = await ethers.getContractAt("MintableERC20", xphereArtifact.tokens.xUSDC);
  const xusdt = await ethers.getContractAt("MintableERC20", xphereArtifact.tokens.xUSDT);
  const xusdcRouter = await deployContract("LocalERC20Bridge", [
    await xusdc.getAddress(),
    LOCAL_XPHERE_DOMAIN,
    LOCAL_ETHEREUM_DOMAIN,
    1,
    deployerAddress,
  ]);
  const xusdtRouter = await deployContract("LocalERC20Bridge", [
    await xusdt.getAddress(),
    LOCAL_XPHERE_DOMAIN,
    LOCAL_ETHEREUM_DOMAIN,
    1,
    deployerAddress,
  ]);
  const nativeRouter = await deployContract(
    "LocalNativeBridge",
    [LOCAL_XPHERE_DOMAIN, LOCAL_ETHEREUM_DOMAIN, deployerAddress],
    { value: NATIVE_BRIDGE_LIQUIDITY },
  );

  await (await xusdc.mint(await xusdcRouter.getAddress(), BRIDGE_LIQUIDITY)).wait();
  await (await xusdt.mint(await xusdtRouter.getAddress(), BRIDGE_LIQUIDITY)).wait();
  await (await xusdc.transferOwnership(await xusdcRouter.getAddress())).wait();
  await (await xusdt.transferOwnership(await xusdtRouter.getAddress())).wait();

  xphereArtifact.contracts.usdcBridgeRouter = await xusdcRouter.getAddress();
  xphereArtifact.contracts.usdtBridgeRouter = await xusdtRouter.getAddress();
  xphereArtifact.contracts.nativeBridgeRouter = await nativeRouter.getAddress();
  xphereArtifact.bridgeRoutes = {
    ...(xphereArtifact.bridgeRoutes || {}),
    localUsdc: {
      router: await xusdcRouter.getAddress(),
      token: await xusdc.getAddress(),
      remoteDomain: LOCAL_ETHEREUM_DOMAIN,
    },
    localUsdt: {
      router: await xusdtRouter.getAddress(),
      token: await xusdt.getAddress(),
      remoteDomain: LOCAL_ETHEREUM_DOMAIN,
    },
    localNative: {
      router: await nativeRouter.getAddress(),
      token: "XP",
      remoteToken: "ETH",
      remoteDomain: LOCAL_ETHEREUM_DOMAIN,
      liquidity: ethers.formatEther(NATIVE_BRIDGE_LIQUIDITY),
    },
  };
  await writeDeploymentArtifact(xphereArtifactPath, xphereArtifact);

  const ethArtifactPath = resolve(deploymentsDir, "local-ethereum.local.json");
  const ethArtifact = await readDeploymentArtifact(ethArtifactPath);
  const envLocal = [
    "# Auto-generated by local swap/bridge deployment scripts",
    "VITE_SWAP_CHAIN=localhost",
    "VITE_BRIDGE_MODE=local",
    `VITE_LOCAL_ROUTER=${xphereArtifact.contracts.router}`,
    `VITE_LOCAL_FACTORY=${xphereArtifact.contracts.factory}`,
    `VITE_LOCAL_WXP=${xphereArtifact.contracts.wXP}`,
    `VITE_LOCAL_XUSDC=${xphereArtifact.tokens.xUSDC}`,
    `VITE_LOCAL_XUSDT=${xphereArtifact.tokens.xUSDT}`,
    `VITE_LOCAL_XEF=${xphereArtifact.tokens.XEF || ""}`,
    `VITE_LOCAL_XPHERE_FAUCET=${xphereArtifact.contracts.localFaucet || ""}`,
    `VITE_LOCAL_ETHEREUM_USDC=${ethArtifact?.tokens.USDC || ""}`,
    `VITE_LOCAL_ETHEREUM_USDT=${ethArtifact?.tokens.USDT || ""}`,
    `VITE_LOCAL_ETHEREUM_USDC_BRIDGE_ROUTER=${ethArtifact?.contracts.usdcRouter || ""}`,
    `VITE_LOCAL_ETHEREUM_USDT_BRIDGE_ROUTER=${ethArtifact?.contracts.usdtRouter || ""}`,
    `VITE_LOCAL_ETHEREUM_NATIVE_BRIDGE_ROUTER=${ethArtifact?.contracts.nativeBridgeRouter || ""}`,
    `VITE_LOCAL_ETHEREUM_FAUCET=${ethArtifact?.contracts.localFaucet || ""}`,
    `VITE_LOCAL_XPHERE_USDC_BRIDGE_ROUTER=${xphereArtifact.contracts.usdcBridgeRouter}`,
    `VITE_LOCAL_XPHERE_USDT_BRIDGE_ROUTER=${xphereArtifact.contracts.usdtBridgeRouter}`,
    `VITE_LOCAL_XPHERE_NATIVE_BRIDGE_ROUTER=${xphereArtifact.contracts.nativeBridgeRouter}`,
    "VITE_WALLETCONNECT_PROJECT_ID=xphere-swap-dev",
    "",
  ].join("\n");
  await writeFile(resolve(repoRoot, "apps/web/.env.local"), envLocal);

  console.log("wrote deployments/localhost.local.json");
  console.log("wrote apps/web/.env.local");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
