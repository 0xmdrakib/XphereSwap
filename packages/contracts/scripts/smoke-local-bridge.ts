import { ethers } from "hardhat";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DeploymentArtifact } from "./shared/config";

const LOCAL_ETHEREUM_RPC = process.env.LOCAL_ETHEREUM_RPC_URL || "http://127.0.0.1:8546";
const LOCAL_XPHERE_RPC = process.env.LOCAL_XPHERE_RPC_URL || "http://127.0.0.1:8545";
const LOCAL_ETHEREUM_DOMAIN = 31338;
const LOCAL_XPHERE_DOMAIN = 31337;

const erc20Abi = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const bridgeAbi = [
  "function transferRemote(uint32,bytes32,uint256) payable returns (bytes32)",
  "function receiveRemote(bytes32,bytes32,address,uint256)",
  "function processedMessages(bytes32) view returns (bool)",
  "event TransferRemote(bytes32 indexed messageId,uint256 indexed nonce,uint32 indexed destinationDomain,address sender,bytes32 recipient,uint256 amount)",
];

async function readArtifact(path: string): Promise<DeploymentArtifact> {
  return JSON.parse(await readFile(path, "utf8")) as DeploymentArtifact;
}

function addressToBytes32(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function bytes32ToAddress(value: string): string {
  return ethers.getAddress(`0x${value.slice(26)}`);
}

async function freshBalance(rpcUrl: string, address: string): Promise<bigint> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return BigInt(await provider.getBalance(address));
}

async function relayLastTransfer(sourceRouter: any, destinationRouter: any) {
  const events = await sourceRouter.queryFilter(sourceRouter.filters.TransferRemote(), 0, "latest");
  for (const event of events.reverse()) {
    if (!event || !("args" in event)) continue;
    const [messageId, , , sender, recipientBytes32, amount] = event.args;
    if (await destinationRouter.processedMessages(messageId)) {
      return { sender, recipient: bytes32ToAddress(recipientBytes32), amount };
    }
    await (
      await destinationRouter.receiveRemote(messageId, addressToBytes32(sender), bytes32ToAddress(recipientBytes32), amount)
    ).wait();
    return { sender, recipient: bytes32ToAddress(recipientBytes32), amount };
  }
  throw new Error("No unprocessed TransferRemote event found");
}

async function main() {
  const repoRoot = resolve(__dirname, "../../..");
  const xphere = await readArtifact(resolve(repoRoot, "deployments/localhost.local.json"));
  const ethereum = await readArtifact(resolve(repoRoot, "deployments/local-ethereum.local.json"));

  const ethProvider = new ethers.JsonRpcProvider(LOCAL_ETHEREUM_RPC);
  const xpProvider = new ethers.JsonRpcProvider(LOCAL_XPHERE_RPC);
  const ethRelayer = await ethProvider.getSigner(0);
  const xpRelayer = await xpProvider.getSigner(0);
  const ethUser = await ethProvider.getSigner(1);
  const xpUser = await xpProvider.getSigner(1);
  const ethAddress = await ethUser.getAddress();
  const xpAddress = await xpUser.getAddress();
  const nativeXphereRecipient = ethers.Wallet.createRandom().address;
  const nativeEthereumRecipient = ethers.Wallet.createRandom().address;

  const ethUsdc = new ethers.Contract(ethereum.tokens.USDC!, erc20Abi, ethUser);
  const xpUsdc = new ethers.Contract(xphere.tokens.xUSDC!, erc20Abi, xpUser);
  const ethUsdcRouterUser = new ethers.Contract(ethereum.contracts.usdcRouter, bridgeAbi, ethUser);
  const ethUsdcRouterOwner = new ethers.Contract(ethereum.contracts.usdcRouter, bridgeAbi, ethRelayer);
  const xpUsdcRouterUser = new ethers.Contract(xphere.contracts.usdcBridgeRouter, bridgeAbi, xpUser);
  const xpUsdcRouterOwner = new ethers.Contract(xphere.contracts.usdcBridgeRouter, bridgeAbi, xpRelayer);
  const ethNativeRouterUser = new ethers.Contract(ethereum.contracts.nativeBridgeRouter, bridgeAbi, ethUser);
  const ethNativeRouterOwner = new ethers.Contract(ethereum.contracts.nativeBridgeRouter, bridgeAbi, ethRelayer);
  const xpNativeRouterUser = new ethers.Contract(xphere.contracts.nativeBridgeRouter, bridgeAbi, xpUser);
  const xpNativeRouterOwner = new ethers.Contract(xphere.contracts.nativeBridgeRouter, bridgeAbi, xpRelayer);

  const amount = ethers.parseUnits("25", 6);
  const beforeXphere = BigInt(await xpUsdc.balanceOf(xpAddress));
  await (await ethUsdc.approve(ethereum.contracts.usdcRouter, amount)).wait();
  await (
    await ethUsdcRouterUser.transferRemote(LOCAL_XPHERE_DOMAIN, addressToBytes32(xpAddress), amount)
  ).wait();
  const inbound = await relayLastTransfer(ethUsdcRouterUser, xpUsdcRouterOwner);
  const afterXphere = BigInt(await xpUsdc.balanceOf(xpAddress));
  const minted = afterXphere - beforeXphere;
  if (minted !== amount) throw new Error(`Unexpected Xphere mint amount: ${minted}`);

  const beforeEthereum = BigInt(await ethUsdc.balanceOf(ethAddress));
  await (await xpUsdc.approve(xphere.contracts.usdcBridgeRouter, amount)).wait();
  await (
    await xpUsdcRouterUser.transferRemote(LOCAL_ETHEREUM_DOMAIN, addressToBytes32(ethAddress), amount)
  ).wait();
  const outbound = await relayLastTransfer(xpUsdcRouterUser, ethUsdcRouterOwner);
  const afterEthereum = BigInt(await ethUsdc.balanceOf(ethAddress));
  const released = afterEthereum - beforeEthereum;
  if (released !== amount) throw new Error(`Unexpected Ethereum release amount: ${released}`);

  const nativeAmount = ethers.parseEther("0.25");
  const beforeNativeXphere = await freshBalance(LOCAL_XPHERE_RPC, nativeXphereRecipient);
  await (
    await ethNativeRouterUser.transferRemote(LOCAL_XPHERE_DOMAIN, addressToBytes32(nativeXphereRecipient), nativeAmount, {
      value: nativeAmount,
    })
  ).wait();
  const nativeInbound = await relayLastTransfer(ethNativeRouterUser, xpNativeRouterOwner);
  const afterNativeXphere = await freshBalance(LOCAL_XPHERE_RPC, nativeXphereRecipient);
  const xpReceived = afterNativeXphere - beforeNativeXphere;
  if (xpReceived !== nativeAmount) throw new Error(`Unexpected XP release amount: ${xpReceived}`);

  const beforeNativeEthereum = await freshBalance(LOCAL_ETHEREUM_RPC, nativeEthereumRecipient);
  await (
    await xpNativeRouterUser.transferRemote(LOCAL_ETHEREUM_DOMAIN, addressToBytes32(nativeEthereumRecipient), nativeAmount, {
      value: nativeAmount,
    })
  ).wait();
  const nativeOutbound = await relayLastTransfer(xpNativeRouterUser, ethNativeRouterOwner);
  const afterNativeEthereum = await freshBalance(LOCAL_ETHEREUM_RPC, nativeEthereumRecipient);
  const ethReceived = afterNativeEthereum - beforeNativeEthereum;
  if (ethReceived !== nativeAmount) throw new Error(`Unexpected ETH release amount: ${ethReceived}`);

  console.log(
    JSON.stringify(
      {
        ethereumToXphere: {
          sender: inbound.sender,
          recipient: inbound.recipient,
          amount: ethers.formatUnits(minted, 6),
        },
        xphereToEthereum: {
          sender: outbound.sender,
          recipient: outbound.recipient,
          amount: ethers.formatUnits(released, 6),
        },
        nativeEthereumToXphere: {
          sender: nativeInbound.sender,
          recipient: nativeInbound.recipient,
          amount: ethers.formatEther(xpReceived),
          source: "ETH",
          destination: "XP",
        },
        nativeXphereToEthereum: {
          sender: nativeOutbound.sender,
          recipient: nativeOutbound.recipient,
          amount: ethers.formatEther(ethReceived),
          source: "XP",
          destination: "ETH",
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
