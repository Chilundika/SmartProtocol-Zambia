"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Navbar } from "@/src/components/Navbar";
import {
  useEmbeddedWallet,
  WalletAuthError,
} from "@/src/context/EmbeddedWalletContext";

type AuthMode = "login" | "signup";

function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 text-sm font-medium text-amber-100"
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

function AuthOverlay({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/85 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-overlay-label"
    >
      <div className="w-full max-w-sm rounded-2xl border border-amber-700/50 bg-zinc-900 p-8 text-center shadow-2xl">
        <Spinner label="Initializing and activating session wallet on Testnet…" />
        <p
          id="auth-overlay-label"
          className="mt-4 text-xs leading-relaxed text-zinc-400"
        >
          Funding your account via Friendbot. Do not close this tab.
        </p>
      </div>
    </div>
  );
}

export default function BeneficiaryAuthPage() {
  const router = useRouter();
  const { isAuthenticated, isBusy, signUp, login } = useEmbeddedWallet();

  const [mode, setMode] = useState<AuthMode>("login");
  const [nrc, setNrc] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/beneficiary");
    }
  }, [isAuthenticated, router]);

  const canSubmit =
    nrc.trim().length >= 6 && pin.length === 4 && !isBusy;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === "signup") {
        await signUp(nrc, pin);
      } else {
        await login(nrc, pin);
      }
      router.push("/beneficiary");
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
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/20 via-zinc-950 to-zinc-950" />

      <AuthOverlay visible={isBusy && mode === "signup"} />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:px-6">
          <header className="mb-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
              Beneficiary Access
            </p>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              {mode === "login" ? "Log in" : "Create account"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Sign in with your National Registration Card (NRC) number and
              4-digit PIN. No browser extension required.
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
                  ? "bg-amber-500 text-zinc-950"
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
                  ? "bg-amber-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Create Account
            </button>
          </div>

          <section className="rounded-2xl border border-amber-800/40 bg-zinc-900/70 p-5 shadow-lg sm:p-6">
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
              <div>
                <label
                  htmlFor="auth-nrc"
                  className="text-sm font-semibold text-zinc-200"
                >
                  NRC number
                </label>
                <input
                  id="auth-nrc"
                  type="text"
                  value={nrc}
                  onChange={(event) => setNrc(event.target.value)}
                  disabled={isBusy}
                  placeholder="123456/11/1"
                  autoComplete="username"
                  className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-pin"
                  className="text-sm font-semibold text-zinc-200"
                >
                  4-digit PIN
                </label>
                <input
                  id="auth-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  disabled={isBusy}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-white focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50"
                />
              </div>

              {error ? (
                <p className="rounded-lg border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-200" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-base font-bold text-zinc-950 transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? (
                  mode === "signup" ? (
                    <Spinner label="Registering…" />
                  ) : (
                    <Spinner label="Logging in…" />
                  )
                ) : mode === "signup" ? (
                  "Register"
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
