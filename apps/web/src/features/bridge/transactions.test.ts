import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, type Address, type Hash, type Hex } from "viem";
import { mailboxAbi } from "../../lib/abis";
import {
  approvalRequired,
  assertReceiptSucceeded,
  bridgeTransactionValue,
  explorerTransactionUrl,
  hasSufficientBalance,
  hasSufficientDestinationCollateral,
  isQuoteFresh,
  parseDispatchId,
  pollDelivery,
  readPendingTransfers,
  requiredBridgeNativeBalance,
  sanitizeBridgeAmount,
  writePendingTransfer,
  type PendingBridgeTransfer,
} from "./transactions";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const otherWallet = "0x2222222222222222222222222222222222222222" as Address;
const mailbox = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"44".repeat(32)}` as Hash;
const messageId = `0x${"55".repeat(32)}` as Hex;

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bridge amounts and balances", () => {
  it("sanitizes decimal input without exceeding token precision", () => {
    expect(sanitizeBridgeAmount("00a1.23456789", 6)).toBe("1.234567");
    expect(sanitizeBridgeAmount(".5.2", 18)).toBe("0.52");
  });

  it("calculates native value, approval, and source gas requirements", () => {
    expect(bridgeTransactionValue(true, 10n, 2n)).toBe(12n);
    expect(bridgeTransactionValue(false, 10n, 2n)).toBe(2n);
    expect(approvalRequired(9n, 10n)).toBe(true);
    expect(approvalRequired(10n, 10n)).toBe(false);
    expect(requiredBridgeNativeBalance(false, 10n, 2n, 3n, true)).toBe(2n + 3n * 720_000n);
    expect(requiredBridgeNativeBalance(true, 10n, 2n, 3n, false)).toBe(12n + 3n * 600_000n);
  });

  it("rejects unavailable source balances and Xphere withdrawals without collateral", () => {
    expect(hasSufficientBalance(undefined, 1n)).toBe(false);
    expect(hasSufficientBalance(1n, 1n)).toBe(true);
    expect(hasSufficientDestinationCollateral("ethereum", undefined, 5n)).toBe(true);
    expect(hasSufficientDestinationCollateral("xphere", undefined, 5n)).toBe(false);
    expect(hasSufficientDestinationCollateral("xphere", 4n, 5n)).toBe(false);
    expect(hasSufficientDestinationCollateral("xphere", 5n, 5n)).toBe(true);
  });

  it("expires stale quotes", () => {
    expect(isQuoteFresh(1_000, 2_000, 1_500)).toBe(true);
    expect(isQuoteFresh(1_000, 3_000, 1_500)).toBe(false);
    expect(isQuoteFresh(3_000, 2_000, 1_500)).toBe(false);
  });
});

describe("bridge receipts and delivery", () => {
  it("parses DispatchId only from the selected Mailbox", () => {
    const topics = encodeEventTopics({
      abi: mailboxAbi,
      eventName: "DispatchId",
      args: { messageId },
    });
    const receipt = {
      logs: [{ address: mailbox, data: "0x", topics }],
    } as never;
    expect(parseDispatchId(receipt, mailbox)).toBe(messageId);
    expect(parseDispatchId(receipt, otherWallet)).toBeUndefined();
  });

  it("rejects reverted transaction receipts", () => {
    expect(() => assertReceiptSucceeded({ status: "reverted" }, hash)).toThrow("Transaction reverted");
    expect(assertReceiptSucceeded({ status: "success" }, hash).status).toBe("success");
  });

  it("polls through pending state and supports timeout recovery", async () => {
    let attempts = 0;
    let now = 0;
    const delivered = await pollDelivery(
      async () => {
        attempts += 1;
        return attempts === 3;
      },
      messageId,
      {
        intervalMs: 10,
        timeoutMs: 40,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    );
    expect(delivered).toBe(true);
    expect(attempts).toBe(3);

    now = 0;
    const timedOut = await pollDelivery(async () => false, messageId, {
      intervalMs: 10,
      timeoutMs: 20,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(timedOut).toBe(false);
  });
});

describe("pending transfer persistence", () => {
  it("persists stages, filters wallets, and keeps newest updates first", () => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    const base: PendingBridgeTransfer = {
      id: "one",
      wallet,
      asset: "eth",
      source: "ethereum",
      destination: "xphere",
      amount: "1",
      stage: "submitted",
      createdAt: 1,
      updatedAt: 1,
    };
    writePendingTransfer(base);
    writePendingTransfer({ ...base, stage: "sourceConfirmed", sourceHash: hash, messageId, updatedAt: 3 });
    writePendingTransfer({ ...base, id: "other", wallet: otherWallet, updatedAt: 4 });
    writePendingTransfer({ ...base, id: "two", updatedAt: 2 });

    const saved = readPendingTransfers(wallet);
    expect(saved.map((transfer) => transfer.id)).toEqual(["one", "two"]);
    expect(saved[0].stage).toBe("sourceConfirmed");
    expect(saved[0].messageId).toBe(messageId);
  });

  it("builds source explorer links", () => {
    expect(explorerTransactionUrl("https://etherscan.io/", hash)).toBe(`https://etherscan.io/tx/${hash}`);
  });
});
