"use client";

import { useWallet } from "@/src/context/WalletContext";

function truncatePublicKey(key: string): string {
  if (key.length <= 8) return key;
  return `${key.slice(0, 1)}...${key.slice(-4)}`;
}

function Spinner() {
  return (
    <span
      className="inline-block size-4 animate-spin rounded-full border-2 border-emerald-200 border-t-white"
      aria-hidden
    />
  );
}

export function WalletConnectButton() {
  const { isConnected, publicKey, isConnecting, connectWallet, disconnectWallet } =
    useWallet();

  if (isConnected && publicKey) {
    return (
      <button
        type="button"
        onClick={disconnectWallet}
        className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-4 py-2 text-sm font-medium text-emerald-50 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        aria-label={`Disconnect wallet ${publicKey}`}
      >
        <span className="font-mono text-xs sm:text-sm">
          {truncatePublicKey(publicKey)}
        </span>
        <span className="hidden text-emerald-300/90 sm:inline">·</span>
        <span className="hidden sm:inline">Disconnect</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connectWallet()}
      disabled={isConnecting}
      className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
      aria-busy={isConnecting}
    >
      {isConnecting ? (
        <>
          <Spinner />
          <span>Connecting…</span>
        </>
      ) : (
        <span>Connect Freighter</span>
      )}
    </button>
  );
}
