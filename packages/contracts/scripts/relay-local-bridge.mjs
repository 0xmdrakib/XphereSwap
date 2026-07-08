import { ethers } from "ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const statePath = resolve(repoRoot, "deployments/local-bridge-relayer-state.json");

const PK =
  process.env.LOCAL_RELAYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const LOCAL_ETHEREUM_RPC = process.env.LOCAL_ETHEREUM_RPC_URL || "http://127.0.0.1:8546";
const LOCAL_XPHERE_RPC = process.env.LOCAL_XPHERE_RPC_URL || "http://127.0.0.1:8545";
const POLL_MS = Number(process.env.LOCAL_RELAYER_POLL_MS || 2500);

const bridgeAbi = [
  "function receiveRemote(bytes32,bytes32,address,uint256)",
  "function processedMessages(bytes32) view returns (bool)",
  "event TransferRemote(bytes32 indexed messageId,uint256 indexed nonce,uint32 indexed destinationDomain,address sender,bytes32 recipient,uint256 amount)",
];

function addressToBytes32(address) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function bytes32ToAddress(value) {
  return ethers.getAddress(`0x${value.slice(26)}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readState() {
  if (!existsSync(statePath)) return { processed: [] };
  return readJson(statePath);
}

async function writeState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function relayRoute({ label, sourceRouter, destinationRouter, sourceProvider, state, decimals = 6 }) {
  const latestBlock = await sourceProvider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - 5000);
  const events = await sourceRouter.queryFilter(sourceRouter.filters.TransferRemote(), fromBlock, latestBlock);
  let relayed = 0;
  let changed = false;

  for (const event of events) {
    const [messageId, , , sender, recipientBytes32, amount] = event.args;
    if (state.processed.includes(messageId)) continue;
    if (await destinationRouter.processedMessages(messageId)) {
      state.processed.push(messageId);
      changed = true;
      continue;
    }

    const recipient = bytes32ToAddress(recipientBytes32);
    const tx = await destinationRouter.receiveRemote(messageId, addressToBytes32(sender), recipient, amount);
    await tx.wait();
    state.processed.push(messageId);
    changed = true;
    relayed += 1;
    console.log(`${label}: relayed ${ethers.formatUnits(amount, decimals)} to ${recipient}`);
  }

  if (changed) {
    await writeState({ processed: [...new Set(state.processed)] });
  }
}

async function main() {
  const xphere = await readJson(resolve(repoRoot, "deployments/localhost.local.json"));
  const ethereum = await readJson(resolve(repoRoot, "deployments/local-ethereum.local.json"));

  const ethProvider = new ethers.JsonRpcProvider(LOCAL_ETHEREUM_RPC);
  const xpProvider = new ethers.JsonRpcProvider(LOCAL_XPHERE_RPC);
  const ethWallet = new ethers.NonceManager(new ethers.Wallet(PK, ethProvider));
  const xpWallet = new ethers.NonceManager(new ethers.Wallet(PK, xpProvider));

  const routes = [
    {
      label: "USDC ethereum->xphere",
      sourceRouter: new ethers.Contract(ethereum.contracts.usdcRouter, bridgeAbi, ethWallet),
      destinationRouter: new ethers.Contract(xphere.contracts.usdcBridgeRouter, bridgeAbi, xpWallet),
      sourceProvider: ethProvider,
      decimals: 6,
    },
    {
      label: "USDC xphere->ethereum",
      sourceRouter: new ethers.Contract(xphere.contracts.usdcBridgeRouter, bridgeAbi, xpWallet),
      destinationRouter: new ethers.Contract(ethereum.contracts.usdcRouter, bridgeAbi, ethWallet),
      sourceProvider: xpProvider,
      decimals: 6,
    },
    {
      label: "USDT ethereum->xphere",
      sourceRouter: new ethers.Contract(ethereum.contracts.usdtRouter, bridgeAbi, ethWallet),
      destinationRouter: new ethers.Contract(xphere.contracts.usdtBridgeRouter, bridgeAbi, xpWallet),
      sourceProvider: ethProvider,
      decimals: 6,
    },
    {
      label: "USDT xphere->ethereum",
      sourceRouter: new ethers.Contract(xphere.contracts.usdtBridgeRouter, bridgeAbi, xpWallet),
      destinationRouter: new ethers.Contract(ethereum.contracts.usdtRouter, bridgeAbi, ethWallet),
      sourceProvider: xpProvider,
      decimals: 6,
    },
    {
      label: "ETH ethereum->xphere XP",
      sourceRouter: new ethers.Contract(ethereum.contracts.nativeBridgeRouter, bridgeAbi, ethWallet),
      destinationRouter: new ethers.Contract(xphere.contracts.nativeBridgeRouter, bridgeAbi, xpWallet),
      sourceProvider: ethProvider,
      decimals: 18,
    },
    {
      label: "XP xphere->ethereum ETH",
      sourceRouter: new ethers.Contract(xphere.contracts.nativeBridgeRouter, bridgeAbi, xpWallet),
      destinationRouter: new ethers.Contract(ethereum.contracts.nativeBridgeRouter, bridgeAbi, ethWallet),
      sourceProvider: xpProvider,
      decimals: 18,
    },
  ];

  console.log(`Local bridge relayer running. Polling every ${POLL_MS}ms.`);
  while (true) {
    const state = await readState();
    for (const route of routes) {
      await relayRoute({ ...route, state });
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
