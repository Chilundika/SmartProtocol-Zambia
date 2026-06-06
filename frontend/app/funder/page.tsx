"use client";

import { useCallback, useState, type FormEvent } from "react";

import {
  buildFundEscrowTx,
  buildInitEscrowTx,
  buildReleaseFundsTx,
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

type ActionKey = "init" | "fund" | "release" | "status";

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

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  disabled?: boolean;
  hint?: string;
}

function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 text-sm text-emerald-300"
      role="status"
      aria-live="polite"
    >
      <svg
        className="size-4 animate-spin"
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

function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  hint,
}: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function FeedbackPanel({ feedback }: { feedback: FeedbackState }) {
  if (feedback.kind === "idle") {
    return null;
  }

  if (feedback.kind === "success") {
    const explorerUrl = `${STELLAR_EXPERT_TESTNET_TX}/${feedback.result.txHash}`;

    return (
      <div
        className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-4"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm font-semibold text-emerald-300">
          Transaction confirmed on ledger
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Status:{" "}
          <span className="font-mono text-emerald-200">
            {feedback.result.status}
          </span>
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex text-sm font-medium text-emerald-400 underline-offset-2 hover:text-emerald-300 hover:underline"
        >
          View on Stellar Expert →
        </a>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-red-800/50 bg-red-950/30 p-4"
      role="alert"
      aria-live="assertive"
    >
      <p className="text-sm font-semibold text-red-300">Transaction failed</p>
      <p className="mt-1 font-mono text-xs text-red-200/90">
        Code: {feedback.code}
      </p>
      <p className="mt-1 text-sm text-zinc-300">{feedback.message}</p>
      {feedback.txHash ? (
        <a
          href={`${STELLAR_EXPERT_TESTNET_TX}/${feedback.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex text-xs text-red-300 underline-offset-2 hover:underline"
        >
          Inspect transaction on Stellar Expert
        </a>
      ) : null}
    </div>
  );
}

function statusBadgeClass(status: EscrowStatusOnChain): string {
  switch (status) {
    case "Locked":
      return "bg-zinc-700/60 text-zinc-200";
    case "Pending":
      return "bg-amber-900/50 text-amber-300";
    case "Released":
      return "bg-emerald-900/50 text-emerald-300";
  }
}

function stroopsToXlmDisplay(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

function parseXlmAmount(xlm: string): number {
  const trimmed = xlm.trim();

  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new Error("Amount must be a positive number with up to 7 decimal places.");
  }

  const amount = Number(trimmed);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  return amount;
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

export default function FunderDashboardPage() {
  const { isConnected, publicKey, isConnecting } = useWallet();

  const [recipientAddress, setRecipientAddress] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [initAmountXlm, setInitAmountXlm] = useState("");
  const [fundAmountXlm, setFundAmountXlm] = useState("");

  const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
  const [escrowExists, setEscrowExists] = useState<boolean | null>(null);

  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });

  const walletReady = isConnected && publicKey !== null;
  const formsDisabled = !walletReady || isConnecting || loadingAction !== null;

  const refreshEscrowState = useCallback(
    async (recipient: string) => {
      const trimmedRecipient = recipient.trim();

      if (!trimmedRecipient) {
        throw new Error("Enter a beneficiary address to read escrow status.");
      }

      const simulationSource = publicKey ?? trimmedRecipient;
      const result = await getEscrowState(trimmedRecipient, simulationSource);

      setEscrowExists(result.exists);
      setEscrowState(result.escrow ?? null);
    },
    [publicKey],
  );

  const runTransaction = useCallback(
    async (
      action: ActionKey,
      buildXdr: () => Promise<string>,
      recipientForRefresh?: string,
    ) => {
      setLoadingAction(action);
      setFeedback({ kind: "idle" });

      try {
        const xdr = await buildXdr();
        const result = await signAndSubmitTransaction(xdr);
        setFeedback({ kind: "success", action, result });

        if (recipientForRefresh?.trim()) {
          await refreshEscrowState(recipientForRefresh);
        }
      } catch (error) {
        setFeedback(resolveActionError(action, error));
      } finally {
        setLoadingAction(null);
      }
    },
    [refreshEscrowState],
  );

  const handleRefreshStatus = async () => {
    setLoadingAction("status");
    setFeedback({ kind: "idle" });

    try {
      await refreshEscrowState(recipientAddress);
    } catch (error) {
      setEscrowExists(null);
      setEscrowState(null);
      setFeedback(resolveActionError("status", error));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleInitEscrow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "init",
        code: "WALLET_NOT_CONNECTED",
        message: "Connect your Freighter wallet before initializing an escrow.",
      });
      return;
    }

    const recipient = recipientAddress.trim();
    const vendor = vendorAddress.trim();

    await runTransaction(
      "init",
      async () => {
        const amount = parseXlmAmount(initAmountXlm);
        return buildInitEscrowTx(publicKey, vendor, amount, recipient);
      },
      recipient,
    );
  };

  const handleFundEscrow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "fund",
        code: "WALLET_NOT_CONNECTED",
        message: "Connect your Freighter wallet before funding an escrow.",
      });
      return;
    }

    const recipient = recipientAddress.trim();

    await runTransaction(
      "fund",
      async () => {
        const amount = parseXlmAmount(fundAmountXlm);
        return buildFundEscrowTx(publicKey, recipient, amount);
      },
      recipient,
    );
  };

  const handleReleaseFunds = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!publicKey) {
      setFeedback({
        kind: "error",
        action: "release",
        code: "WALLET_NOT_CONNECTED",
        message: "Connect your Freighter wallet before releasing funds.",
      });
      return;
    }

    const recipient = recipientAddress.trim();

    await runTransaction(
      "release",
      async () => buildReleaseFundsTx(publicKey, recipient),
      recipient,
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/25 via-zinc-950 to-zinc-950" />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <header className="mb-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Funder Dashboard
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Escrow administration
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400 sm:text-base">
              Initialize escrows, deposit Native XLM, and release vendor payouts
              after beneficiary milestone sign-off. All writes require your
              connected Freighter wallet.
            </p>
            {walletReady ? (
              <p className="mt-4 font-mono text-xs text-emerald-400/90">
                Funder: {publicKey}
              </p>
            ) : (
              <p className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                Connect Freighter via the navbar to submit on-chain transactions.
              </p>
            )}
          </header>

          <div className="mb-8">
            <FeedbackPanel feedback={feedback} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-emerald-800/30 bg-zinc-900/60 p-6 shadow-xl shadow-black/20 lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Escrow status reader
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Live on-chain state for a beneficiary escrow record.
                  </p>
                </div>
                {loadingAction === "status" ? (
                  <Spinner label="Fetching escrow state…" />
                ) : null}
              </div>

              <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <FormField
                    id="status-recipient"
                    label="Beneficiary address (escrow key)"
                    value={recipientAddress}
                    onChange={setRecipientAddress}
                    placeholder="G…"
                    disabled={loadingAction !== null}
                    hint="Used across all funder actions on this page."
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRefreshStatus}
                  disabled={formsDisabled && loadingAction !== "status"}
                  className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refresh status
                </button>
              </div>

              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
                {escrowExists === null ? (
                  <p className="text-sm text-zinc-500">
                    Enter a beneficiary address and click Refresh to load escrow
                    data from testnet.
                  </p>
                ) : !escrowExists ? (
                  <p className="text-sm text-zinc-400">
                    No escrow found for this beneficiary address.
                  </p>
                ) : escrowState ? (
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Status
                      </dt>
                      <dd className="mt-1">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(escrowState.status)}`}
                        >
                          {escrowState.status}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        XLM balance (escrow)
                      </dt>
                      <dd className="mt-1 text-lg font-semibold text-white">
                        {stroopsToXlmDisplay(escrowState.amount)}{" "}
                        <span className="text-sm font-normal text-zinc-500">
                          XLM
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Funder
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs text-zinc-300">
                        {escrowState.funder}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Vendor
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs text-zinc-300">
                        {escrowState.vendor}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg shadow-black/10">
              <h2 className="text-lg font-semibold text-white">
                Initialize escrow
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Create a new escrow entry locked to Native XLM.
              </p>

              <form onSubmit={handleInitEscrow} className="mt-6 space-y-4">
                <FormField
                  id="init-vendor"
                  label="Vendor address"
                  value={vendorAddress}
                  onChange={setVendorAddress}
                  placeholder="G…"
                  disabled={formsDisabled}
                />
                <FormField
                  id="init-beneficiary"
                  label="Beneficiary address"
                  value={recipientAddress}
                  onChange={setRecipientAddress}
                  placeholder="G…"
                  disabled={formsDisabled}
                />
                <FormField
                  id="init-amount"
                  label="Amount (XLM)"
                  type="number"
                  value={initAmountXlm}
                  onChange={setInitAmountXlm}
                  placeholder="10"
                  disabled={formsDisabled}
                  hint="Stored on-chain in stroops (7 decimal precision)."
                />

                {loadingAction === "init" ? (
                  <Spinner label="Signing and submitting init_escrow…" />
                ) : null}

                <button
                  type="submit"
                  disabled={formsDisabled}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Initialize escrow
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg shadow-black/10">
              <h2 className="text-lg font-semibold text-white">Fund escrow</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Deposit XLM from your wallet into the on-chain vault.
              </p>

              <form onSubmit={handleFundEscrow} className="mt-6 space-y-4">
                <FormField
                  id="fund-beneficiary"
                  label="Beneficiary address"
                  value={recipientAddress}
                  onChange={setRecipientAddress}
                  placeholder="G…"
                  disabled={formsDisabled}
                />
                <FormField
                  id="fund-amount"
                  label="Amount (XLM)"
                  type="number"
                  value={fundAmountXlm}
                  onChange={setFundAmountXlm}
                  placeholder="5"
                  disabled={formsDisabled}
                />

                {loadingAction === "fund" ? (
                  <Spinner label="Signing and submitting fund_escrow…" />
                ) : null}

                <button
                  type="submit"
                  disabled={formsDisabled}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Fund escrow
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg shadow-black/10 lg:col-span-2">
              <h2 className="text-lg font-semibold text-white">
                Release payout
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Transfer escrowed XLM to the vendor after beneficiary proof is
                on-chain (status must be Released).
              </p>

              <form
                onSubmit={handleReleaseFunds}
                className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <FormField
                    id="release-beneficiary"
                    label="Beneficiary address"
                    value={recipientAddress}
                    onChange={setRecipientAddress}
                    placeholder="G…"
                    disabled={formsDisabled}
                  />
                </div>

                <div className="flex shrink-0 flex-col gap-3 sm:min-w-[200px]">
                  {loadingAction === "release" ? (
                    <Spinner label="Signing and submitting release_funds…" />
                  ) : null}
                  <button
                    type="submit"
                    disabled={formsDisabled}
                    className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Release to vendor
                  </button>
                </div>
              </form>
            </section>
          </div>
        </main>

        <footer className="border-t border-zinc-800/80 py-6 text-center text-xs text-zinc-600">
          © {new Date().getFullYear()} SmartProtocol Zambia · Funder dashboard
        </footer>
      </div>
    </div>
  );
}
