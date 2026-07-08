import { Address, formatUnits, parseUnits } from "viem";

export const SLIPPAGE_BPS = 50n;
export const BPS_DENOMINATOR = 10_000n;
export const DEFAULT_DEADLINE_SECONDS = 20 * 60;

export function parseTokenAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!normalized) return 0n;
  const safe = normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
  if (!/^\d+(\.\d+)?$/.test(safe)) return 0n;
  try {
    return parseUnits(safe, decimals);
  } catch {
    return 0n;
  }
}

export function formatTokenAmount(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return "0";
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const clipped = fraction.slice(0, 6).replace(/0+$/, "");
  return clipped ? `${whole}.${clipped}` : whole;
}

export function applySlippage(value: bigint, slippageBps: bigint = SLIPPAGE_BPS): bigint {
  const bounded = slippageBps > 5_000n ? 5_000n : slippageBps;
  return (value * (BPS_DENOMINATOR - bounded)) / BPS_DENOMINATOR;
}

export function deadlineTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS);
}

export function addressToBytes32(address: Address): `0x${string}` {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}
