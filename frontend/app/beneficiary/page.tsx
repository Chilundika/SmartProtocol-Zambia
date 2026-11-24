"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  buildSubmitProofTx,
  getEscrowState,
  StellarClientError,
  type EscrowState,
  type EscrowStatusOnChain,
} from "@/src/blockchain/stellarClient";
import {
  signAndSubmitWithKeypair,
  TransactionServiceError,
  type TransactionSubmitResult,
} from "@/src/blockchain/transactionService";
import { EscrowNotificationList } from "@/src/components/EscrowNotificationList";
import { Navbar } from "@/src/components/Navbar";
import { useEmbeddedWallet } from "@/src/context/EmbeddedWalletContext";
import { useEscrowLifecycleNotifications } from "@/src/hooks/useEscrowLifecycleNotifications";
import {
  canonicalEscrowAuditId,
  confirmedTransactionFeedback,
} from "@/src/lib/confirmedEscrow";
import { recordConfirmedEscrowTransaction } from "@/src/lib/transactionAudit";
import { WalletAuthError } from "@/src/lib/walletAuth";

const STROOPS_PER_XLM = BigInt(10_000_000);
const STELLAR_EXPERT_TESTNET_TX =
  "https://stellar.expert/explorer/testnet/tx" as const;

type ActionKey = "lookup" | "proof";

type FeedbackState =
  | { kind: "idle" }
  | {
      kind: "success";
      action: "proof";
      result: TransactionSubmitResult;
      auditWarning?: string;
      refreshWarning?: string;
    }
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
  hint = "Do not close this tab.",
}: {
  visible: boolean;
  label: string;
  hint?: string;
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
          {hint}
        </p>
      </div>
    </div>
  );
}

function PinModal({
  visible,
  title,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");

  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/90 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <form
        className="w-full max-w-sm rounded-2xl border border-amber-700/50 bg-zinc-900 p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (pin.length === 4) {
            onSubmit(pin);
          }
        }}
      >
        <h2
          id="pin-modal-title"
          className="text-lg font-semibold text-white"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Enter your 4-digit PIN to sign this transaction locally on your
          device.
        </p>

        <input
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          value={pin}
          onChange={(event) =>
            setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
          }
          autoFocus
          placeholder="••••"
          aria-label="4-digit PIN"
          className="mt-5 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-white focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />

        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pin.length !== 4 || busy}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing…" : submitLabel}
          </button>
        </div>
      </form>
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
        {feedback.auditWarning ? (
          <p className="mt-3 text-xs leading-relaxed text-amber-200" role="status">
            Transaction succeeded, but the audit record could not be saved: {" "}
            {feedback.auditWarning}
          </p>
        ) : null}
        {feedback.refreshWarning ? (
          <p className="mt-3 text-xs leading-relaxed text-amber-200" role="status">
            {feedback.refreshWarning}
          </p>
        ) : null}
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
      <p className="mt-2 font-mono text-xs text-red-300">{feedback.code}</p>
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

  if (error instanceof WalletAuthError) {
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

function parseEscrowIdInput(raw: string): number {
  const trimmed = raw.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Escrow ID must be a positive whole number.");
  }

  const escrowId = Number(trimmed);

  if (!Number.isSafeInteger(escrowId) || escrowId <= 0) {
    throw new Error("Escrow ID must be a safe positive integer.");
  }

  return escrowId;
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
      text: "No escrow found for this ID on testnet. Confirm the ID with your funder.",
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
  const router = useRouter();
  const {
    isReady,
    isAuthenticated,
    activeNrc,
    publicKey,
    isUnlocked,
    keypair,
    isBusy: walletBusy,
    signOut,
    deleteAccount,
    unlockWithPin,
  } = useEmbeddedWallet();

  const [escrowId, setEscrowId] = useState("");
  const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
  const [escrowExists, setEscrowExists] = useState<boolean | null>(null);
  const [proofHash, setProofHash] = useState("");
  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinModalError, setPinModalError] = useState<string | null>(null);
  const [pendingProofHash, setPendingProofHash] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/beneficiary/auth");
    }
  }, [isReady, isAuthenticated, router]);

  const walletReady = isAuthenticated && publicKey !== null;
  const busy = walletBusy || loadingAction !== null;
  const signoffDisabled = !walletReady || busy;

  const readiness = readinessMessage(escrowExists, escrowState);
  const canSubmitProof =
    walletReady &&
    escrowId.trim() !== "" &&
    escrowExists === true &&
    escrowState?.status === "Pending";

  const refreshEscrowState = useCallback(
    async (escrowIdInput: string, beneficiary: string) => {
      const parsedEscrowId = parseEscrowIdInput(escrowIdInput);
      const result = await getEscrowState(parsedEscrowId, beneficiary);
      setEscrowExists(result.exists);
      setEscrowState(result.escrow ?? null);
      return result;
    },
    [],
  );

  const handleCopyPublicKey = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      setCopiedKey(false);
    }
  };

  const handleLookup = async () => {
    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "lookup",
        code: "WALLET_NOT_FOUND",
        message: "Log in to verify delivery status.",
      });
      return;
    }

    if (!escrowId.trim()) {
      setFeedback({
        kind: "error",
        action: "lookup",
        code: "MISSING_ESCROW_ID",
        message: "Enter the Escrow ID provided by your funder.",
      });
      return;
    }

    setLoadingAction("lookup");
    setFeedback({ kind: "idle" });

    try {
      const result = await refreshEscrowState(escrowId, publicKey);
      if (
        result.exists &&
        result.escrow &&
        result.escrow.recipient !== publicKey
      ) {
        setFeedback({
          kind: "error",
          action: "lookup",
          code: "NOT_AUTHORIZED",
          message:
            "This escrow belongs to a different beneficiary address. Check the Escrow ID.",
        });
      }
    } catch (error) {
      setEscrowExists(null);
      setEscrowState(null);
      setFeedback(resolveActionError("lookup", error));
    } finally {
      setLoadingAction(null);
    }
  };

  const submitProofWithKeypair = async (
    normalizedHash: string,
    signingKeypair: NonNullable<typeof keypair>,
  ) => {
    if (!publicKey) return;

    const parsedEscrowId = parseEscrowIdInput(escrowId);

    setLoadingAction("proof");
    setFeedback({ kind: "idle" });

    try {
      const xdr = await buildSubmitProofTx(
        parsedEscrowId,
        publicKey,
        normalizedHash,
      );
      const result = await signAndSubmitWithKeypair(xdr, signingKeypair);
      const escrowIdForAudit = canonicalEscrowAuditId(parsedEscrowId);
      let auditError: unknown;

      try {
        await recordConfirmedEscrowTransaction({
          operation: "submit_proof",
          escrowId: escrowIdForAudit,
          result,
        });
      } catch (error) {
        auditError = error;
        console.error("[beneficiary] transaction audit recording failed", error);
      }

      const recorded = confirmedTransactionFeedback({ auditError });
      setFeedback({
        kind: "success",
        action: "proof",
        result,
        auditWarning: recorded.auditWarning,
      });

      try {
        await refreshEscrowState(escrowIdForAudit, publicKey);
      } catch (refreshError) {
        console.error(
          "[beneficiary] post-confirmation status refresh failed",
          refreshError,
        );
        const followedUp = confirmedTransactionFeedback({
          auditError,
          refreshError,
        });
        setFeedback({
          kind: "success",
          action: "proof",
          result,
          auditWarning: followedUp.auditWarning,
          refreshWarning: followedUp.refreshWarning,
        });
      }
    } catch (error) {
      setFeedback(resolveActionError("proof", error));
    } finally {
      setLoadingAction(null);
      setShowPinModal(false);
      setPendingProofHash(null);
      setPinModalError(null);
    }
  };

  const handleSubmitProof = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "proof",
        code: "WALLET_NOT_FOUND",
        message: "Log in before submitting proof.",
      });
      return;
    }

    if (!escrowId.trim()) {
      setFeedback({
        kind: "error",
        action: "proof",
        code: "MISSING_ESCROW_ID",
        message: "Enter the Escrow ID provided by your funder.",
      });
      return;
    }

    try {
      const normalizedHash = normalizeProofHash(proofHash);
      validateProofHash(normalizedHash);

      if (isUnlocked && keypair) {
        void submitProofWithKeypair(normalizedHash, keypair);
        return;
      }

      setPendingProofHash(normalizedHash);
      setPinModalError(null);
      setShowPinModal(true);
    } catch (error) {
      setFeedback(resolveActionError("proof", error));
    }
  };

  const handlePinModalSubmit = async (pin: string) => {
    setPinModalError(null);

    try {
      let signingKeypair = keypair;

      if (!signingKeypair) {
        if (!activeNrc) {
          throw new Error("No active session. Please log in again.");
        }
        // One verify-pin round trip. Unlocking used to run twice here, which
        // burned two lockout attempts per wrong PIN.
        signingKeypair = await unlockWithPin(pin);
      }

      if (!pendingProofHash) {
        throw new Error("No proof hash pending for submission.");
      }

      await submitProofWithKeypair(pendingProofHash, signingKeypair);
    } catch (error) {
      if (error instanceof WalletAuthError) {
        setPinModalError(error.message);
      } else if (error instanceof Error) {
        setPinModalError(error.message);
      } else {
        setPinModalError("Unable to sign transaction.");
      }
    }
  };

  const handleSignOut = () => {
    signOut();
    router.push("/beneficiary/auth");
  };

  const closeDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeletePin("");
    setDeleteError(null);
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);
    setDeleteBusy(true);

    try {
      await deleteAccount(deletePin);
      closeDeleteConfirm();
      router.push("/beneficiary/auth");
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Unable to delete this account.",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const escrowNotifications = useEscrowLifecycleNotifications({
    escrowId,
    sourceAddress: publicKey,
  });

  if (!isReady || !isAuthenticated) {
    return null;
  }

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
        hint="Submitting your signed transaction to Stellar testnet. Do not close this tab."
      />

      <PinModal
        visible={showPinModal}
        title="Enter PIN to sign"
        submitLabel="Sign & Submit"
        busy={loadingAction === "proof"}
        error={pinModalError}
        onSubmit={(pin) => void handlePinModalSubmit(pin)}
        onCancel={() => {
          setShowPinModal(false);
          setPendingProofHash(null);
          setPinModalError(null);
        }}
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
              proof that milestones were met — no browser extension required.
            </p>
          </header>

          <EscrowNotificationList notifications={escrowNotifications} />

          <div className="mb-6 space-y-4">
            <FeedbackBanner feedback={feedback} />
          </div>

          <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-lg sm:p-6">
            <h2 className="text-lg font-semibold text-white">Your account</h2>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  NRC number
                </dt>
                <dd className="mt-1 font-mono text-sm text-amber-200">
                  {activeNrc}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Public key
                </dt>
                <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                  {publicKey}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleCopyPublicKey()}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
              >
                {copiedKey ? "Copied!" : "Copy public key"}
              </button>
              <span
                className={`self-center text-xs font-medium ${isUnlocked ? "text-emerald-400" : "text-amber-400"}`}
              >
                {isUnlocked ? "Unlocked" : "Locked — unlock via navbar"}
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-3 border-t border-zinc-800 pt-5">
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                Sign Out
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-950/70"
              >
                Delete Account
              </button>
            </div>
            {showDeleteConfirm ? (
              <div className="mt-4 rounded-xl border border-red-800/50 bg-red-950/30 p-4">
                <p className="text-sm text-red-100">
                  Delete this NRC account from the shared registry? This cannot
                  be undone.
                </p>
                <label
                  htmlFor="delete-pin"
                  className="mt-4 block text-xs font-semibold uppercase tracking-wide text-red-200"
                >
                  Confirm with your 4-digit PIN
                </label>
                <input
                  id="delete-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={deletePin}
                  onChange={(event) =>
                    setDeletePin(
                      event.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  disabled={deleteBusy}
                  autoComplete="current-password"
                  className="mt-2 w-full max-w-50 rounded-lg border-2 border-red-900/70 bg-zinc-950 px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-white focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:opacity-50"
                />
                {deleteError ? (
                  <p
                    className="mt-3 rounded-lg border border-red-700/60 bg-red-950/60 px-3 py-2 text-sm text-red-100"
                    role="alert"
                  >
                    {deleteError}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={closeDeleteConfirm}
                    disabled={deleteBusy}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount()}
                    disabled={deleteBusy || deletePin.length !== 4}
                    className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deleteBusy ? "Deleting…" : "Confirm Delete"}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <>
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
                  Enter the Escrow ID from your funder and verify delivery for
                  that specific escrow.
                </p>

                <div className="mt-5">
                  <label
                    htmlFor="escrow-id"
                    className="text-sm font-semibold text-zinc-200"
                  >
                    Escrow ID
                  </label>
                  <input
                    id="escrow-id"
                    type="text"
                    inputMode="numeric"
                    pattern="\d+"
                    value={escrowId}
                    onChange={(event) =>
                      setEscrowId(event.target.value.replace(/\D/g, ""))
                    }
                    disabled={signoffDisabled}
                    placeholder="e.g. 1734876543210"
                    className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Your funder generates this ID when initializing the escrow.
                  </p>
                </div>

                <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Signing wallet
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-zinc-400">
                    {publicKey}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleLookup()}
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
                        Escrow ID
                      </dt>
                      <dd className="font-mono text-sm text-amber-200">
                        {escrowId}
                      </dd>
                    </div>
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
                  confirmation key. You will be prompted for your PIN to sign
                  locally.
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
                    <p
                      id="proof-hash-hint"
                      className="mt-2 text-xs text-zinc-500"
                    >
                      MVP accepts any non-zero 32-byte hash. Advances escrow from
                      Pending to Released.
                    </p>
                  </div>

                  {!canSubmitProof && walletReady && escrowExists !== null ? (
                    <p className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400">
                      Sign-off is only available when escrow status is{" "}
                      <span className="font-semibold text-amber-300">
                        Pending
                      </span>
                      .
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
            </>
        </main>

        <footer className="border-t border-zinc-800 py-5 text-center text-xs text-zinc-600">
          © {new Date().getFullYear()} SmartProtocol Zambia · Beneficiary
          sign-off
        </footer>
      </div>
    </div>
  );
}
