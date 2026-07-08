import { ethers } from "hardhat";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const address = await deployer.getAddress();
  const xpBalance = await ethers.provider.getBalance(address);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`chainId=${chainId}`);
  console.log(`deployer=${address}`);
  console.log(`XP=${ethers.formatEther(xpBalance)}`);

  const xefAddress = process.env.XPHERE_XEF_TOKEN || process.env.VITE_XPHERE_XEF;
  if (!xefAddress) {
    console.log("XEF=not configured");
    return;
  }

  const xef = new ethers.Contract(xefAddress, ERC20_ABI, ethers.provider);
  const [balance, decimals, symbol] = await Promise.all([
    xef.balanceOf(address),
    xef.decimals(),
    xef.symbol(),
  ]);
  console.log(`${symbol}=${ethers.formatUnits(balance, decimals)} at ${xefAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
