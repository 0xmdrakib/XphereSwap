import { ArrowDown, ExternalLink, Loader2, RefreshCw, Route, Send, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Address, Hash, Hex } from "viem";
import { formatEther, formatUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, mailboxAbi, warpRouterAbi } from "../../lib/abis";
import { addressToBytes32, formatTokenAmount, parseTokenAmount } from "../../lib/amounts";
import {
  bridgeAssets,
  bridgeChains,
  bridgeConfigComplete,
  bridgeReleased,
  bridgeTransactionsEnabled,
  destinationOptions,
  routeConfigured,
  type BridgeAssetKey,
  type BridgeChainKey,
} from "./config";
import {
  bridgeTransactionValue,
  approvalRequired,
  assertReceiptSucceeded,
  explorerTransactionUrl,
  hasSufficientBalance,
  hasSufficientDestinationCollateral,
  isQuoteFresh,
  parseDispatchId,
  pollDelivery,
  readPendingTransfers,
  requiredBridgeNativeBalance,
  sanitizeBridgeAmount,
  shortHex,
  writePendingTransfer,
  type BridgeTransferStage,
  type PendingBridgeTransfer,
} from "./transactions";

type ViewStatus = { kind: "idle" | "working" | "success" | "error" | "warning"; text: string };
type GasQuote = { value: bigint; quotedAt: number; routeKey: string };

const idleStatus: ViewStatus = { kind: "idle", text: "" };

export function BridgePanel() {
  const [source, setSource] = useState<BridgeChainKey>("ethereum");
  const [destination, setDestination] = useState<BridgeChainKey>("xphere");
  const [assetKey, setAssetKey] = useState<BridgeAssetKey>("eth");
  const [amount, setAmount] = useState("");
  const [sourceBalance, setSourceBalance] = useState<bigint>();
  const [sourceNativeBalance, setSourceNativeBalance] = useState<bigint>();
  const [destinationAvailable, setDestinationAvailable] = useState<bigint>();
  const [gasQuote, setGasQuote] = useState<GasQuote>();
  const [status, setStatus] = useState<ViewStatus>(idleStatus);
  const [pending, setPending] = useState<PendingBridgeTransfer[]>([]);

  const { address } = useAccount();
  const connectedChainId = useChainId();
  const ethereumClient = usePublicClient({ chainId: bridgeChains.ethereum.chain.id });
  const baseClient = usePublicClient({ chainId: bridgeChains.base.chain.id });
  const xphereClient = usePublicClient({ chainId: bridgeChains.xphere.chain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const clients = {
    ethereum: ethereumClient,
    base: baseClient,
    xphere: xphereClient,
  };

  const asset = bridgeAssets[assetKey];
  const sourceConfig = asset.chain[source];
  const destinationConfig = asset.chain[destination];
  const sourceChain = bridgeChains[source];
  const destinationChain = bridgeChains[destination];
  const publicClient = clients[source];
  const destinationClient = clients[destination];
  const routeKey = `${source}:${destination}:${assetKey}`;
  const configured = routeConfigured(source, destination, assetKey);
  const parsedAmount = useMemo(() => {
    try {
      return parseTokenAmount(amount || "0", asset.decimals);
    } catch {
      return 0n;
    }
  }, [amount, asset.decimals]);
  const exceedsSourceBalance = sourceBalance !== undefined && parsedAmount > sourceBalance;
  const sourceBalanceReady = hasSufficientBalance(sourceBalance, parsedAmount);
  const exceedsDestinationLiquidity =
    source === "xphere" &&
    destinationAvailable !== undefined &&
    parsedAmount > destinationAvailable;
  const destinationCollateralReady = hasSufficientDestinationCollateral(
    source,
    destinationAvailable,
    parsedAmount,
  );
  const destinationCollateralUnavailable =
    source === "xphere" && parsedAmount > 0n && destinationAvailable === undefined;
  const quoteFresh = Boolean(gasQuote && gasQuote.routeKey === routeKey && isQuoteFresh(gasQuote.quotedAt));
  const canTransact =
    bridgeTransactionsEnabled &&
    configured &&
    Boolean(address && publicClient && destinationClient && parsedAmount > 0n) &&
    sourceBalanceReady &&
    destinationCollateralReady;

  useEffect(() => {
    const options = destinationOptions(source);
    if (!options.includes(destination)) setDestination(options[0]);
    setGasQuote(undefined);
    setStatus(idleStatus);
  }, [source, destination]);

  useEffect(() => {
    setGasQuote(undefined);
    setStatus(idleStatus);
  }, [assetKey, amount]);

  useEffect(() => {
    setPending(readPendingTransfers(address));
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    async function refreshBalances() {
      if (!address || !publicClient) {
        setSourceBalance(undefined);
        setSourceNativeBalance(undefined);
        setDestinationAvailable(undefined);
        return;
      }
      try {
        const nativeBalance = await publicClient.getBalance({ address });
        const balance = sourceConfig.native
          ? nativeBalance
          : sourceConfig.token
            ? await publicClient.readContract({
                address: sourceConfig.token,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [address],
              })
            : undefined;
        if (!cancelled) {
          setSourceBalance(balance);
          setSourceNativeBalance(nativeBalance);
        }

        if (source === "xphere" && destinationClient && destinationConfig.router) {
          const available = destinationConfig.native
            ? await destinationClient.getBalance({ address: destinationConfig.router })
            : destinationConfig.token
              ? await destinationClient.readContract({
                  address: destinationConfig.token,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [destinationConfig.router],
                })
              : undefined;
          if (!cancelled) setDestinationAvailable(available);
        } else if (!cancelled) {
          setDestinationAvailable(undefined);
        }
      } catch {
        if (!cancelled) {
          setSourceBalance(undefined);
          setSourceNativeBalance(undefined);
          setDestinationAvailable(undefined);
        }
      }
    }
    void refreshBalances();
    return () => {
      cancelled = true;
    };
  }, [
    address,
    publicClient,
    destinationClient,
    source,
    sourceConfig.native,
    sourceConfig.token,
    destinationConfig.native,
    destinationConfig.router,
    destinationConfig.token,
  ]);

  async function ensureSourceChain() {
    if (connectedChainId !== sourceChain.chain.id) {
      await switchChainAsync({ chainId: sourceChain.chain.id });
    }
  }

  async function quoteRemoteGas() {
    try {
      if (!bridgeTransactionsEnabled) throw new Error("Bridge is not live");
      if (!publicClient || !sourceConfig.router) throw new Error("Source route is not configured");
      await ensureSourceChain();
      const value = await publicClient.readContract({
        address: sourceConfig.router,
        abi: warpRouterAbi,
        functionName: "quoteGasPayment",
        args: [destinationChain.domain],
      });
      setGasQuote({ value, quotedAt: Date.now(), routeKey });
      setStatus({ kind: "success", text: "Fresh remote gas quote received" });
      return value;
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
      return undefined;
    }
  }

  async function updateTransfer(transfer: PendingBridgeTransfer, stage: BridgeTransferStage) {
    const next = { ...transfer, stage, updatedAt: Date.now() };
    writePendingTransfer(next);
    setPending(readPendingTransfers(address));
    return next;
  }

  async function trackDelivery(transfer: PendingBridgeTransfer) {
    const transferDestination = bridgeChains[transfer.destination];
    const transferClient = clients[transfer.destination];
    if (!transfer.messageId || !transferClient || !transferDestination.mailbox) {
      setStatus({ kind: "error", text: "Saved transfer is missing its destination Mailbox or message ID" });
      return;
    }
    let active = await updateTransfer(transfer, "inTransit");
    setStatus({ kind: "working", text: "Source confirmed. Waiting for destination delivery" });
    const delivered = await pollDelivery(
      async (messageId) =>
        transferClient.readContract({
          address: transferDestination.mailbox!,
          abi: mailboxAbi,
          functionName: "delivered",
          args: [messageId],
        }),
      active.messageId!,
    );
    active = await updateTransfer(active, delivered ? "delivered" : "timeout");
    setStatus(
      delivered
        ? { kind: "success", text: "Bridge message delivered on the destination chain" }
        : { kind: "warning", text: "Delivery is still pending. Use retry to continue checking" },
    );
  }

  async function executeBridge() {
    let transfer: PendingBridgeTransfer | undefined;
    try {
      if (!canTransact || !address || !publicClient || !sourceConfig.router) return;
      if (!gasQuote || !quoteFresh) throw new Error("Refresh the remote gas quote before bridging");
      if (!sourceConfig.native && sourceBalance !== undefined && sourceBalance < parsedAmount) {
        throw new Error("Token balance is too low");
      }
      await ensureSourceChain();

      let needsApproval = false;
      let allowance = 0n;
      if (!sourceConfig.native && sourceConfig.token) {
        allowance = await publicClient.readContract({
          address: sourceConfig.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, sourceConfig.router],
        });
        needsApproval = approvalRequired(allowance, parsedAmount);
      }
      const gasPrice = await publicClient.getGasPrice();
      const requiredNative = requiredBridgeNativeBalance(
        sourceConfig.native,
        parsedAmount,
        gasQuote.value,
        gasPrice,
        needsApproval,
      );
      if (sourceNativeBalance === undefined || sourceNativeBalance < requiredNative) {
        throw new Error(
          `Native ${sourceChain.chain.nativeCurrency.symbol} balance does not cover the bridge value and source gas`,
        );
      }

      transfer = {
        id: `${sourceChain.chain.id}:${address}:${Date.now()}`,
        wallet: address,
        asset: assetKey,
        source,
        destination,
        amount,
        stage: needsApproval ? "approval" : "submitted",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      writePendingTransfer(transfer);
      setPending(readPendingTransfers(address));

      if (!sourceConfig.native && sourceConfig.token) {
        if (needsApproval) {
          setStatus({ kind: "working", text: "Approval required" });
          const approvalHash = await writeContractAsync({
            address: sourceConfig.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [sourceConfig.router, parsedAmount],
          });
          await waitForSuccess(publicClient, approvalHash);
          transfer = { ...transfer, approvalHash };
          transfer = await updateTransfer(transfer, "approval");
        }
      }

      setStatus({ kind: "working", text: "Submitting bridge transaction" });
      const hash = await writeContractAsync({
        address: sourceConfig.router,
        abi: warpRouterAbi,
        functionName: "transferRemote",
        args: [destinationChain.domain, addressToBytes32(address), parsedAmount],
        value: bridgeTransactionValue(sourceConfig.native, parsedAmount, gasQuote.value),
      });
      transfer = { ...transfer, sourceHash: hash };
      transfer = await updateTransfer(transfer, "submitted");
      const receipt = await waitForSuccess(publicClient, hash);
      const messageId = parseDispatchId(receipt, sourceChain.mailbox);
      if (!messageId) throw new Error("Source confirmed, but the Hyperlane message ID was not found");
      transfer = { ...transfer, messageId };
      transfer = await updateTransfer(transfer, "sourceConfirmed");
      await trackDelivery(transfer);
    } catch (error) {
      if (transfer) await updateTransfer(transfer, "failed");
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  async function retryTransfer(transfer: PendingBridgeTransfer) {
    await trackDelivery(transfer);
  }

  const sourceBalanceText = address
    ? sourceBalance === undefined
      ? "Unavailable"
      : `${formatTokenAmount(sourceBalance, asset.decimals)} ${sourceConfig.symbol}`
    : "Connect wallet";
  const destinationLiquidityText =
    source === "xphere"
      ? destinationAvailable === undefined
        ? "Unavailable"
        : `${formatTokenAmount(destinationAvailable, asset.decimals)} ${destinationConfig.symbol}`
      : `Synthetic mint on ${destinationChain.chain.name}`;

  return (
    <article className="panel bridge-panel">
      <div className="panel-head">
        <h2>Bridge</h2>
        <span className={bridgeTransactionsEnabled ? "bridge-live" : "bridge-not-live"}>
          {bridgeTransactionsEnabled ? "Live" : "Not live"}
        </span>
      </div>

      <div className="bridge-preview-banner" role="status">
        <ShieldAlert size={18} />
        <div>
          <strong>{bridgeTransactionsEnabled ? "Bridge available" : "Bridge preview"}</strong>
          <span>
            {bridgeTransactionsEnabled
              ? "Verified Ethereum, Base, and Xphere routes are enabled."
              : "Ethereum and Base routes are prepared for team review. Transactions are disabled."}
          </span>
        </div>
      </div>

      <div className="bridge-chain-grid">
        <label className="field">
          <span>From</span>
          <select value={source} onChange={(event) => setSource(event.target.value as BridgeChainKey)}>
            {(Object.keys(bridgeChains) as BridgeChainKey[]).map((key) => (
              <option key={key} value={key}>{bridgeChains[key].chain.name}</option>
            ))}
          </select>
        </label>
        <div className="bridge-direction-icon"><ArrowDown size={18} /></div>
        <label className="field">
          <span>To</span>
          <select value={destination} onChange={(event) => setDestination(event.target.value as BridgeChainKey)}>
            {destinationOptions(source).map((key) => (
              <option key={key} value={key}>{bridgeChains[key].chain.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bridge-asset-switch" role="group" aria-label="Bridge asset">
        {(Object.keys(bridgeAssets) as BridgeAssetKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={assetKey === key ? "selected" : ""}
            onClick={() => setAssetKey(key)}
          >
            {bridgeAssets[key].label}
          </button>
        ))}
      </div>

      <div className="bridge-route-card">
        <div>
          <span>Send on {sourceChain.chain.name}</span>
          <strong>{sourceConfig.symbol}</strong>
          <small>{sourceConfig.native ? "Native asset" : "Token transfer"}</small>
        </div>
        <Route size={22} />
        <div>
          <span>Receive on {destinationChain.chain.name}</span>
          <strong>{destinationConfig.symbol}</strong>
          <small>Same connected wallet</small>
        </div>
      </div>

      <label className="bridge-amount-box">
        <span>Amount</span>
        <div>
          <input
            value={amount}
            onChange={(event) => setAmount(sanitizeBridgeAmount(event.target.value, asset.decimals))}
            placeholder="0.00"
            inputMode="decimal"
          />
          <strong>{sourceConfig.symbol}</strong>
        </div>
        <small>Balance: {sourceBalanceText}</small>
      </label>

      <div className="details-grid bridge-details">
        <Detail label="Remote gas" value={gasQuote ? `${formatEther(gasQuote.value)} native` : "Unavailable"} />
        <Detail label="Destination available" value={destinationLiquidityText} />
        <Detail label="Daily limit" value={asset.dailyCapLabel} />
        <Detail label="Aggregate TVL limit" value="$100,000" />
      </div>

      {!configured ? (
        <div className="status-line warning">
          <span>Route contracts are not deployed yet. Preview only.</span>
        </div>
      ) : null}
      {!bridgeReleased || !bridgeConfigComplete ? (
        <div className="status-line warning">
          <span>Bridge transactions remain locked until deployment, security verification, funding, and team review are complete.</span>
        </div>
      ) : null}
      {exceedsSourceBalance ? <div className="status-line error"><span>Amount exceeds the source balance.</span></div> : null}
      {exceedsDestinationLiquidity ? <div className="status-line error"><span>Destination collateral is not sufficient.</span></div> : null}
      {destinationCollateralUnavailable ? (
        <div className="status-line warning"><span>Destination collateral could not be verified.</span></div>
      ) : null}

      <div className="actions">
        <button className="secondary" onClick={quoteRemoteGas} disabled={!bridgeTransactionsEnabled || !configured}>
          <RefreshCw size={16} />
          Quote gas
        </button>
        <button onClick={executeBridge} disabled={!canTransact || !quoteFresh}>
          <Send size={16} />
          {bridgeTransactionsEnabled ? "Bridge" : "Bridge not live"}
        </button>
      </div>

      {status.kind !== "idle" && status.text ? (
        <div className={`status-line ${status.kind}`}>
          {status.kind === "working" ? <Loader2 className="spin" size={16} /> : null}
          <span>{status.text}</span>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <section className="bridge-activity">
          <div className="section-title-row">
            <h3>Recent transfers</h3>
            <span>{pending.length}</span>
          </div>
          {pending.slice(0, 3).map((transfer) => (
            <div className="bridge-transfer-row" key={transfer.id}>
              <div>
                <strong>{transfer.amount} {bridgeAssets[transfer.asset].label}</strong>
                <span>{bridgeChains[transfer.source].chain.name} to {bridgeChains[transfer.destination].chain.name}</span>
              </div>
              <div>
                {transfer.sourceHash ? (
                  <a
                    href={explorerTransactionUrl(bridgeChains[transfer.source].explorer, transfer.sourceHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHex(transfer.sourceHash)} <ExternalLink size={13} />
                  </a>
                ) : <span>Awaiting source transaction</span>}
                <span>{transfer.stage}</span>
                {transfer.messageId ? <span title={transfer.messageId}>Message {shortHex(transfer.messageId)}</span> : null}
              </div>
              {transfer.stage === "timeout" || transfer.stage === "inTransit" ? (
                <button className="icon-action secondary" title="Retry delivery check" onClick={() => retryTransfer(transfer)}>
                  <RefreshCw size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-card">
      <span className="detail-label">{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

async function waitForSuccess(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  hash: Hash,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return assertReceiptSucceeded(receipt, hash);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Bridge transaction failed";
}
