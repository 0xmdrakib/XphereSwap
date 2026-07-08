import { ethers, network } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DeploymentArtifact,
  assertMainnetBetaGates,
  deploymentFilename,
  requireAdminSafe,
} from "./shared/config";

async function deployContract(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return contract;
}

function optionalAddress(value: string | undefined, label: string): string | null {
  if (!value) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value) || value.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${label} must be a non-zero EVM address`);
  }
  return ethers.getAddress(value);
}

async function readExistingArtifact(path: string): Promise<DeploymentArtifact | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as DeploymentArtifact;
}

async function main() {
  assertMainnetBetaGates();

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const adminSafe = requireAdminSafe() || deployerAddress;
  const outputDir = resolve(__dirname, "../../../deployments");
  const filename = deploymentFilename(network.name);
  const existingArtifact = await readExistingArtifact(resolve(outputDir, filename));

  console.log(`network=${network.name} chainId=${chainId}`);
  console.log(`deployer=${deployerAddress}`);
  console.log(`admin=${adminSafe}`);

  const wxp = await deployContract("WXP");
  const factoryFactory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await factoryFactory.deploy(adminSafe);
  await factory.waitForDeployment();
  console.log(`UniswapV2Factory: ${await factory.getAddress()}`);

  const routerFactory = await ethers.getContractFactory("XphereV2Router02");
  const router = await routerFactory.deploy(await factory.getAddress(), await wxp.getAddress());
  await router.waitForDeployment();
  console.log(`XphereV2Router02: ${await router.getAddress()}`);

  const multicall = await deployContract("Multicall3Lite");

  const tokens: Record<string, string | null> = {
    ...(existingArtifact?.tokens || {}),
    xUSDC:
      optionalAddress(process.env.XPHERE_XUSDC_TOKEN, "XPHERE_XUSDC_TOKEN") ||
      optionalAddress(process.env.VITE_XPHERE_XUSDC, "VITE_XPHERE_XUSDC") ||
      existingArtifact?.tokens?.xUSDC ||
      null,
    xUSDT:
      optionalAddress(process.env.XPHERE_XUSDT_TOKEN, "XPHERE_XUSDT_TOKEN") ||
      optionalAddress(process.env.VITE_XPHERE_XUSDT, "VITE_XPHERE_XUSDT") ||
      existingArtifact?.tokens?.xUSDT ||
      null,
    xETH:
      optionalAddress(process.env.XPHERE_XETH_TOKEN, "XPHERE_XETH_TOKEN") ||
      optionalAddress(process.env.VITE_XPHERE_XETH, "VITE_XPHERE_XETH") ||
      existingArtifact?.tokens?.xETH ||
      null,
    XEF:
      optionalAddress(process.env.XPHERE_XEF_TOKEN, "XPHERE_XEF_TOKEN") ||
      optionalAddress(process.env.VITE_XPHERE_XEF, "VITE_XPHERE_XEF") ||
      existingArtifact?.tokens?.XEF ||
      null,
  };
  const mockTokenOwner = network.name === "xphereMainnet" ? adminSafe : deployerAddress;

  if (process.env.DEPLOY_MOCK_BRIDGED_TOKENS === "true") {
    const usdc = await deployContract("MintableERC20", [
      "Xphere Bridged USDC",
      "xUSDC",
      6,
      mockTokenOwner,
    ]);
    const usdt = await deployContract("MintableERC20", [
      "Xphere Bridged USDT",
      "xUSDT",
      6,
      mockTokenOwner,
    ]);
    tokens.xUSDC = await usdc.getAddress();
    tokens.xUSDT = await usdt.getAddress();
  }

  if (!tokens.XEF && process.env.DEPLOY_MOCK_XEF === "true") {
    const xef = await deployContract("MintableERC20", ["Xeffy", "XEF", 18, mockTokenOwner]);
    tokens.XEF = await xef.getAddress();
  }

  const artifact: DeploymentArtifact = {
    chainId,
    contracts: {
      ...(existingArtifact?.contracts || {}),
      wXP: await wxp.getAddress(),
      factory: await factory.getAddress(),
      router: await router.getAddress(),
      multicall3: await multicall.getAddress(),
    },
    tokens,
    router: await router.getAddress(),
    factory: await factory.getAddress(),
    initCodeHash: existingArtifact?.initCodeHash || null,
    bridgeRoutes: existingArtifact?.bridgeRoutes || {},
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, filename), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`wrote deployments/${filename}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
