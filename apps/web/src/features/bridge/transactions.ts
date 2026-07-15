import type { Address, Hash, Hex, Log, TransactionReceipt } from "viem";
import { decodeEventLog } from "viem";
import { mailboxAbi } from "../../lib/abis";
import type { BridgeAssetKey, BridgeChainKey } from "./config";

export type BridgeTransferStage =
  | "approval"
  | "submitted"
  | "sourceConfirmed"
  | "inTransit"
  | "delivered"
  | "failed"
  | "timeout";

export type PendingBridgeTransfer = {
  id: string;
  wallet: Address;
  asset: BridgeAssetKey;
  source: BridgeChainKey;
  destination: BridgeChainKey;
  amount: string;
  approvalHash?: Hash;
  sourceHash?: Hash;
  messageId?: Hex;
  stage: BridgeTransferStage;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "xphere-swap:bridge-transfers:v1";

export function sanitizeBridgeAmount(value: string, maxDecimals: number) {
  let next = value.replace(/[^0-9.]/g, "");
  const parts = next.split(".");
  if (parts.length > 2) next = `${parts[0]}.${parts.slice(1).join("")}`;
  if (next.startsWith(".")) next = `0${next}`;
  if (next.includes(".")) {
    const [whole, fraction = ""] = next.split(".");
    next = `${whole}.${fraction.slice(0, Math.max(0, maxDecimals))}`;
  }
  return next.replace(/^0+(\d)/, "$1");
}

export function bridgeTransactionValue(sourceIsNative: boolean, amount: bigint, gasQuote: bigint) {
  return sourceIsNative ? amount + gasQuote : gasQuote;
}

export function approvalRequired(allowance: bigint, amount: bigint) {
  return amount > 0n && allowance < amount;
}

export function hasSufficientBalance(balance: bigint | undefined, required: bigint) {
  return balance !== undefined && required > 0n && balance >= required;
}

export function hasSufficientDestinationCollateral(
  source: BridgeChainKey,
  available: bigint | undefined,
  amount: bigint,
) {
  return source !== "xphere" || (available !== undefined && amount > 0n && available >= amount);
}

export function requiredBridgeNativeBalance(
  sourceIsNative: boolean,
  amount: bigint,
  gasQuote: bigint,
  gasPrice: bigint,
  needsApproval: boolean,
) {
  const transferGas = 600_000n;
  const approvalGas = needsApproval ? 120_000n : 0n;
  return bridgeTransactionValue(sourceIsNative, amount, gasQuote) + gasPrice * (transferGas + approvalGas);
}

export function isQuoteFresh(quotedAt: number, now = Date.now(), maxAgeMs = 120_000) {
  return quotedAt > 0 && now >= quotedAt && now - quotedAt <= maxAgeMs;
}

export function parseDispatchId(receipt: Pick<TransactionReceipt, "logs">, mailbox?: Address): Hex | undefined {
  for (const log of receipt.logs) {
    if (mailbox && log.address.toLowerCase() !== mailbox.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: mailboxAbi,
        eventName: "DispatchId",
        data: log.data,
        topics: log.topics,
      });
      const messageId = decoded.args.messageId;
      if (messageId) return messageId;
    } catch {
      // Ignore unrelated logs.
    }
  }
  return undefined;
}

export function assertReceiptSucceeded<T extends Pick<TransactionReceipt, "status">>(receipt: T, hash: Hash): T {
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${shortHex(hash)}`);
  return receipt;
}

export function readPendingTransfers(wallet?: Address): PendingBridgeTransfer[] {
  if (!wallet || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as PendingBridgeTransfer[];
    return parsed
      .filter((transfer) => transfer.wallet.toLowerCase() === wallet.toLowerCase())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function writePendingTransfer(transfer: PendingBridgeTransfer) {
  if (typeof window === "undefined") return;
  const existing = readAllPendingTransfers();
  const next = [transfer, ...existing.filter((item) => item.id !== transfer.id)].slice(0, 20);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function readAllPendingTransfers(): PendingBridgeTransfer[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as PendingBridgeTransfer[];
  } catch {
    return [];
  }
}

export async function pollDelivery(
  delivered: (messageId: Hex) => Promise<boolean>,
  messageId: Hex,
  options: { intervalMs?: number; timeoutMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const intervalMs = options.intervalMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)));
  const startedAt = now();
  while (now() - startedAt <= timeoutMs) {
    if (await delivered(messageId)) return true;
    await sleep(intervalMs);
  }
  return false;
}

export function explorerTransactionUrl(explorer: string, hash: Hash) {
  return `${explorer.replace(/\/$/, "")}/tx/${hash}`;
}

export function shortHex(value: Hex | Hash | Address) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export type ReceiptLog = Log;
