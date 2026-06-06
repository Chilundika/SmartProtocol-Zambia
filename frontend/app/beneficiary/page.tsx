"use client";

import { useCallback, useState, type FormEvent } from "react";

import {
  buildSubmitProofTx,
  getEscrowState,
  StellarClientError,
  type EscrowState,
  type EscrowStatusOnChain,
} from "@/src/blockchain/stellarClient";
import {
  signAndSubmitTransaction,
  TransactionServiceError,
  type TransactionSubmitResult,
} from "@/src/blockchain/transactionService";
import { Navbar } from "@/src/components/Navbar";
import { useWallet } from "@/src/context/WalletContext";

const STROOPS_PER_XLM = BigInt(10_000_000);
const STELLAR_EXPERT_TESTNET_TX =
  "https://stellar.expert/explorer/testnet/tx" as const;

type ActionKey = "lookup" | "proof";

type FeedbackState =
  | { kind: "idle" }
  | { kind: "success"; action: ActionKey; result: TransactionSubmitResult }
  | {
      kind: "error";
      action: ActionKey;
      code: string;
      message: string;
      txHash?: string;
    };

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

function TransactionOverlay({
  visible,
  label,
}: {
  visible: boolean;
  label: string;
}) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/85 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-overlay-label"
    >
      <div className="w-full max-w-sm rounded-2xl border border-amber-700/50 bg-zinc-900 p-8 text-center shadow-2xl">
        <Spinner label={label} />
        <p
          id="tx-overlay-label"
          className="mt-4 text-xs leading-relaxed text-zinc-400"
        >
          Confirm the transaction in Freighter. Do not close this tab.
        </p>
      </div>
    </div>
  );
}

function FeedbackBanner({ feedback }: { feedback: FeedbackState }) {
  if (feedback.kind === "idle") {
    return null;
  }

  if (feedback.kind === "success") {
    const explorerUrl = `${STELLAR_EXPERT_TESTNET_TX}/${feedback.result.txHash}`;

    return (
      <div
        className="rounded-xl border-2 border-emerald-600/60 bg-emerald-950/50 p-4 sm:p-5"
        role="status"
        aria-live="polite"
      >
        <p className="text-base font-semibold text-emerald-200">
          Milestone proof submitted successfully
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Escrow status advanced to{" "}
          <span className="font-semibold text-emerald-300">Released</span>. The
          funder may now release payout to the vendor.
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          View on Stellar Expert
        </a>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border-2 border-red-700/60 bg-red-950/40 p-4 sm:p-5"
      role="alert"
      aria-live="assertive"
    >
      <p className="text-base font-semibold text-red-200">Action failed</p>
      <p className="mt-2 font-mono text-xs text-red-300">
        {feedback.code}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-200">
        {feedback.message}
      </p>
      {feedback.txHash ? (
        <a
          href={`${STELLAR_EXPERT_TESTNET_TX}/${feedback.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-red-300 underline underline-offset-2"
        >
          Inspect transaction
        </a>
      ) : null}
    </div>
  );
}

function statusBadgeClass(status: EscrowStatusOnChain): string {
  switch (status) {
    case "Locked":
      return "bg-zinc-700 text-white";
    case "Pending":
      return "bg-amber-500 text-zinc-950";
    case "Released":
      return "bg-emerald-600 text-white";
  }
}

function stroopsToXlmDisplay(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

function normalizeProofHash(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

function validateProofHash(proofHash: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(proofHash)) {
    throw new Error(
      "Proof hash must be 32 bytes encoded as 64 hexadecimal characters.",
    );
  }
}

/** Client-side 32-byte hex for live demos (guaranteed non-zero for contract MVP). */
function generateDemoProofHash(): string {
  const bytes = new Uint8Array(32);

  do {
    crypto.getRandomValues(bytes);
  } while (bytes.every((byte) => byte === 0));

  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function resolveActionError(
  action: ActionKey,
  error: unknown,
): Extract<FeedbackState, { kind: "error" }> {
  if (error instanceof TransactionServiceError) {
    return {
      kind: "error",
      action,
      code: error.code,
      message: error.message,
      txHash: error.txHash,
    };
  }

  if (error instanceof StellarClientError) {
    return {
      kind: "error",
      action,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      kind: "error",
      action,
      code: "UNKNOWN_ERROR",
      message: error.message,
    };
  }

  return {
    kind: "error",
    action,
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred.",
  };
}

function readinessMessage(
  exists: boolean | null,
  escrow: EscrowState | null,
): { tone: "neutral" | "ready" | "warn" | "done"; text: string } {
  if (exists === null) {
    return {
      tone: "neutral",
      text: "Run a delivery lookup to see if an escrow awaits your sign-off.",
    };
  }

  if (!exists) {
    return {
      tone: "warn",
      text: "No active escrow is registered for your wallet on testnet.",
    };
  }

  if (!escrow) {
    return { tone: "neutral", text: "Escrow record unavailable." };
  }

  switch (escrow.status) {
    case "Pending":
      return {
        tone: "ready",
        text: "Escrow is funded and waiting for your cryptographic sign-off.",
      };
    case "Locked":
      return {
        tone: "warn",
        text: "Escrow exists but is not yet funded. Sign-off unlocks after funding.",
      };
    case "Released":
      return {
        tone: "done",
        text: "Proof already submitted. Funder can release payout to the vendor.",
      };
  }
}

export default function BeneficiarySignoffPage() {
  const { isConnected, publicKey, isConnecting } = useWallet();

  const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
  const [escrowExists, setEscrowExists] = useState<boolean | null>(null);
  const [proofHash, setProofHash] = useState("");
  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });

  const walletReady = isConnected && publicKey !== null;
  const busy = isConnecting || loadingAction !== null;
  const signoffDisabled = !walletReady || busy;

  const readiness = readinessMessage(escrowExists, escrowState);
  const canSubmitProof =
    walletReady && escrowExists === true && escrowState?.status === "Pending";

  const refreshEscrowState = useCallback(async (beneficiary: string) => {
    const result = await getEscrowState(beneficiary, beneficiary);
    setEscrowExists(result.exists);
    setEscrowState(result.escrow ?? null);
    return result;
  }, []);

  const handleLookup = async () => {
    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "lookup",
        code: "WALLET_NOT_CONNECTED",
        message: "Connect your Freighter wallet to verify delivery status.",
      });
      return;
    }

    setLoadingAction("lookup");
    setFeedback({ kind: "idle" });

    try {
      await refreshEscrowState(publicKey);
    } catch (error) {
      setEscrowExists(null);
      setEscrowState(null);
      setFeedback(resolveActionError("lookup", error));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSubmitProof = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "proof",
        code: "WALLET_NOT_CONNECTED",
        message: "Connect your Freighter wallet before submitting proof.",
      });
      return;
    }

    setLoadingAction("proof");
    setFeedback({ kind: "idle" });

    try {
      const normalizedHash = normalizeProofHash(proofHash);
      validateProofHash(normalizedHash);

      const xdr = await buildSubmitProofTx(publicKey, normalizedHash);
      const result = await signAndSubmitTransaction(xdr);

      setFeedback({ kind: "success", action: "proof", result });
      await refreshEscrowState(publicKey);
    } catch (error) {
      setFeedback(resolveActionError("proof", error));
    } finally {
      setLoadingAction(null);
    }
  };

  const readinessToneClass = {
    neutral: "border-zinc-700 bg-zinc-900/80 text-zinc-300",
    ready: "border-amber-500/60 bg-amber-950/50 text-amber-100",
    warn: "border-orange-700/50 bg-orange-950/40 text-orange-100",
    done: "border-emerald-700/50 bg-emerald-950/40 text-emerald-100",
  }[readiness.tone];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/20 via-zinc-950 to-zinc-950" />

      <TransactionOverlay
        visible={loadingAction === "proof"}
        label="Submitting milestone proof…"
      />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:max-w-xl sm:px-6 sm:py-10">
          <header className="mb-8 text-center sm:text-left">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
              Beneficiary Sign-off
            </p>
            <h1 className="mt-2 text-2xl font-bold leading-tight text-white sm:text-3xl">
              Confirm delivery &amp; unlock funds
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Verify your escrow on Stellar testnet and submit cryptographic
              proof that milestones were met.
            </p>
          </header>

          <div className="mb-6 space-y-4">
            <FeedbackBanner feedback={feedback} />
          </div>

          <section
            className="mb-6 rounded-2xl border border-amber-800/40 bg-zinc-900/70 p-5 shadow-lg sm:p-6"
            aria-labelledby="verification-heading"
          >
            <h2
              id="verification-heading"
              className="text-lg font-semibold text-white"
            >
              Delivery verification
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Your connected wallet is the escrow beneficiary key on-chain.
            </p>

            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Connected wallet
              </p>
              {walletReady ? (
                <p className="mt-2 break-all font-mono text-sm leading-relaxed text-amber-200">
                  {publicKey}
                </p>
              ) : (
                <p className="mt-2 text-sm text-amber-200/90">
                  No wallet connected — use the button in the navbar.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleLookup}
              disabled={signoffDisabled}
              className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-base font-bold text-zinc-950 transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingAction === "lookup" ? (
                <Spinner label="Checking escrow…" />
              ) : (
                "Check delivery status"
              )}
            </button>

            <div
              className={`mt-5 rounded-xl border-2 p-4 ${readinessToneClass}`}
              role="status"
            >
              <p className="text-sm font-medium leading-relaxed">
                {readiness.text}
              </p>
            </div>

            {escrowExists && escrowState ? (
              <dl className="mt-5 grid gap-4 border-t border-zinc-800 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs font-semibold uppercase text-zinc-500">
                    Status
                  </dt>
                  <dd>
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusBadgeClass(escrowState.status)}`}
                    >
                      {escrowState.status}
                    </span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs font-semibold uppercase text-zinc-500">
                    Escrow balance
                  </dt>
                  <dd className="text-lg font-bold text-white">
                    {stroopsToXlmDisplay(escrowState.amount)}{" "}
                    <span className="text-sm font-normal text-zinc-500">
                      XLM
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-zinc-500">
                    Vendor
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs text-zinc-400">
                    {escrowState.vendor}
                  </dd>
                </div>
              </dl>
            ) : null}
          </section>

          <section
            className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-lg sm:p-6"
            aria-labelledby="signoff-heading"
          >
            <h2
              id="signoff-heading"
              className="text-lg font-semibold text-white"
            >
              Cryptographic sign-off
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Enter the 32-byte proof hash from your physical delivery
              confirmation key.
            </p>

            <form onSubmit={handleSubmitProof} className="mt-5 space-y-5">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="proof-hash"
                    className="text-sm font-semibold text-zinc-200"
                  >
                    Proof hash (hex)
                  </label>
                  <button
                    type="button"
                    onClick={() => setProofHash(generateDemoProofHash())}
                    disabled={loadingAction === "proof"}
                    className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Generate Demo Hash
                  </button>
                </div>
                <textarea
                  id="proof-hash"
                  value={proofHash}
                  onChange={(event) => setProofHash(event.target.value)}
                  disabled={signoffDisabled}
                  rows={4}
                  placeholder="64 hexadecimal characters (optional 0x prefix)"
                  className="w-full resize-y rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-describedby="proof-hash-hint"
                />
                <p id="proof-hash-hint" className="mt-2 text-xs text-zinc-500">
                  MVP accepts any non-zero 32-byte hash. Advances escrow from
                  Pending to Released.
                </p>
              </div>

              {!canSubmitProof && walletReady && escrowExists !== null ? (
                <p className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400">
                  Sign-off is only available when escrow status is{" "}
                  <span className="font-semibold text-amber-300">Pending</span>.
                </p>
              ) : null}

              <button
                type="submit"
                disabled={signoffDisabled || !canSubmitProof}
                className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-4 text-base font-bold text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm Receipt &amp; Unlock Funds
              </button>
            </form>
          </section>
        </main>

        <footer className="border-t border-zinc-800 py-5 text-center text-xs text-zinc-600">
          © {new Date().getFullYear()} SmartProtocol Zambia · Beneficiary
          sign-off
        </footer>
      </div>
    </div>
  );
}
