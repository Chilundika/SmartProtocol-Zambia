"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Navbar } from "@/src/components/Navbar";
import {
  useFunderAuth,
  WalletAuthError,
} from "@/src/context/FunderAuthContext";
import { useWallet } from "@/src/context/WalletContext";

type AuthMode = "login" | "signup";

function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 text-sm font-medium text-emerald-100"
      role="status"
      aria-live="polite"
    >
      <svg
        className="size-5 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export default function FunderAuthPage() {
  const router = useRouter();
  const { isReady, isAuthenticated, isBusy, signUp, login } = useFunderAuth();
  const {
    publicKey: freighterKey,
    isConnecting,
    connectWallet,
  } = useWallet();

  const [mode, setMode] = useState<AuthMode>("login");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      router.replace("/funder");
    }
  }, [isReady, isAuthenticated, router]);

  useEffect(() => {
    if (freighterKey && mode === "signup") {
      setPublicKey(freighterKey);
    }
  }, [freighterKey, mode]);

  const canSubmitLogin = email.trim().length >= 4 && pin.length === 4 && !isBusy;
  const canSubmitSignup =
    canSubmitLogin &&
    organizationName.trim().length >= 2 &&
    publicKey.trim().startsWith("G") &&
    !isConnecting;

  const handleCaptureFreighter = async () => {
    setError(null);
    try {
      await connectWallet();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect Freighter.",
      );
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === "signup") {
        await signUp({
          organizationName,
          email,
          pin,
          publicKey,
        });
      } else {
        await login(email, pin);
      }
      router.push("/funder");
    } catch (submitError) {
      if (submitError instanceof WalletAuthError) {
        setError(submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Authentication failed. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-zinc-950 to-zinc-950" />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:px-6">
          <header className="mb-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
              Funder Access
            </p>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              {mode === "login" ? "Log in" : "Register your organization"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Create an institutional account, link your official Freighter
              public key, then sign on-chain escrow actions with that wallet.
            </p>
          </header>

          <div className="mb-6 flex rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-emerald-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                mode === "signup"
                  ? "bg-emerald-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Create Account
            </button>
          </div>

          <section className="rounded-2xl border border-emerald-800/40 bg-zinc-900/70 p-5 shadow-lg sm:p-6">
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-5"
            >
              {mode === "signup" ? (
                <div>
                  <label
                    htmlFor="funder-org-name"
                    className="text-sm font-semibold text-zinc-200"
                  >
                    Organization name
                  </label>
                  <input
                    id="funder-org-name"
                    type="text"
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    disabled={isBusy}
                    placeholder="Ministry of Agriculture"
                    className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                  />
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="funder-email"
                  className="text-sm font-semibold text-zinc-200"
                >
                  Admin email / ID
                </label>
                <input
                  id="funder-email"
                  type="text"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isBusy}
                  placeholder="treasury@example.gov.zm"
                  autoComplete="username"
                  className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                />
              </div>

              {mode === "signup" ? (
                <div>
                  <label
                    htmlFor="funder-public-key"
                    className="text-sm font-semibold text-zinc-200"
                  >
                    Official Stellar public key
                  </label>
                  <input
                    id="funder-public-key"
                    type="text"
                    value={publicKey}
                    onChange={(event) => setPublicKey(event.target.value)}
                    disabled={isBusy}
                    placeholder="G…"
                    className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCaptureFreighter()}
                    disabled={isBusy || isConnecting}
                    className="mt-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                  >
                    {isConnecting ? "Connecting Freighter…" : "Capture from Freighter"}
                  </button>
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="funder-pin"
                  className="text-sm font-semibold text-zinc-200"
                >
                  4-digit PIN
                </label>
                <input
                  id="funder-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  disabled={isBusy}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                />
              </div>

              {error ? (
                <p
                  className="rounded-lg border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-200"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={mode === "signup" ? !canSubmitSignup : !canSubmitLogin}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-base font-bold text-zinc-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? (
                  mode === "signup" ? (
                    <Spinner label="Registering…" />
                  ) : (
                    <Spinner label="Logging in…" />
                  )
                ) : mode === "signup" ? (
                  "Create organization account"
                ) : (
                  "Log In"
                )}
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
