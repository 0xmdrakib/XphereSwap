import { ethers } from "hardhat";

const RPCS = [
  { name: "xphereMainnetHkg", url: "https://en-hkg.x-phere.com", expectedChainId: 20250217n },
  { name: "xphereMainnetBkk", url: "https://en-bkk.x-phere.com", expectedChainId: 20250217n },
  { name: "xphereTestnet", url: "https://testnet.x-phere.com", expectedChainId: 1998991n },
];

async function main() {
  for (const rpc of RPCS) {
    const provider = new ethers.JsonRpcProvider(rpc.url);
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    const feeData = await provider.getFeeData();

    if (network.chainId !== rpc.expectedChainId) {
      throw new Error(
        `${rpc.name} chainId mismatch: expected ${rpc.expectedChainId}, got ${network.chainId}`,
      );
    }

    console.log(
      `${rpc.name}: chainId=${network.chainId} block=${blockNumber} gasPrice=${feeData.gasPrice?.toString()}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
