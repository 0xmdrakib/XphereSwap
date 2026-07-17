import {
  Activity,
  ArrowDown,
  ArrowDownUp,
  Banknote,
  CheckCircle2,
  CircleAlert,
  Droplets,
  ExternalLink,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Address,
  Hash,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseEther,
  parseUnits,
  zeroAddress,
} from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { deployments, configuredForSwap } from "./config/deployments";
import {
  isLocalBridge,
  isLocalSwap,
  swapChain,
} from "./config/chains";
import { TokenConfig, xphereSwapTokens } from "./config/tokens";
import { BridgePanel } from "./features/bridge/BridgePanel";
import { bridgeConfigComplete, bridgeTransactionsEnabled } from "./features/bridge/config";
import { WalletButton } from "./features/wallet/WalletButton";
import {
  erc20Abi,
  uniswapV2FactoryAbi,
  uniswapV2PairAbi,
  uniswapV2RouterAbi,
  wxpAbi,
} from "./lib/abis";
import {
  applySlippage,
  deadlineTimestamp,
  formatTokenAmount,
  parseTokenAmount,
} from "./lib/amounts";

type Tab = "swap" | "liquidity" | "bridge" | "status";
type TxStatus = { kind: "idle" | "working" | "success" | "error"; text: string };
type LiquidityPoolState = {
  pair?: Address;
  reserveA: bigint;
  reserveB: bigint;
  totalSupply: bigint;
  lpBalance: bigint;
  balanceA?: bigint;
  balanceB?: bigint;
  loading: boolean;
};
type MarketPrices = {
  xpUsd?: number;
  xefUsd?: number;
  xpChange24h?: number;
  xefChange24h?: number;
  lastUpdatedAt?: number;
  loading: boolean;
};

const tabs: Array<{ id: Tab; label: string; icon: ElementType }> = [
  { id: "swap", label: "Swap", icon: ArrowDownUp },
  { id: "liquidity", label: "Liquidity", icon: Droplets },
  { id: "bridge", label: "Bridge", icon: Route },
  { id: "status", label: "Status", icon: Gauge },
];

const initialStatus: TxStatus = { kind: "idle", text: "" };
const NATIVE_XP_MAX_RESERVE = parseEther("0.02");
const LIQUIDITY_NATIVE_GAS_RESERVE = parseEther("0.1");
const XPHERE_DEFAULT_GAS_PRICE = 27_500_000_000n;
const XPHERE_MIN_REASONABLE_GAS_PRICE = 1_000_000_000n;
const XPHERE_MAX_REASONABLE_GAS_PRICE = 100_000_000_000n;
const XPHERE_GAS_LIMITS = {
  approve: 120_000n,
  swap: 550_000n,
  addLiquidity: 2_800_000n,
  removeLiquidity: 850_000n,
  wrap: 140_000n,
  unwrap: 160_000n,
} as const;
const COINGECKO_SIMPLE_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=xphere,xeffy&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true";
const CUSTOM_TOKENS_STORAGE_KEY = "xphere-swap:customTokens:v1";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("swap");
  const [customTokens, setCustomTokens] = useState<TokenConfig[]>(() => readStoredCustomTokens());
  const tokens = useMemo(() => dedupeTokens([...xphereSwapTokens, ...customTokens]), [customTokens]);

  useEffect(() => {
    setCustomTokens(readStoredCustomTokens());
  }, []);

  function addCustomToken(token: TokenConfig) {
    setCustomTokens((items) => {
      const next = dedupeTokens([token, ...items]);
      writeStoredCustomTokens(next);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/xphereswap-icon.png" alt="" aria-hidden="true" />
          <h1>Xphere Swap</h1>
        </div>
        <nav className="topnav" aria-label="Primary">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "topnav-link active" : "topnav-link"}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={16} strokeWidth={1.9} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <WalletButton />
        </div>
      </header>

      <section className="network-strip">
        <Metric icon={Activity} label="Swap chain" value={`${swapChain.name} (${swapChain.id})`} />
        <Metric icon={Droplets} label="Live AMM" value={configuredForSwap ? "WXP/XEF pool" : "Awaiting deploy"} />
      </section>

      <section className={activeTab === "swap" ? "workspace swap-workspace" : "workspace"}>
        <div className={activeTab === "swap" ? "primary-column swap-column" : "primary-column"}>
          {activeTab === "swap" && <SwapPanel tokens={tokens} />}
          {activeTab === "liquidity" && <LiquidityPanel tokens={tokens} />}
          {activeTab === "bridge" && <BridgePanel />}
          {activeTab === "status" && (
            <StatusPanel tokens={tokens} onAddToken={addCustomToken} />
          )}
        </div>
      </section>

      <footer className="site-footer">
        © 2026 Md. Rakib • made with love and passion.
      </footer>
    </main>
  );
}

function readStoredCustomTokens(): TokenConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredToken).filter(Boolean) as TokenConfig[];
  } catch {
    return [];
  }
}

function writeStoredCustomTokens(tokens: TokenConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_TOKENS_STORAGE_KEY, JSON.stringify(tokens.slice(0, 100)));
}

function normalizeStoredToken(value: unknown): TokenConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const token = value as Partial<TokenConfig>;
  if (!token.address || !isAddress(token.address)) return undefined;
  const chainId = Number(token.chainId);
  const decimals = Number(token.decimals);
  const symbol = String(token.symbol || "").trim();
  if (!chainId || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !symbol) return undefined;
  return {
    symbol,
    name: String(token.name || symbol),
    chainId,
    decimals,
    address: getAddress(token.address),
    verified: false,
    badge: "Imported",
  };
}

function dedupeTokens(tokens: TokenConfig[]) {
  const seen = new Set<string>();
  const out: TokenConfig[] = [];
  for (const token of tokens) {
    const key = token.native
      ? `${token.chainId}:native:${token.symbol}`
      : token.address
        ? `${token.chainId}:${token.address.toLowerCase()}`
        : `${token.chainId}:missing:${token.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function defaultCounterToken(tokens: TokenConfig[]) {
  return (
    tokens.find((token) => token.symbol === "XEF" && token.address)?.symbol ||
    tokens.find((token) => token.symbol !== "XP" && token.address)?.symbol ||
    "WXP"
  );
}

function Metric({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SwapPanel({ tokens }: { tokens: TokenConfig[] }) {
  const [tokenInSymbol, setTokenInSymbol] = useState("XP");
  const [tokenOutSymbol, setTokenOutSymbol] = useState(() => defaultCounterToken(tokens));
  const [amountIn, setAmountIn] = useState("");
  const [slippagePct, setSlippagePct] = useState("0.5");
  const [quote, setQuote] = useState<bigint>();
  const [routePath, setRoutePath] = useState<Address[]>([]);
  const [tokenInBalance, setTokenInBalance] = useState<bigint>();
  const [tokenOutBalance, setTokenOutBalance] = useState<bigint>();
  const [balanceNonce, setBalanceNonce] = useState(0);
  const [status, setStatus] = useState<TxStatus>(initialStatus);

  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: swapChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const tokenIn = tokens.find((token) => token.symbol === tokenInSymbol) ?? tokens[0];
  const tokenOut = tokens.find((token) => token.symbol === tokenOutSymbol) ?? tokens[1];
  const isSameUnderlying = Boolean(tokenIn?.address && tokenOut?.address && sameAddress(tokenIn.address, tokenOut.address));
  const isReady = Boolean(address && publicClient && deployments.xphere.router && tokenIn?.address && tokenOut?.address && !isSameUnderlying);
  const slippageBps = slippageToBps(slippagePct);
  const minReceived = quote ? applySlippage(quote, slippageBps) : undefined;
  const parsedAmountIn = tokenIn ? parseTokenAmount(amountIn, tokenIn.decimals) : 0n;
  const insufficientBalance = parsedAmountIn > 0n && tokenInBalance !== undefined && parsedAmountIn > tokenInBalance;

  useEffect(() => {
    let cancelled = false;

    async function loadBalances() {
      if (!address || !publicClient || !tokenIn?.address || !tokenOut?.address) {
        setTokenInBalance(undefined);
        setTokenOutBalance(undefined);
        return;
      }

      try {
        const [nextIn, nextOut] = await Promise.all([
          readTokenBalance(publicClient, address, tokenIn),
          readTokenBalance(publicClient, address, tokenOut),
        ]);
        if (!cancelled) {
          setTokenInBalance(nextIn);
          setTokenOutBalance(nextOut);
        }
      } catch {
        if (!cancelled) {
          setTokenInBalance(undefined);
          setTokenOutBalance(undefined);
        }
      }
    }

    loadBalances();
    const interval = window.setInterval(loadBalances, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [address, publicClient, tokenIn?.address, tokenIn?.native, tokenOut?.address, tokenOut?.native, balanceNonce]);

  async function ensureXphere() {
    if (chainId !== swapChain.id) await switchChainAsync({ chainId: swapChain.id });
  }

  async function wait(hash: Hash) {
    if (!publicClient) throw new Error("RPC client is unavailable");
    await waitForSuccess(publicClient, hash);
  }

  async function ensureAllowance(token: Address, spender: Address, amount: bigint) {
    if (!address || !publicClient) throw new Error("Wallet is not connected");
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, spender],
    });
    if (allowance >= amount) return;
    const hash = await writeContractAsync({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
      ...(await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.approve)),
    });
    await wait(hash);
  }

  function candidatePaths(): Address[][] {
    if (!tokenIn?.address || !tokenOut?.address) return [];
    if (sameAddress(tokenIn.address, tokenOut.address)) return [];
    const direct = [tokenIn.address, tokenOut.address] as Address[];
    const wxp = tokens.find((token) => token.symbol === "WXP" && token.address)?.address;
    if (!wxp || sameAddress(tokenIn.address, wxp) || sameAddress(tokenOut.address, wxp)) return [direct];
    return [direct, [tokenIn.address, wxp, tokenOut.address] as Address[]];
  }

  async function bestQuote(amount: bigint) {
    if (!publicClient || !deployments.xphere.router) throw new Error("Router is not configured");
    let best: { out: bigint; path: Address[] } | undefined;
    for (const path of candidatePaths()) {
      try {
        const amounts = await publicClient.readContract({
          address: deployments.xphere.router,
          abi: uniswapV2RouterAbi,
          functionName: "getAmountsOut",
          args: [amount, path],
        });
        const out = amounts[amounts.length - 1];
        if (!best || out > best.out) best = { out, path };
      } catch {
        // Keep trying alternate routes.
      }
    }
    if (!best) throw new Error("No pool/liquidity found for this pair");
    return best;
  }

  async function refreshQuote() {
    try {
      if (!tokenIn?.address || !tokenOut?.address) return;
      if (isSameUnderlying) throw new Error("Choose two different swap assets");
      const amount = parseTokenAmount(amountIn, tokenIn.decimals);
      if (amount === 0n) {
        setQuote(undefined);
        setRoutePath([]);
        return;
      }
      const best = await bestQuote(amount);
      setQuote(best.out);
      setRoutePath(best.path);
      setStatus({ kind: "idle", text: "" });
    } catch (error) {
      setQuote(undefined);
      setRoutePath([]);
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  async function executeSwap() {
    try {
      if (!address || !publicClient || !deployments.xphere.router || !tokenIn?.address || !tokenOut?.address) return;
      if (isSameUnderlying) throw new Error("Choose two different swap assets");
      const amount = parseTokenAmount(amountIn, tokenIn.decimals);
      if (amount === 0n) return;
      if (tokenInBalance !== undefined && amount > tokenInBalance) {
        throw new Error(`Insufficient ${tokenIn.symbol} balance`);
      }
      setStatus({ kind: "working", text: "Preparing swap" });
      await ensureXphere();
      const live = await bestQuote(amount);
      if (!tokenIn.native) {
        await ensureAllowance(tokenIn.address, deployments.xphere.router, amount);
      }
      setStatus({ kind: "working", text: "Submitting swap" });
      const amountOutMin = applySlippage(live.out, slippageBps);
      const txOptions = await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.swap);
      const hash = tokenIn.native
        ? await writeContractAsync({
            address: deployments.xphere.router,
            abi: uniswapV2RouterAbi,
            functionName: "swapExactETHForTokens",
            args: [amountOutMin, live.path, address, deadlineTimestamp()],
            value: amount,
            ...txOptions,
          })
        : tokenOut.native
          ? await writeContractAsync({
              address: deployments.xphere.router,
              abi: uniswapV2RouterAbi,
              functionName: "swapExactTokensForETH",
              args: [amount, amountOutMin, live.path, address, deadlineTimestamp()],
              ...txOptions,
            })
          : await writeContractAsync({
              address: deployments.xphere.router,
              abi: uniswapV2RouterAbi,
              functionName: "swapExactTokensForTokens",
              args: [amount, amountOutMin, live.path, address, deadlineTimestamp()],
              ...txOptions,
            });
      await wait(hash);
      setQuote(live.out);
      setRoutePath(live.path);
      setBalanceNonce((value) => value + 1);
      setStatus({ kind: "success", text: `Swap confirmed: ${hash.slice(0, 10)}...` });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  function useMaxInput() {
    if (!tokenIn || tokenInBalance === undefined) return;
    const maxAmount =
      tokenIn.native && tokenInBalance > NATIVE_XP_MAX_RESERVE
        ? tokenInBalance - NATIVE_XP_MAX_RESERVE
        : tokenIn.native
          ? 0n
          : tokenInBalance;
    setAmountIn(sanitizeDecimal(formatUnits(maxAmount, tokenIn.decimals), tokenIn.decimals));
    setQuote(undefined);
    setRoutePath([]);
    setStatus({ kind: "idle", text: "" });
  }

  return (
    <Panel title="Swap" badge={configuredForSwap ? "Xphere V2 AMM" : "Awaiting deployments"}>
      <div className="swap-card-grid">
        <TokenAmountBox
          label="You pay"
          tokens={tokens}
          tokenValue={tokenInSymbol}
          onTokenChange={setTokenInSymbol}
          amount={amountIn}
          onAmountChange={(value) => {
            setAmountIn(value);
            setQuote(undefined);
            setRoutePath([]);
          }}
          amountPlaceholder="0.00"
          balanceText={tokenIn ? balanceText(tokenInBalance, tokenIn) : undefined}
          onMax={useMaxInput}
        />
        <button
          className="switch-button"
          onClick={() => {
            setTokenInSymbol(tokenOutSymbol);
            setTokenOutSymbol(tokenInSymbol);
            setQuote(undefined);
            setRoutePath([]);
          }}
          title="Switch tokens"
        >
          <ArrowDown size={18} />
        </button>
        <TokenAmountBox
          label="You receive"
          tokens={tokens}
          tokenValue={tokenOutSymbol}
          onTokenChange={setTokenOutSymbol}
          amount={quote && tokenOut ? formatTokenAmount(quote, tokenOut.decimals) : ""}
          readOnly
          amountPlaceholder="0.00"
          balanceText={tokenOut ? balanceText(tokenOutBalance, tokenOut) : undefined}
        />
      </div>

      <div className="details-grid">
        <DetailCard label="Minimum received" value={minReceived && tokenOut ? `${formatTokenAmount(minReceived, tokenOut.decimals)} ${tokenOut.symbol}` : "-"} />
        <DetailCard label="Route" value={routePath.length ? routePathToSymbols(routePath, tokens) : "Direct or WXP"} />
        <label className="detail-card">
          <span className="detail-label">Slippage</span>
          <div className="inline-input">
            <input value={slippagePct} onChange={(event) => setSlippagePct(sanitizeDecimal(event.target.value, 2))} inputMode="decimal" />
            <span>%</span>
          </div>
        </label>
        <DetailCard label="LP fee" value="0.30%" />
      </div>
      {insufficientBalance ? (
        <div className="status-line error">
          <span>Insufficient {tokenIn?.symbol} balance for this swap amount.</span>
        </div>
      ) : null}
      {isSameUnderlying ? (
        <div className="status-line error">
          <span>Choose two different swap assets. Use Status to wrap or unwrap XP/WXP.</span>
        </div>
      ) : null}

      <div className="actions">
        <button className="secondary" onClick={refreshQuote} disabled={!isReady || tokenInSymbol === tokenOutSymbol}>
          <RefreshCw size={16} />
          Quote
        </button>
        <button onClick={executeSwap} disabled={!isReady || tokenInSymbol === tokenOutSymbol || insufficientBalance}>
          <ArrowDownUp size={16} />
          Swap
        </button>
      </div>
      <StatusLine status={status} />
    </Panel>
  );
}

function LiquidityPanel({ tokens }: { tokens: TokenConfig[] }) {
  const [tokenASymbol, setTokenASymbol] = useState("XP");
  const [tokenBSymbol, setTokenBSymbol] = useState(() => defaultCounterToken(tokens));
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState("0.5");
  const [lastEditedAmount, setLastEditedAmount] = useState<"A" | "B">("A");
  const [poolInfo, setPoolInfo] = useState<LiquidityPoolState>(() => emptyLiquidityPool(false));
  const [marketPrices, setMarketPrices] = useState<MarketPrices>({ loading: true });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [status, setStatus] = useState<TxStatus>(initialStatus);

  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: swapChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const tokenA = tokens.find((token) => token.symbol === tokenASymbol) ?? tokens[0];
  const tokenB = tokens.find((token) => token.symbol === tokenBSymbol) ?? tokens[1];
  const isSameUnderlying = Boolean(tokenA?.address && tokenB?.address && sameAddress(tokenA.address, tokenB.address));
  const nativeToken = tokenA?.native ? tokenA : tokenB?.native ? tokenB : undefined;
  const erc20Token = tokenA?.native ? tokenB : tokenA;
  const parsedA = tokenA ? parseTokenAmount(amountA, tokenA.decimals) : 0n;
  const parsedB = tokenB ? parseTokenAmount(amountB, tokenB.decimals) : 0n;
  const parsedLiquidity = parseTokenAmount(lpAmount, 18);
  const isReady = Boolean(
    address &&
      publicClient &&
      deployments.xphere.router &&
      deployments.xphere.factory &&
      tokenA?.address &&
      tokenB?.address &&
      !isSameUnderlying,
  );
  const slippageBps = slippageToBps(slippagePct);
  const expectedRemoveA =
    poolInfo.totalSupply > 0n && parsedLiquidity > 0n ? (poolInfo.reserveA * parsedLiquidity) / poolInfo.totalSupply : 0n;
  const expectedRemoveB =
    poolInfo.totalSupply > 0n && parsedLiquidity > 0n ? (poolInfo.reserveB * parsedLiquidity) / poolInfo.totalSupply : 0n;
  const minRemoveA = applySlippage(expectedRemoveA, slippageBps);
  const minRemoveB = applySlippage(expectedRemoveB, slippageBps);
  const insufficientA =
    parsedA > 0n &&
    poolInfo.balanceA !== undefined &&
    (tokenA.native ? parsedA + LIQUIDITY_NATIVE_GAS_RESERVE > poolInfo.balanceA : parsedA > poolInfo.balanceA);
  const insufficientB =
    parsedB > 0n &&
    poolInfo.balanceB !== undefined &&
    (tokenB.native ? parsedB + LIQUIDITY_NATIVE_GAS_RESERVE > poolInfo.balanceB : parsedB > poolInfo.balanceB);
  const insufficientAddBalance = insufficientA || insufficientB;
  const removeExceedsBalance = parsedLiquidity > 0n && parsedLiquidity > poolInfo.lpBalance;
  const suggestedB = poolInfo.reserveA > 0n && parsedA > 0n ? (parsedA * poolInfo.reserveB) / poolInfo.reserveA : 0n;
  const suggestedA = poolInfo.reserveB > 0n && parsedB > 0n ? (parsedB * poolInfo.reserveA) / poolInfo.reserveB : 0n;
  const addRatioMismatch = Boolean(
    poolInfo.pair &&
      poolInfo.reserveA > 0n &&
      poolInfo.reserveB > 0n &&
      parsedA > 0n &&
      parsedB > 0n &&
      suggestedB > 0n &&
      absDiff(parsedB, suggestedB) * 10_000n > suggestedB * slippageBps,
  );
  const marketReference = marketPriceText(tokenA, tokenB, marketPrices);
  const dexDeviation = dexDeviationText(poolInfo.reserveA, tokenA, poolInfo.reserveB, tokenB, marketPrices);

  useEffect(() => {
    let cancelled = false;

    async function loadMarketPrices() {
      setMarketPrices((current) => ({ ...current, loading: true }));
      try {
        const response = await fetch(COINGECKO_SIMPLE_PRICE_URL, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
        const data = await response.json();
        const xp = data?.xphere;
        const xef = data?.xeffy;
        if (!cancelled) {
          setMarketPrices({
            xpUsd: numericOrUndefined(xp?.usd),
            xefUsd: numericOrUndefined(xef?.usd),
            xpChange24h: numericOrUndefined(xp?.usd_24h_change),
            xefChange24h: numericOrUndefined(xef?.usd_24h_change),
            lastUpdatedAt: Math.max(Number(xp?.last_updated_at || 0), Number(xef?.last_updated_at || 0)) || undefined,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) setMarketPrices((current) => ({ ...current, loading: false }));
      }
    }

    loadMarketPrices();
    const interval = window.setInterval(loadMarketPrices, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);


  useEffect(() => {
    let cancelled = false;

    async function loadPoolInfo() {
      if (!publicClient || !deployments.xphere.factory || !tokenA?.address || !tokenB?.address || isSameUnderlying) {
        setPoolInfo(emptyLiquidityPool(false));
        return;
      }

      setPoolInfo((current) => ({ ...current, loading: true }));
      try {
        const [nextBalanceA, nextBalanceB] = address
          ? await Promise.all([
              readTokenBalance(publicClient, address, tokenA),
              readTokenBalance(publicClient, address, tokenB),
            ])
          : [undefined, undefined];
        const pair = (await publicClient.readContract({
          address: deployments.xphere.factory,
          abi: uniswapV2FactoryAbi,
          functionName: "getPair",
          args: [tokenA.address, tokenB.address],
        })) as Address;

        const next: LiquidityPoolState = {
          ...emptyLiquidityPool(false),
          balanceA: nextBalanceA,
          balanceB: nextBalanceB,
        };

        if (pair !== zeroAddress) {
          const [token0, reserves, totalSupply, lpBalance] = await Promise.all([
            publicClient.readContract({
              address: pair,
              abi: uniswapV2PairAbi,
              functionName: "token0",
              args: [],
            }) as Promise<Address>,
            publicClient.readContract({
              address: pair,
              abi: uniswapV2PairAbi,
              functionName: "getReserves",
              args: [],
            }),
            publicClient.readContract({
              address: pair,
              abi: uniswapV2PairAbi,
              functionName: "totalSupply",
              args: [],
            }) as Promise<bigint>,
            address
              ? (publicClient.readContract({
                  address: pair,
                  abi: uniswapV2PairAbi,
                  functionName: "balanceOf",
                  args: [address],
                }) as Promise<bigint>)
              : Promise.resolve(0n),
          ]);
          const reserve0 = reserves[0];
          const reserve1 = reserves[1];
          next.pair = pair;
          next.reserveA = sameAddress(tokenA.address, token0) ? reserve0 : reserve1;
          next.reserveB = sameAddress(tokenA.address, token0) ? reserve1 : reserve0;
          next.totalSupply = totalSupply;
          next.lpBalance = lpBalance;
        }

        if (!cancelled) setPoolInfo(next);
      } catch {
        if (!cancelled) setPoolInfo((current) => ({ ...current, loading: false }));
      }
    }

    loadPoolInfo();
    const interval = window.setInterval(loadPoolInfo, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    address,
    publicClient,
    tokenA?.address,
    tokenA?.native,
    tokenB?.address,
    tokenB?.native,
    isSameUnderlying,
    refreshNonce,
  ]);

  useEffect(() => {
    if (!tokenA || !tokenB || !poolInfo.pair || poolInfo.reserveA === 0n || poolInfo.reserveB === 0n) return;
    if (lastEditedAmount === "A") {
      if (parsedA === 0n) {
        if (amountB) setAmountB("");
        return;
      }
      const nextB = sanitizeDecimal(formatUnits((parsedA * poolInfo.reserveB) / poolInfo.reserveA, tokenB.decimals), tokenB.decimals);
      if (nextB !== amountB) setAmountB(nextB);
      return;
    }
    if (parsedB === 0n) {
      if (amountA) setAmountA("");
      return;
    }
    const nextA = sanitizeDecimal(formatUnits((parsedB * poolInfo.reserveA) / poolInfo.reserveB, tokenA.decimals), tokenA.decimals);
    if (nextA !== amountA) setAmountA(nextA);
  }, [
    amountA,
    amountB,
    lastEditedAmount,
    parsedA,
    parsedB,
    poolInfo.pair,
    poolInfo.reserveA,
    poolInfo.reserveB,
    tokenA?.decimals,
    tokenB?.decimals,
  ]);

  async function ensureXphere() {
    if (chainId !== swapChain.id) await switchChainAsync({ chainId: swapChain.id });
  }

  async function wait(hash: Hash) {
    if (!publicClient) throw new Error("RPC client is unavailable");
    await waitForSuccess(publicClient, hash);
  }

  async function approve(token: Address, spender: Address, amount: bigint) {
    if (!address || !publicClient) throw new Error("Wallet is not connected");
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, spender],
    });
    if (allowance >= amount) return;
    await wait(
      await writeContractAsync({
        address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
      ...(await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.approve)),
    }),
    );
  }

  async function addLiquidity() {
    try {
      if (!address || !publicClient || !deployments.xphere.router || !tokenA?.address || !tokenB?.address) return;
      if (parsedA === 0n || parsedB === 0n) return;
      if (isSameUnderlying) throw new Error("Choose two different liquidity assets");
      if (insufficientAddBalance) throw new Error("Insufficient balance. Keep about 0.1 XP free for network gas.");
      if (addRatioMismatch) throw new Error("Amounts do not match the current pool ratio. Let the app auto-fill the paired amount.");
      setStatus({ kind: "working", text: "Preparing liquidity" });
      await ensureXphere();
      if (!tokenA.native) await approve(tokenA.address, deployments.xphere.router, parsedA);
      if (!tokenB.native) await approve(tokenB.address, deployments.xphere.router, parsedB);
      setStatus({ kind: "working", text: "Submitting liquidity" });
      const txOptions = await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.addLiquidity);
      const hash =
        nativeToken && erc20Token?.address
          ? await writeContractAsync({
              address: deployments.xphere.router,
              abi: uniswapV2RouterAbi,
              functionName: "addLiquidityETH",
              args: [
                erc20Token.address,
                tokenA.native ? parsedB : parsedA,
                applySlippage(tokenA.native ? parsedB : parsedA, slippageBps),
                applySlippage(tokenA.native ? parsedA : parsedB, slippageBps),
                address,
                deadlineTimestamp(),
              ],
              value: tokenA.native ? parsedA : parsedB,
              ...txOptions,
            })
          : await writeContractAsync({
              address: deployments.xphere.router,
              abi: uniswapV2RouterAbi,
              functionName: "addLiquidity",
              args: [
                tokenA.address,
                tokenB.address,
                parsedA,
                parsedB,
                applySlippage(parsedA, slippageBps),
                applySlippage(parsedB, slippageBps),
                address,
                deadlineTimestamp(),
              ],
              ...txOptions,
            });
      await wait(hash);
      setAmountA("");
      setAmountB("");
      setRefreshNonce((value) => value + 1);
      setStatus({ kind: "success", text: `Liquidity confirmed: ${hash.slice(0, 10)}...` });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  async function removeLiquidity() {
    try {
      if (!address || !publicClient || !deployments.xphere.router || !deployments.xphere.factory || !tokenA?.address || !tokenB?.address) return;
      if (parsedLiquidity === 0n) return;
      if (isSameUnderlying) throw new Error("Choose two different liquidity assets");
      if (!poolInfo.pair) throw new Error("Pair does not exist");
      if (removeExceedsBalance) throw new Error("LP amount is higher than your LP balance");
      setStatus({ kind: "working", text: "Preparing removal" });
      await ensureXphere();
      await approve(poolInfo.pair, deployments.xphere.router, parsedLiquidity);
      setStatus({ kind: "working", text: "Removing liquidity" });
      const txOptions = await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.removeLiquidity);
      const hash =
        nativeToken && erc20Token?.address
          ? await writeContractAsync({
              address: deployments.xphere.router,
              abi: uniswapV2RouterAbi,
              functionName: "removeLiquidityETH",
              args: [
                erc20Token.address,
                parsedLiquidity,
                tokenA.native ? minRemoveB : minRemoveA,
                tokenA.native ? minRemoveA : minRemoveB,
                address,
                deadlineTimestamp(),
              ],
              ...txOptions,
            })
          : await writeContractAsync({
              address: deployments.xphere.router,
              abi: uniswapV2RouterAbi,
              functionName: "removeLiquidity",
              args: [tokenA.address, tokenB.address, parsedLiquidity, minRemoveA, minRemoveB, address, deadlineTimestamp()],
              ...txOptions,
            });
      await wait(hash);
      setLpAmount("");
      setRefreshNonce((value) => value + 1);
      setStatus({ kind: "success", text: `Removal confirmed: ${hash.slice(0, 10)}...` });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  function useMaxAddAmount(side: "A" | "B") {
    const token = side === "A" ? tokenA : tokenB;
    const balance = side === "A" ? poolInfo.balanceA : poolInfo.balanceB;
    if (!token || balance === undefined) return;
    const reserve = token.native ? LIQUIDITY_NATIVE_GAS_RESERVE : 0n;
    const maxAmount = balance > reserve ? balance - reserve : 0n;
    const value = sanitizeDecimal(formatUnits(maxAmount, token.decimals), token.decimals);
    setLastEditedAmount(side);
    if (side === "A") setAmountA(value);
    else setAmountB(value);
  }

  function setRemovePercent(percentBps: bigint) {
    if (poolInfo.lpBalance === 0n) return;
    const nextAmount = (poolInfo.lpBalance * percentBps) / 10_000n;
    setLpAmount(sanitizeDecimal(formatUnits(nextAmount, 18), 18));
  }

  return (
    <Panel title="Liquidity" badge="LP fee 0.30%">
      <div className="pool-summary">
        <div>
          <span>Selected pool</span>
          <strong>{tokenA?.symbol ?? "-"} / {tokenB?.symbol ?? "-"}</strong>
          <small>{poolInfo.loading ? "Refreshing pool data" : poolInfo.pair ? `Pair ${shortAddress(poolInfo.pair)}` : "No pool yet"}</small>
        </div>
        <button className="secondary icon-action" onClick={() => setRefreshNonce((value) => value + 1)} title="Refresh pool">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="liquidity-stats">
        <DetailCard label="Pool reserves" value={formatPairAmounts(poolInfo.reserveA, tokenA, poolInfo.reserveB, tokenB, poolInfo.loading)} />
        <DetailCard label="Wallet balance" value={walletBalanceText(address, poolInfo.loading, poolInfo.balanceA, tokenA)} />
        <DetailCard label="Wallet balance" value={walletBalanceText(address, poolInfo.loading, poolInfo.balanceB, tokenB)} />
        <DetailCard label="Your LP" value={`${formatTokenAmount(poolInfo.lpBalance, 18)} LP (${poolShareText(poolInfo.lpBalance, poolInfo.totalSupply)})`} />
        <DetailCard label="Pool value" value={poolUsdValueText(poolInfo.reserveA, tokenA, poolInfo.reserveB, tokenB, marketPrices)} />
      </div>

      <div className="liquidity-section">
        <div className="section-title-row">
          <h3>Add liquidity</h3>
          <span>{poolInfo.loading ? "Checking pool" : poolInfo.pair ? "Existing pool" : "Creates new pool"}</span>
        </div>
        <div className="form-grid">
          <TokenSelect label="Token A" tokens={tokens} value={tokenASymbol} onChange={setTokenASymbol} />
          <TokenSelect label="Token B" tokens={tokens} value={tokenBSymbol} onChange={setTokenBSymbol} />
          <label className="field">
            <span>Amount A</span>
            <input
              value={amountA}
              onChange={(event) => {
                setLastEditedAmount("A");
                setAmountA(sanitizeDecimal(event.target.value, tokenA?.decimals ?? 18));
              }}
              placeholder="0.00"
              inputMode="decimal"
            />
            <div className="field-meta">
              <span>{walletBalanceText(address, poolInfo.loading, poolInfo.balanceA, tokenA)}</span>
              <button type="button" className="pill-button" onClick={() => useMaxAddAmount("A")} disabled={poolInfo.balanceA === undefined}>
                Max
              </button>
            </div>
          </label>
          <label className="field">
            <span>Amount B</span>
            <input
              value={amountB}
              onChange={(event) => {
                setLastEditedAmount("B");
                setAmountB(sanitizeDecimal(event.target.value, tokenB?.decimals ?? 18));
              }}
              placeholder="0.00"
              inputMode="decimal"
            />
            <div className="field-meta">
              <span>{walletBalanceText(address, poolInfo.loading, poolInfo.balanceB, tokenB)}</span>
              <button type="button" className="pill-button" onClick={() => useMaxAddAmount("B")} disabled={poolInfo.balanceB === undefined}>
                Max
              </button>
            </div>
          </label>
        </div>
        <div className="details-grid compact-details">
          <label className="detail-card">
            <span className="detail-label">Slippage</span>
            <div className="inline-input">
              <input value={slippagePct} onChange={(event) => setSlippagePct(sanitizeDecimal(event.target.value, 2))} inputMode="decimal" />
              <span>%</span>
            </div>
          </label>
          <DetailCard label="Pool price" value={poolPriceText(poolInfo.reserveA, tokenA, poolInfo.reserveB, tokenB)} />
          <DetailCard label="Market reference" value={marketReference} />
          <DetailCard label="DEX vs market" value={dexDeviation} />
          <DetailCard label="Min token A" value={tokenA ? `${formatTokenAmount(applySlippage(parsedA, slippageBps), tokenA.decimals)} ${tokenA.symbol}` : "-"} />
          <DetailCard label="Min token B" value={tokenB ? `${formatTokenAmount(applySlippage(parsedB, slippageBps), tokenB.decimals)} ${tokenB.symbol}` : "-"} />
        </div>
      </div>
      <div className="actions">
        <button
          onClick={addLiquidity}
          disabled={!isReady || tokenASymbol === tokenBSymbol || isSameUnderlying || parsedA === 0n || parsedB === 0n || insufficientAddBalance || addRatioMismatch}
        >
          <Plus size={16} />
          Add liquidity
        </button>
      </div>
      <div className="divider" />

      <div className="liquidity-section">
        <div className="section-title-row">
          <h3>Remove liquidity</h3>
          <span>{poolShareText(poolInfo.lpBalance, poolInfo.totalSupply)} owned</span>
        </div>
        <div className="form-grid compact">
          <label className="field wide">
            <span>LP amount</span>
            <input value={lpAmount} onChange={(event) => setLpAmount(sanitizeDecimal(event.target.value, 18))} placeholder="0.00" inputMode="decimal" />
            <div className="field-meta">
              <span>{formatTokenAmount(poolInfo.lpBalance, 18)} LP available</span>
              <div className="quick-buttons">
                <button type="button" className="pill-button" onClick={() => setRemovePercent(2_500n)} disabled={poolInfo.lpBalance === 0n}>25%</button>
                <button type="button" className="pill-button" onClick={() => setRemovePercent(5_000n)} disabled={poolInfo.lpBalance === 0n}>50%</button>
                <button type="button" className="pill-button" onClick={() => setRemovePercent(7_500n)} disabled={poolInfo.lpBalance === 0n}>75%</button>
                <button type="button" className="pill-button" onClick={() => setRemovePercent(10_000n)} disabled={poolInfo.lpBalance === 0n}>Max</button>
              </div>
            </div>
          </label>
        </div>
        <div className="details-grid compact-details">
          <DetailCard label={`Expected ${tokenA?.symbol ?? "token A"}`} value={tokenA ? `${formatTokenAmount(expectedRemoveA, tokenA.decimals)} ${tokenA.symbol}` : "-"} />
          <DetailCard label={`Expected ${tokenB?.symbol ?? "token B"}`} value={tokenB ? `${formatTokenAmount(expectedRemoveB, tokenB.decimals)} ${tokenB.symbol}` : "-"} />
          <DetailCard label="Minimum out" value={tokenA && tokenB ? `${formatTokenAmount(minRemoveA, tokenA.decimals)} / ${formatTokenAmount(minRemoveB, tokenB.decimals)}` : "-"} />
        </div>
      </div>
      <div className="actions">
        <button
          className="secondary"
          onClick={removeLiquidity}
          disabled={!isReady || !poolInfo.pair || tokenASymbol === tokenBSymbol || isSameUnderlying || parsedLiquidity === 0n || removeExceedsBalance}
        >
          <Banknote size={16} />
          Remove liquidity
        </button>
      </div>
      {insufficientAddBalance ? (
        <div className="status-line error">
          <span>Insufficient balance. For XP liquidity, leave about 0.1 XP free for network gas.</span>
        </div>
      ) : null}
      {removeExceedsBalance ? (
        <div className="status-line error">
          <span>LP amount is higher than your LP balance.</span>
        </div>
      ) : null}
      {addRatioMismatch ? (
        <div className="status-line error">
          <span>Amounts do not match the current pool ratio. Edit either amount and the other side will auto-adjust.</span>
        </div>
      ) : null}
      {isSameUnderlying ? (
        <div className="status-line error">
          <span>Choose two different liquidity assets. Use Status to wrap or unwrap XP/WXP.</span>
        </div>
      ) : null}
      <StatusLine status={status} />
    </Panel>
  );
}

function StatusPanel({
  tokens,
  onAddToken,
}: {
  tokens: TokenConfig[];
  onAddToken: (token: TokenConfig) => void;
}) {
  const [tokenAddress, setTokenAddress] = useState("");
  const [wrapAmount, setWrapAmount] = useState("");
  const [status, setStatus] = useState<TxStatus>(initialStatus);
  const { address } = useAccount();
  const chainId = useChainId();
  const balance = useBalance({ address, chainId: swapChain.id });
  const publicClient = usePublicClient({ chainId: swapChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const explorerUrl = swapChain.blockExplorers?.default.url;

  async function ensureChain(targetChainId: number) {
    if (chainId !== targetChainId) await switchChainAsync({ chainId: targetChainId });
  }

  async function ensureSwapChain() {
    await ensureChain(swapChain.id);
  }

  async function wait(hash: Hash) {
    if (!publicClient) throw new Error("RPC client is unavailable");
    await waitForSuccess(publicClient, hash);
  }

  async function wrapXP() {
    try {
      if (!deployments.xphere.wxp || !publicClient) return;
      const parsedAmount = parseUnits(wrapAmount || "0", 18);
      if (parsedAmount === 0n) return;
      setStatus({ kind: "working", text: "Wrapping XP" });
      await ensureSwapChain();
      const hash = await writeContractAsync({
        address: deployments.xphere.wxp,
        abi: wxpAbi,
        functionName: "deposit",
        args: [],
        value: parsedAmount,
        ...(await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.wrap)),
      });
      await wait(hash);
      setWrapAmount("");
      await balance.refetch();
      setStatus({ kind: "success", text: `Wrapped XP: ${hash.slice(0, 10)}...` });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  async function unwrapXP() {
    try {
      if (!deployments.xphere.wxp || !publicClient) return;
      const parsedAmount = parseUnits(wrapAmount || "0", 18);
      if (parsedAmount === 0n) return;
      setStatus({ kind: "working", text: "Unwrapping WXP" });
      await ensureSwapChain();
      const hash = await writeContractAsync({
        address: deployments.xphere.wxp,
        abi: wxpAbi,
        functionName: "withdraw",
        args: [parsedAmount],
        ...(await xphereTxOptions(publicClient, XPHERE_GAS_LIMITS.unwrap)),
      });
      await wait(hash);
      setWrapAmount("");
      await balance.refetch();
      setStatus({ kind: "success", text: `Unwrapped WXP: ${hash.slice(0, 10)}...` });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  async function importToken() {
    try {
      if (!publicClient || !isAddress(tokenAddress)) return;
      const safeAddress = getAddress(tokenAddress);
      const [name, symbol, decimals] = await Promise.all([
        publicClient
          .readContract({
            address: safeAddress,
            abi: erc20Abi,
            functionName: "name",
            args: [],
          })
          .catch(() => ""),
        publicClient.readContract({
          address: safeAddress,
          abi: erc20Abi,
          functionName: "symbol",
          args: [],
        }),
        publicClient.readContract({
          address: safeAddress,
          abi: erc20Abi,
          functionName: "decimals",
          args: [],
        }),
      ]);
      const numericDecimals = Number(decimals);
      if (!Number.isInteger(numericDecimals) || numericDecimals < 0 || numericDecimals > 255) {
        throw new Error("Token returned invalid decimals");
      }
      const cleanSymbol = String(symbol || "").trim();
      if (!cleanSymbol) throw new Error("Token returned an empty symbol");
      if (tokens.some((token) => token.address?.toLowerCase() === safeAddress.toLowerCase())) {
        setStatus({ kind: "idle", text: "Token already listed" });
        return;
      }
      onAddToken({
        symbol: cleanSymbol,
        name: String(name || cleanSymbol),
        chainId: swapChain.id,
        decimals: numericDecimals,
        address: safeAddress,
        verified: false,
        badge: "Imported",
      });
      setTokenAddress("");
      setStatus({ kind: "success", text: `${cleanSymbol} imported` });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  return (
    <Panel title="Status" badge="Mainnet beta gated">
      <div className="status-grid">
        <ReadinessItem label="Swap contracts" ready={configuredForSwap} />
        <ReadinessItem label="XEF configured" ready={Boolean(deployments.xphere.xef)} />
        <ReadinessItem
          label="Bridge route records"
          ready={bridgeConfigComplete}
          readyText="Configured"
          blockedText="Not configured"
        />
        <ReadinessItem
          label="Bridge public state"
          ready={bridgeTransactionsEnabled}
          readyText="Released"
          blockedText="Not live"
        />
      </div>
      <div className="balance-line">
        <span>{swapChain.name} balance</span>
        <strong>
          {balance.data
            ? `${Number(formatEther(balance.data.value)).toFixed(4)} ${swapChain.nativeCurrency.symbol}`
            : `0 ${swapChain.nativeCurrency.symbol}`}
        </strong>
      </div>
      <div className="address-list">
        <AddressRow label="Router" value={deployments.xphere.router} />
        <AddressRow label="Factory" value={deployments.xphere.factory} />
        <AddressRow label="WXP" value={deployments.xphere.wxp} />
        <AddressRow label="xUSDC" value={deployments.xphere.xusdc} />
        <AddressRow label="xETH" value={deployments.xphere.xeth} />
        <AddressRow label="XEF" value={deployments.xphere.xef} />
        <AddressRow label={isLocalBridge ? "XP bridge" : "xETH bridge"} value={deployments.xphere.nativeWarpRouter} />
        <AddressRow label="ETH bridge" value={deployments.ethereum.nativeWarpRouter} externalUrl={undefined} />
      </div>
      <div className="divider" />
      <div className="form-grid compact">
        <label className="field wide">
          <span>Wrap amount</span>
          <input
            value={wrapAmount}
            onChange={(event) => setWrapAmount(sanitizeDecimal(event.target.value, 18))}
            placeholder={`0.00 ${swapChain.nativeCurrency.symbol}`}
            inputMode="decimal"
          />
        </label>
      </div>
      <div className="actions">
        <button className="secondary" onClick={wrapXP} disabled={!address || !deployments.xphere.wxp}>
          <Zap size={16} />
          Wrap XP
        </button>
        <button className="secondary" onClick={unwrapXP} disabled={!address || !deployments.xphere.wxp}>
          <Wallet size={16} />
          Unwrap WXP
        </button>
      </div>
      <div className="divider" />
      <div className="form-grid compact">
        <label className="field wide">
          <span>Token address</span>
          <input value={tokenAddress} onChange={(event) => setTokenAddress(event.target.value)} placeholder="0x..." />
        </label>
      </div>
      <div className="actions">
        <button className="secondary" onClick={importToken} disabled={!isAddress(tokenAddress)}>
          <Plus size={16} />
          Import token
        </button>
        {explorerUrl ? (
          <a className="link-button" href={explorerUrl} target="_blank" rel="noreferrer">
            Explorer <ExternalLink size={15} />
          </a>
        ) : null}
      </div>
      <StatusLine status={status} />
    </Panel>
  );
}

function ReadinessCard({ tokens }: { tokens: TokenConfig[] }) {
  return (
    <article className="rail-card">
      <div className="rail-head">
        <span>Readiness</span>
        <ShieldCheck size={17} />
      </div>
      <ReadinessItem label="Swap contracts" ready={configuredForSwap} compact />
      <ReadinessItem
        label="Bridge route records"
        ready={bridgeConfigComplete}
        readyText="Configured"
        blockedText="Not configured"
        compact
      />
      <ReadinessItem
        label="Bridge public state"
        ready={bridgeTransactionsEnabled}
        readyText="Released"
        blockedText="Not live"
        compact
      />
      <div className="token-strip">
        {tokens.map((token) => (
          <span key={`${token.symbol}-${token.address ?? "missing"}`} className={token.address ? "token-pill" : "token-pill muted"}>
            {token.symbol}
          </span>
        ))}
      </div>
    </article>
  );
}

function BridgeRoutesCard() {
  return (
    <article className="rail-card">
      <div className="rail-head">
        <span>Bridge Routes</span>
        <Route size={17} />
      </div>
      <RouteLine label="Ethereum/Base ETH <-> Xphere xETH" ready={bridgeConfigComplete} />
      <RouteLine label="Ethereum/Base USDC <-> Xphere xUSDC" ready={bridgeConfigComplete} />
      <RouteLine
        label="Public bridge state"
        ready={bridgeTransactionsEnabled}
        readyText="Released"
        blockedText="Not live"
      />
    </article>
  );
}

function RouteLine({
  label,
  ready,
  readyText = "Configured",
  blockedText = "Not configured",
}: {
  label: string;
  ready: boolean;
  readyText?: string;
  blockedText?: string;
}) {
  return (
    <div className="route-line">
      <span>{label}</span>
      <strong>{ready ? readyText : blockedText}</strong>
    </div>
  );
}

function Panel({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span>{badge}</span>
      </div>
      {children}
    </article>
  );
}

function TokenAmountBox({
  label,
  tokens,
  tokenValue,
  onTokenChange,
  amount,
  onAmountChange,
  amountPlaceholder,
  balanceText,
  onMax,
  readOnly,
}: {
  label: string;
  tokens: TokenConfig[];
  tokenValue: string;
  onTokenChange: (value: string) => void;
  amount: string;
  onAmountChange?: (value: string) => void;
  amountPlaceholder: string;
  balanceText?: string;
  onMax?: () => void;
  readOnly?: boolean;
}) {
  const token = tokens.find((item) => item.symbol === tokenValue);
  return (
    <div className="token-amount-box">
      <div className="asset-label-row">
        <span>{label}</span>
      </div>
      <div className="asset-input-row">
        <input
          value={amount}
          readOnly={readOnly}
          onChange={(event) => onAmountChange?.(sanitizeDecimal(event.target.value, token?.decimals ?? 18))}
          placeholder={amountPlaceholder}
          inputMode="decimal"
        />
        <TokenSelect label="" tokens={tokens} value={tokenValue} onChange={onTokenChange} compact />
      </div>
      <div className="asset-meta-row">
        <span>Balance: {balanceText ?? "-"}</span>
        {onMax && !readOnly ? (
          <button type="button" className="pill-button" onClick={onMax} disabled={!balanceText}>
            Max
          </button>
        ) : null}
      </div>
      {token?.note ? <small>{token.note}</small> : null}
    </div>
  );
}

function TokenSelect({
  label,
  tokens,
  value,
  onChange,
  compact,
}: {
  label: string;
  tokens: TokenConfig[];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "field compact-select" : "field"}>
      {label ? <span>{label}</span> : null}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {tokens.map((token) => (
          <option key={`${token.symbol}-${token.address ?? "missing"}`} value={token.symbol} disabled={!token.address}>
            {token.symbol}
          </option>
        ))}
      </select>
    </label>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-card">
      <span className="detail-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReadinessItem({
  label,
  ready,
  compact,
  readyText = "Ready",
  blockedText = "Blocked",
}: {
  label: string;
  ready: boolean;
  compact?: boolean;
  readyText?: string;
  blockedText?: string;
}) {
  return (
    <div className={ready ? `ready-item ok${compact ? " compact" : ""}` : `ready-item warn${compact ? " compact" : ""}`}>
      {ready ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
      <span>{label}</span>
      <strong>{ready ? readyText : blockedText}</strong>
    </div>
  );
}

function AddressRow({ label, value, externalUrl }: { label: string; value?: Address; externalUrl?: string }) {
  return (
    <div className="address-row">
      <span>{label}</span>
      {value && externalUrl ? (
        <a href={`${externalUrl.replace(/\/$/, "")}/address/${value}`} target="_blank" rel="noreferrer">
          {shortAddress(value)}
        </a>
      ) : (
        <code>{value ?? "not configured"}</code>
      )}
    </div>
  );
}

function StatusLine({ status }: { status: TxStatus }) {
  if (status.kind === "idle" || !status.text) return null;
  return (
    <div className={`status-line ${status.kind}`}>
      {status.kind === "working" ? <Loader2 className="spin" size={16} /> : null}
      <span>{status.text}</span>
    </div>
  );
}

function routePathToSymbols(path: Address[], tokens: TokenConfig[]) {
  return path
    .map((address) => tokens.find((token) => token.address && sameAddress(token.address, address))?.symbol ?? shortAddress(address))
    .join(" -> ");
}

function emptyLiquidityPool(loading: boolean): LiquidityPoolState {
  return {
    reserveA: 0n,
    reserveB: 0n,
    totalSupply: 0n,
    lpBalance: 0n,
    loading,
  };
}

async function xphereTxOptions(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  gas: bigint,
): Promise<{ gas: bigint; gasPrice?: bigint }> {
  if (isLocalSwap) return { gas };
  let gasPrice = XPHERE_DEFAULT_GAS_PRICE;
  try {
    const liveGasPrice = await publicClient.getGasPrice();
    if (liveGasPrice >= XPHERE_MIN_REASONABLE_GAS_PRICE && liveGasPrice <= XPHERE_MAX_REASONABLE_GAS_PRICE) {
      gasPrice = liveGasPrice;
    }
  } catch {
    // Use the known sane Xphere value when the RPC cannot report gas price.
  }
  return { gas, gasPrice };
}

async function readTokenBalance(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  wallet: Address,
  token: TokenConfig,
) {
  if (token.native) {
    return publicClient.getBalance({ address: wallet });
  }
  if (!token.address) return 0n;
  return publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet],
  }) as Promise<bigint>;
}

function balanceText(balance: bigint | undefined, token: TokenConfig) {
  if (balance === undefined) return undefined;
  return `${formatTokenAmount(balance, token.decimals)} ${token.symbol}`;
}

function walletBalanceText(address: Address | undefined, loading: boolean, balance: bigint | undefined, token: TokenConfig | undefined) {
  if (!token) return "-";
  if (!address) return "Connect wallet";
  const formatted = balanceText(balance, token);
  if (formatted) return formatted;
  return loading ? "Loading balance" : "Balance unavailable";
}

function formatPairAmounts(reserveA: bigint, tokenA: TokenConfig | undefined, reserveB: bigint, tokenB: TokenConfig | undefined, loading = false) {
  if (!tokenA || !tokenB) return "-";
  if (loading && reserveA === 0n && reserveB === 0n) return "Loading pool";
  if (reserveA === 0n && reserveB === 0n) return "No liquidity";
  return `${formatTokenAmount(reserveA, tokenA.decimals)} ${tokenA.symbol} / ${formatTokenAmount(reserveB, tokenB.decimals)} ${tokenB.symbol}`;
}

function poolShareText(lpBalance: bigint, totalSupply: bigint) {
  if (lpBalance === 0n || totalSupply === 0n) return "0%";
  const scaledPercent = (lpBalance * 1_000_000n) / totalSupply;
  if (scaledPercent === 0n) return "<0.0001%";
  const whole = scaledPercent / 10_000n;
  const fraction = (scaledPercent % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

function poolPriceText(reserveA: bigint, tokenA: TokenConfig | undefined, reserveB: bigint, tokenB: TokenConfig | undefined) {
  if (!tokenA || !tokenB || reserveA === 0n || reserveB === 0n) return "-";
  const scaled = (reserveB * 10n ** BigInt(tokenA.decimals) * 1_000_000n) / (reserveA * 10n ** BigInt(tokenB.decimals));
  const whole = scaled / 1_000_000n;
  const fraction = (scaled % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `1 ${tokenA.symbol} = ${whole}${fraction ? `.${fraction}` : ""} ${tokenB.symbol}`;
}

function marketPriceText(tokenA: TokenConfig | undefined, tokenB: TokenConfig | undefined, market: MarketPrices) {
  if (!tokenA || !tokenB) return "-";
  const priceA = tokenUsdPrice(tokenA, market);
  const priceB = tokenUsdPrice(tokenB, market);
  if (!priceA || !priceB) return market.loading ? "Loading market" : "Unavailable";
  return `1 ${tokenA.symbol} = ${formatCompactNumber(priceA / priceB)} ${tokenB.symbol}`;
}

function dexDeviationText(
  reserveA: bigint,
  tokenA: TokenConfig | undefined,
  reserveB: bigint,
  tokenB: TokenConfig | undefined,
  market: MarketPrices,
) {
  if (!tokenA || !tokenB || reserveA === 0n || reserveB === 0n) return "-";
  const priceA = tokenUsdPrice(tokenA, market);
  const priceB = tokenUsdPrice(tokenB, market);
  if (!priceA || !priceB) return market.loading ? "Loading market" : "Unavailable";
  const reserveANumber = Number(formatUnits(reserveA, tokenA.decimals));
  const reserveBNumber = Number(formatUnits(reserveB, tokenB.decimals));
  if (!reserveANumber || !reserveBNumber) return "-";
  const dexRate = reserveBNumber / reserveANumber;
  const marketRate = priceA / priceB;
  if (!marketRate) return "-";
  const deviation = ((dexRate - marketRate) / marketRate) * 100;
  const sign = deviation > 0 ? "+" : "";
  return `${sign}${deviation.toFixed(Math.abs(deviation) >= 100 ? 0 : 2)}%`;
}

function poolUsdValueText(
  reserveA: bigint,
  tokenA: TokenConfig | undefined,
  reserveB: bigint,
  tokenB: TokenConfig | undefined,
  market: MarketPrices,
) {
  if (!tokenA || !tokenB) return "-";
  const priceA = tokenUsdPrice(tokenA, market);
  const priceB = tokenUsdPrice(tokenB, market);
  if (!priceA || !priceB) return market.loading ? "Loading market" : "Unavailable";
  const value =
    Number(formatUnits(reserveA, tokenA.decimals)) * priceA +
    Number(formatUnits(reserveB, tokenB.decimals)) * priceB;
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2, minimumFractionDigits: 2 })}`;
}

function tokenUsdPrice(token: TokenConfig, market: MarketPrices) {
  if (token.symbol === "XP" || token.symbol === "WXP") return market.xpUsd;
  if (token.symbol === "XEF") return market.xefUsd;
  return undefined;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 6 : 8,
    minimumFractionDigits: 0,
  });
}

function numericOrUndefined(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function absDiff(a: bigint, b: bigint) {
  return a >= b ? a - b : b - a;
}

async function waitForSuccess(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  hash: Hash,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash.slice(0, 10)}...`);
  }
  return receipt;
}

function sameAddress(a: Address, b: Address) {
  return a.toLowerCase() === b.toLowerCase();
}

function sanitizeDecimal(value: string, maxDecimals: number) {
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

function slippageToBps(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50n;
  const clamped = Math.min(Math.max(n, 0.01), 50);
  return BigInt(Math.round(clamped * 100));
}

function shortAddress(value: Address | string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return "Transaction failed";
}
