"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { useEmbeddedWallet } from "@/src/context/EmbeddedWalletContext";
import { WalletAuthError } from "@/src/lib/walletAuth";

function truncateLabel(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

function Spinner() {
  return (
    <span
      className="inline-block size-4 animate-spin rounded-full border-2 border-amber-200 border-t-white"
      aria-hidden
    />
  );
}

export function BeneficiaryWalletButton() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    isAuthenticated,
    activeNrc,
    isUnlocked,
    isBusy,
    unlockWithPin,
    signOut,
  } = useEmbeddedWallet();
  const [pin, setPin] = useState("");
  const [showPinInput, setShowPinInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (pathname.startsWith("/beneficiary/auth") || !isAuthenticated || !activeNrc) {
    return (
      <Link
        href="/beneficiary/auth"
        className="inline-flex min-w-[9.5rem] items-center justify-center rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-md shadow-amber-900/30 transition hover:bg-amber-500"
      >
        Log In
      </Link>
    );
  }

  const handleUnlock = async () => {
    setError(null);
    try {
      await unlockWithPin(pin);
      setPin("");
      setShowPinInput(false);
    } catch (unlockError) {
      if (unlockError instanceof WalletAuthError) {
        setError(unlockError.message);
      } else if (unlockError instanceof Error) {
        setError(unlockError.message);
      } else {
        setError("Unable to unlock wallet.");
      }
    }
  };

  if (isUnlocked) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-xs text-amber-200 sm:inline">
          {truncateLabel(activeNrc)}
        </span>
        <button
          type="button"
          onClick={() => {
            signOut();
            router.push("/beneficiary/auth");
          }}
          className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-950/60 px-4 py-2 text-sm font-medium text-amber-50 transition hover:border-amber-400 hover:bg-amber-900/80"
        >
          Sign Out
        </button>
      </div>
    );
  }

  if (showPinInput) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
            setError(null);
          }}
          placeholder="PIN"
          aria-label="4-digit PIN"
          className="w-16 rounded-full border border-amber-600/50 bg-zinc-900 px-3 py-2 text-center font-mono text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
        />
        <button
          type="button"
          onClick={() => void handleUnlock()}
          disabled={pin.length !== 4 || isBusy}
          className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isBusy ? <Spinner /> : "Unlock"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowPinInput(false);
            setPin("");
            setError(null);
          }}
          className="rounded-full px-2 py-2 text-xs text-zinc-400 hover:text-zinc-200"
          aria-label="Cancel unlock"
        >
          ✕
        </button>
        {error ? (
          <span className="sr-only" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowPinInput(true)}
      className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-md shadow-amber-900/30 transition hover:bg-amber-500"
    >
      Enter PIN to Unlock
    </button>
  );
}
