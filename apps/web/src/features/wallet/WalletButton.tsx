import { Loader2, Power, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Connector } from "wagmi";
import { useAccount, useConnect, useDisconnect } from "wagmi";

type RainbowKitDetails = {
  iconBackground?: string;
  iconUrl?: string | (() => Promise<string>);
  installed?: boolean;
  isRainbowKitConnector?: boolean;
  isWalletConnectModalConnector?: boolean;
};

type WalletConnector = Connector & {
  rkDetails?: RainbowKitDetails;
};

type WalletOption = {
  connector: Connector;
  icon?: string;
  iconBackground: string;
  name: string;
  priority: number;
  provider: unknown;
};

const preferredWalletNames = [
  "Rabby Wallet",
  "MetaMask",
  "Coinbase Wallet",
  "OKX Wallet",
  "Phantom",
  "Backpack",
  "SubWallet",
  "Rainbow",
  "Trust Wallet",
];

export function WalletButton() {
  const { address, chain, chainId, isConnected, isConnecting, isReconnecting } = useAccount();
  const {
    connectors,
    connectAsync,
    isPending: connectionPending,
  } = useConnect();
  const { disconnectAsync, isPending: disconnectPending } = useDisconnect();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [activeConnectorUid, setActiveConnectorUid] = useState<string>();
  const [walletError, setWalletError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const connectionPendingRef = useRef(connectionPending);

  const walletConnectConnector = useMemo(
    () =>
      connectors.find((connector) => {
        const details = (connector as WalletConnector).rkDetails;
        return details?.isWalletConnectModalConnector === true;
      }) ?? connectors.find((connector) => connector.id === "walletConnect"),
    [connectors],
  );

  useEffect(() => {
    connectionPendingRef.current = connectionPending;
  }, [connectionPending]);

  useEffect(() => {
    let cancelled = false;

    async function discoverWallets() {
      setDiscovering(true);
      const candidates = (
        await Promise.all(
          connectors.map(async (connector): Promise<WalletOption | undefined> => {
            const walletConnector = connector as WalletConnector;
            const details = walletConnector.rkDetails;
            if (details?.isWalletConnectModalConnector || connector.type === "walletConnect") return undefined;
            if (details?.installed === false) return undefined;

            const injectedConnector = connector.type === "injected";
            const explicitlyInstalled = details?.installed === true;
            if (!injectedConnector && !explicitlyInstalled) return undefined;

            const provider = await connector.getProvider().catch(() => undefined);
            if (!provider) return undefined;

            const icon = connector.icon ?? (await resolveIcon(details?.iconUrl));
            const knownWallet = explicitlyInstalled && details?.isRainbowKitConnector;
            const discoveredWallet = injectedConnector && !details?.isRainbowKitConnector;
            return {
              connector,
              icon,
              iconBackground: details?.iconBackground ?? "#ffffff",
              name: connector.name,
              priority: knownWallet ? 0 : discoveredWallet ? 1 : connector.name === "Browser Wallet" ? 3 : 2,
              provider,
            };
          }),
        )
      ).filter(Boolean) as WalletOption[];

      candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const aRank = preferredWalletNames.indexOf(a.name);
        const bRank = preferredWalletNames.indexOf(b.name);
        if (aRank !== -1 || bRank !== -1) {
          return (
            (aRank === -1 ? preferredWalletNames.length : aRank) -
            (bRank === -1 ? preferredWalletNames.length : bRank)
          );
        }
        return a.name.localeCompare(b.name) || a.connector.uid.localeCompare(b.connector.uid);
      });

      const seenProviders = new Set<unknown>();
      const seenWallets = new Set<string>();
      let unique = candidates.filter((option) => {
        const walletConnector = option.connector as WalletConnector;
        const rdns = walletConnector.rdns;
        const walletKey = `${Array.isArray(rdns) ? rdns.join("|") : rdns ?? ""}:${option.name.toLowerCase()}`;
        if (seenProviders.has(option.provider) || seenWallets.has(walletKey)) return false;
        seenProviders.add(option.provider);
        seenWallets.add(walletKey);
        return true;
      });

      if (unique.some((option) => option.name !== "Browser Wallet")) {
        unique = unique.filter((option) => option.name !== "Browser Wallet");
      }

      if (!cancelled) {
        setWalletOptions(unique);
        setDiscovering(false);
      }
    }

    discoverWallets();
    return () => {
      cancelled = true;
    };
  }, [connectors]);

  useEffect(() => {
    if (!chooserOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const animationFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const preferred = dialog?.querySelector<HTMLElement>(
        ".wallet-option:not(:disabled), .wallet-connect-option:not(:disabled)",
      );
      (preferred ?? dialog?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !connectionPendingRef.current) setChooserOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      (triggerRef.current ?? previousFocus)?.focus();
    };
  }, [chooserOpen]);

  function openChooser() {
    setWalletError("");
    setChooserOpen(true);
  }

  function closeChooser() {
    if (connectionPending) return;
    setChooserOpen(false);
    setWalletError("");
  }

  async function connectWallet(connector: Connector) {
    setWalletError("");
    setActiveConnectorUid(connector.uid);
    try {
      await connectAsync({ connector });
      setChooserOpen(false);
    } catch (error) {
      setWalletError(walletErrorText(error));
    } finally {
      setActiveConnectorUid(undefined);
    }
  }

  async function openWalletConnect() {
    if (!walletConnectConnector) {
      setWalletError("WalletConnect is unavailable. Check the public project configuration.");
      return;
    }

    setWalletError("");
    setActiveConnectorUid(walletConnectConnector.uid);
    setChooserOpen(false);
    try {
      await connectAsync({ connector: walletConnectConnector });
    } catch (error) {
      setWalletError(walletErrorText(error));
      setChooserOpen(true);
    } finally {
      setActiveConnectorUid(undefined);
    }
  }

  async function disconnectWallet() {
    if (disconnectPending) return;
    try {
      await disconnectAsync();
    } catch {
      // Keep the active account visible when the wallet rejects a disconnect request.
    }
  }

  const reconnecting = isConnecting || isReconnecting;
  const chooser =
    chooserOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="wallet-chooser-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeChooser();
            }}
          >
            <div
              ref={dialogRef}
              className="wallet-chooser"
              role="dialog"
              aria-modal="true"
              aria-labelledby="wallet-chooser-title"
              aria-describedby="wallet-chooser-description"
              aria-busy={connectionPending}
            >
              <div className="wallet-chooser-head">
                <div>
                  <h2 id="wallet-chooser-title">Choose wallet</h2>
                  <p id="wallet-chooser-description">Select an installed browser wallet to connect.</p>
                </div>
                <button
                  type="button"
                  className="wallet-chooser-close"
                  onClick={closeChooser}
                  disabled={connectionPending}
                  aria-label="Close wallet chooser"
                  title="Close"
                >
                  <X size={19} />
                </button>
              </div>

              <div className="wallet-option-list">
                {discovering ? (
                  <div className="wallet-detection-state">
                    <Loader2 className="spin" size={18} />
                    <span>Detecting browser wallets</span>
                  </div>
                ) : walletOptions.length ? (
                  walletOptions.map((option) => {
                    const pending = activeConnectorUid === option.connector.uid && connectionPending;
                    return (
                      <button
                        key={option.connector.uid}
                        type="button"
                        className="wallet-option"
                        onClick={() => connectWallet(option.connector)}
                        disabled={connectionPending}
                      >
                        <WalletIcon icon={option.icon} background={option.iconBackground} />
                        <span>
                          <strong>{option.name}</strong>
                          <small>{pending ? "Waiting for wallet" : "Browser extension"}</small>
                        </span>
                        {pending ? <Loader2 className="spin" size={18} /> : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="wallet-empty-state">
                    <Wallet size={21} />
                    <span>No installed browser wallet was detected.</span>
                  </div>
                )}
              </div>

              {walletError ? (
                <div className="wallet-error" role="alert">
                  {walletError}
                </div>
              ) : null}

              <div className="wallet-connect-section">
                <button
                  type="button"
                  className="wallet-connect-option"
                  onClick={openWalletConnect}
                  disabled={connectionPending || !walletConnectConnector}
                >
                  <span className="wallet-connect-icon">
                    {activeConnectorUid === walletConnectConnector?.uid && connectionPending ? (
                      <Loader2 className="spin" size={19} />
                    ) : (
                      <Wallet size={19} />
                    )}
                  </span>
                  <span>
                    <strong>WalletConnect</strong>
                    <small>Open WalletConnect</small>
                  </span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (isConnected && address) {
    const unsupportedNetwork = Boolean(chainId && !chain);
    return (
      <div
        className={`wallet-pill connected${unsupportedNetwork ? " warning" : ""}`}
        role="group"
        aria-label={
          unsupportedNetwork
            ? `Connected wallet ${shortAddress(address)} on an unsupported network`
            : `Connected wallet ${shortAddress(address)}`
        }
      >
        <span className="wallet-dot" />
        <code className="wallet-address">
          {unsupportedNetwork ? "Wrong network" : shortAddress(address)}
        </code>
        <button
          type="button"
          className="wallet-disconnect"
          onClick={disconnectWallet}
          disabled={disconnectPending}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
        >
          {disconnectPending ? <Loader2 className="spin" size={16} /> : <Power size={16} />}
        </button>
      </div>
    );
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="wallet-pill" onClick={openChooser} disabled={reconnecting}>
        {reconnecting ? <Loader2 className="spin" size={16} /> : <span className="wallet-dot" />}
        {reconnecting ? "Connecting" : "Connect Wallet"}
      </button>
      {chooser}
    </>
  );
}

function WalletIcon({ icon, background }: { icon?: string; background: string }) {
  const [failed, setFailed] = useState(false);
  if (!icon || failed) {
    return (
      <span className="wallet-option-icon wallet-option-icon-fallback">
        <Wallet size={20} />
      </span>
    );
  }

  return (
    <span className="wallet-option-icon" style={{ background }}>
      <img src={icon} alt="" aria-hidden="true" onError={() => setFailed(true)} />
    </span>
  );
}

async function resolveIcon(icon?: string | (() => Promise<string>)) {
  if (!icon) return undefined;
  try {
    return typeof icon === "function" ? await icon() : icon;
  } catch {
    return undefined;
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function walletErrorText(error: unknown) {
  if (!(error instanceof Error)) return "The wallet connection could not be completed.";
  const message = error.message.replace(/\s+/g, " ").trim();
  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "Connection request rejected in the wallet.";
  }
  return message.slice(0, 180) || "The wallet connection could not be completed.";
}
