"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getEscrowState,
  StellarClientError,
  type EscrowState,
  type EscrowStatusOnChain,
} from "@/src/blockchain/stellarClient";
import { EscrowAuditHistory } from "@/src/components/EscrowAuditHistory";
import { Navbar } from "@/src/components/Navbar";
import { useVendorWallet } from "@/src/context/VendorWalletContext";
import { historyEscrowId } from "@/src/lib/escrowAuditHistory";
import {
  addWatchedEscrowId,
  getVendorPayoutAddress,
  updateVendorPayoutAddress,
  WalletAuthError,
} from "@/src/lib/vendorAuth";

const STROOPS_PER_XLM = BigInt(10_000_000);
const STATUS_STEPS: EscrowStatusOnChain[] = ["Locked", "Pending", "Released"];

interface TrackedEscrow {
  escrowId: string;
  exists: boolean;
  escrow?: EscrowState;
  error?: string;
}

interface WatchlistRefreshOptions {
  silent?: boolean;
  shouldApply?: () => boolean;
}

function VendorEscrowHistory({
  escrowId,
  status,
  amount,
}: {
  escrowId: string;
  status: EscrowStatusOnChain;
  amount: bigint;
}) {
  const historyId = historyEscrowId(escrowId);
  if (!historyId) {
    return null;
  }

  return (
    <EscrowAuditHistory
      escrowId={historyId}
      refreshKey={`${status}:${amount.toString()}`}
      status={status}
      balanceXlm={stroopsToXlmDisplay(amount)}
    />
  );
}

function isCompletedPayout(item: TrackedEscrow): boolean {
  return (
    item.exists &&
    item.escrow?.status === "Released" &&
    item.escrow.amount === BigInt(0)
  );
}

function stroopsToXlmDisplay(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
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

function verificationBadge(status: string) {
  if (status === "verified") {
    return "bg-emerald-900/50 text-emerald-300";
  }
  if (status === "rejected") {
    return "bg-red-900/50 text-red-300";
  }
  return "bg-amber-900/50 text-amber-200";
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

function StatusTrack({ status }: { status: EscrowStatusOnChain }) {
  const currentIndex = STATUS_STEPS.indexOf(status);

  return (
    <ol className="flex items-center gap-2" aria-label="Escrow lifecycle">
      {STATUS_STEPS.map((step, index) => {
        const reached = index <= currentIndex;
        return (
          <li key={step} className="flex flex-1 items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                reached
                  ? statusBadgeClass(step)
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {step}
            </span>
            {index < STATUS_STEPS.length - 1 ? (
              <span
                className={`h-px flex-1 ${
                  index < currentIndex ? "bg-sky-500" : "bg-zinc-700"
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function VendorEscrowCard({ item }: { item: TrackedEscrow }) {
  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-sky-200">
          Escrow {item.escrowId}
        </p>
        {item.escrow ? (
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(item.escrow.status)}`}
          >
            {item.escrow.status}
          </span>
        ) : null}
      </div>

      {item.error ? (
        <p className="mt-3 text-sm text-red-300">{item.error}</p>
      ) : !item.exists || !item.escrow ? (
        <p className="mt-3 text-sm text-zinc-500">
          No on-chain record for this ID.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <StatusTrack status={item.escrow.status} />
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">
                Locked amount
              </dt>
              <dd className="mt-1 text-sm font-semibold text-white">
                {stroopsToXlmDisplay(item.escrow.amount)} XLM
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">
                Dispatch confidence
              </dt>
              <dd className="mt-1 text-sm text-zinc-200">
                {item.escrow.status === "Locked"
                  ? "Record only — do not dispatch yet"
                  : item.escrow.status === "Pending"
                    ? "Funds locked — safe to prepare dispatch"
                    : item.escrow.amount > BigInt(0)
                      ? "Proof submitted — payout pending"
                      : "Payout complete"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">
                Beneficiary
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-zinc-400">
                {item.escrow.recipient}
              </dd>
            </div>
          </dl>
          <VendorEscrowHistory
            escrowId={item.escrowId}
            status={item.escrow.status}
            amount={item.escrow.amount}
          />
        </div>
      )}
    </li>
  );
}

export default function VendorDashboardPage() {
  const router = useRouter();
  const {
    isReady,
    isAuthenticated,
    activeTpin,
    publicKey,
    profile,
    signOut,
    deleteAccount,
    refreshProfile,
  } = useVendorWallet();

  const [escrowIdInput, setEscrowIdInput] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [tracked, setTracked] = useState<TrackedEscrow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedVendorId, setCopiedVendorId] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newPayoutAddress, setNewPayoutAddress] = useState("");
  const [payoutMessage, setPayoutMessage] = useState<string | null>(null);
  const [showCompletedPayouts, setShowCompletedPayouts] = useState(false);
  const fetchInFlightRef = useRef(false);

  const watchedIdsKey = profile?.watchedEscrowIds.join(",") ?? "";
  const vendorPayoutAddress = profile ? getVendorPayoutAddress(profile) : "";

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/vendor/auth");
    }
  }, [isReady, isAuthenticated, router]);

  const loadEscrow = useCallback(
    async (escrowId: string, source: string): Promise<TrackedEscrow> => {
      try {
        parseEscrowIdInput(escrowId);
        const result = await getEscrowState(Number(escrowId), source);
        return {
          escrowId,
          exists: result.exists,
          escrow: result.escrow,
        };
      } catch (loadError) {
        const message =
          loadError instanceof StellarClientError || loadError instanceof Error
            ? loadError.message
            : "Unable to load escrow.";
        return { escrowId, exists: false, error: message };
      }
    },
    [],
  );

  const refreshWatchlist = useCallback(
    async (
      ids: string[],
      source: string,
      vendorAddress: string,
      options: WatchlistRefreshOptions = {},
    ) => {
      if (!options.silent) {
        setIsRefreshing(true);
        setError(null);
      }

      try {
        const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
        const results = await Promise.all(
          uniqueIds.map((id) => loadEscrow(id, source)),
        );

        const matching = results.filter((item) => {
          if (!item.exists || !item.escrow) {
            return true;
          }
          return item.escrow.vendor === vendorAddress;
        });

        if (options.shouldApply?.() ?? true) {
          setTracked(matching);
        }
      } finally {
        if (!options.silent) {
          setIsRefreshing(false);
        }
      }
    },
    [loadEscrow],
  );

  useEffect(() => {
    if (!publicKey || !vendorPayoutAddress) {
      return;
    }
    if (!watchedIdsKey) {
      setTracked([]);
      return;
    }
    void refreshWatchlist(
      watchedIdsKey.split(","),
      publicKey,
      vendorPayoutAddress,
    );
  }, [publicKey, refreshWatchlist, vendorPayoutAddress, watchedIdsKey]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !publicKey || !vendorPayoutAddress) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (fetchInFlightRef.current) {
        return;
      }

      fetchInFlightRef.current = true;
      try {
        await refreshProfile();
        const watchedIds = watchedIdsKey ? watchedIdsKey.split(",") : [];
        if (watchedIds.length === 0) {
          if (!cancelled) {
            setTracked([]);
          }
          return;
        }
        await refreshWatchlist(watchedIds, publicKey, vendorPayoutAddress, {
          silent: true,
          shouldApply: () => !cancelled,
        });
      } catch (pollError) {
        if (!cancelled) {
          console.error("[vendor] background refresh failed", pollError);
        }
      } finally {
        fetchInFlightRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      }
    };

    const interval = window.setInterval(() => void poll(), 6000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    isAuthenticated,
    isReady,
    publicKey,
    refreshProfile,
    refreshWatchlist,
    vendorPayoutAddress,
    watchedIdsKey,
  ]);

  const handleLookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicKey || !activeTpin || !profile) {
      return;
    }

    setError(null);

    try {
      const parsed = parseEscrowIdInput(escrowIdInput);
      const result = await loadEscrow(String(parsed), publicKey);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (!result.exists || !result.escrow) {
        setError("No escrow found for that ID on testnet.");
        return;
      }

      if (result.escrow.vendor !== getVendorPayoutAddress(profile)) {
        setError(
          "This escrow is assigned to a different vendor address. Confirm the ID with the funder.",
        );
        return;
      }

      await addWatchedEscrowId(activeTpin, String(parsed));
      await refreshProfile();
      setEscrowIdInput("");
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : "Unable to look up that escrow.",
      );
    }
  };

  const handleAddressQuery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicKey || !profile) {
      return;
    }

    const payoutAddress = getVendorPayoutAddress(profile);
    const query = addressQuery.trim();
    if (query && query !== payoutAddress) {
      setError(
        "Address filter must match your mapped payout address. Leave it blank to refresh all watched escrows.",
      );
      return;
    }

    await refreshWatchlist(profile.watchedEscrowIds, publicKey, payoutAddress);
  };

  const handleCopyPublicKey = async () => {
    if (!profile) {
      return;
    }
    await navigator.clipboard.writeText(getVendorPayoutAddress(profile));
    setCopiedKey(true);
    window.setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyVendorId = async () => {
    if (!profile) {
      return;
    }
    await navigator.clipboard.writeText(profile.vendorId);
    setCopiedVendorId(true);
    window.setTimeout(() => setCopiedVendorId(false), 2000);
  };

  const handleUpdatePayoutAddress = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!activeTpin) {
      return;
    }

    setPayoutMessage(null);
    try {
      await updateVendorPayoutAddress(activeTpin, newPayoutAddress);
      setNewPayoutAddress("");
      await refreshProfile();
      setPayoutMessage("Payout address updated. Your Vendor ID is unchanged.");
    } catch (updateError) {
      setPayoutMessage(
        updateError instanceof WalletAuthError || updateError instanceof Error
          ? updateError.message
          : "Unable to update payout address.",
      );
    }
  };

  if (!isReady || !isAuthenticated || !profile || !publicKey) {
    return null;
  }

  const payoutAddress = vendorPayoutAddress;
  const matchingEscrows = tracked.filter(
    (item) => item.exists && item.escrow?.vendor === payoutAddress,
  );
  const fundedReadyToDispatch = matchingEscrows.filter(
    (item) =>
      item.escrow?.status === "Pending" &&
      (item.escrow.amount ?? BigInt(0)) > BigInt(0),
  );
  const completedPayouts = tracked.filter(isCompletedPayout);
  const activeEscrows = tracked.filter((item) => !isCompletedPayout(item));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-900/20 via-zinc-950 to-zinc-950" />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          <header className="mb-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">
              Vendor Portal
            </p>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              Track locked funds before dispatch
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Confirm that XLM is on-chain for your deliveries. Dispatch goods
              only when status is <strong className="text-amber-200">Pending</strong>{" "}
              (funded) or later.
            </p>
          </header>

          <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-lg sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {profile.businessName}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {profile.fullName} · TPIN {profile.tpin} · PACRA{" "}
                  {profile.pacraNumber}
                </p>
              </div>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${verificationBadge(profile.status)}`}
              >
                {profile.status === "verified" ? "Verified" : profile.status}
              </span>
            </div>

            {profile.status !== "verified" ? (
              <p className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                A funder must approve this registration on{" "}
                <span className="font-semibold">/funder/vendors</span> before you
                can be selected for a new escrow.
              </p>
            ) : null}

            <dl className="mt-5 space-y-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Vendor ID
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-sky-200">
                  {profile.vendorId}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Mapped payout address
                </dt>
                <dd className="mt-1 break-all font-mono text-sm text-sky-200">
                  {payoutAddress}
                </dd>
              </div>
            </dl>

            <form
              onSubmit={handleUpdatePayoutAddress}
              className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
            >
              <label
                htmlFor="vendor-payout-address"
                className="text-sm font-semibold text-zinc-200"
              >
                Update treasury / payout address
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                Your Vendor ID stays the same. Funders will resolve new escrows
                to this Stellar key.
              </p>
              <input
                id="vendor-payout-address"
                type="text"
                value={newPayoutAddress}
                onChange={(event) => setNewPayoutAddress(event.target.value)}
                placeholder="G…"
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                className="mt-3 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600"
              >
                Save new payout address
              </button>
              {payoutMessage ? (
                <p className="mt-2 text-xs text-sky-200">{payoutMessage}</p>
              ) : null}
            </form>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleCopyVendorId()}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
              >
                {copiedVendorId ? "Copied!" : "Copy Vendor ID"}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyPublicKey()}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
              >
                {copiedKey ? "Copied!" : "Copy payout address"}
              </button>
              <button
                type="button"
                onClick={() => {
                  signOut();
                  router.push("/vendor/auth");
                }}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                Sign Out
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-950/70"
              >
                Delete Account
              </button>
            </div>

            {showDeleteConfirm ? (
              <div className="mt-4 rounded-xl border border-red-800/50 bg-red-950/30 p-4">
                <p className="text-sm text-red-100">
                  Delete this vendor profile from the shared registry? This
                  cannot be undone.
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void deleteAccount().then(() => {
                        router.push("/vendor/auth");
                      });
                    }}
                    className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="mb-6 grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={(event) => void handleLookup(event)}
              className="rounded-2xl border border-sky-800/40 bg-zinc-900/70 p-5 sm:p-6"
            >
              <h2 className="text-lg font-semibold text-white">
                Track by Escrow ID
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Ask the funder for the Escrow ID after they initialize.
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={escrowIdInput}
                onChange={(event) =>
                  setEscrowIdInput(event.target.value.replace(/\D/g, ""))
                }
                placeholder="e.g. 1734876543210"
                className="mt-4 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              <button
                type="submit"
                disabled={isRefreshing || escrowIdInput.length === 0}
                className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Look up &amp; watch escrow
              </button>
            </form>

            <form
              onSubmit={(event) => void handleAddressQuery(event)}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6"
            >
              <h2 className="text-lg font-semibold text-white">
                Refresh by vendor address
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Re-query every watched escrow and keep rows that match your
                address. The contract is keyed by Escrow ID, so address lookup
                uses your watchlist.
              </p>
              <input
                type="text"
                value={addressQuery}
                onChange={(event) => setAddressQuery(event.target.value)}
                placeholder={payoutAddress}
                className="mt-4 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              <button
                type="submit"
                disabled={isRefreshing}
                className="mt-4 w-full rounded-xl border border-sky-600 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-950/70 disabled:opacity-50"
              >
                {isRefreshing ? "Refreshing…" : "Refresh matching escrows"}
              </button>
            </form>
          </section>

          {error ? (
            <p
              className="mb-6 rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-lg sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">
                Escrows for this vendor
              </h2>
              <p className="text-xs text-zinc-500">
                {activeEscrows.length} active · {fundedReadyToDispatch.length} funded and waiting for delivery
              </p>
            </div>

            {activeEscrows.length === 0 && completedPayouts.length === 0 ? (
              <p className="mt-5 text-sm text-zinc-500">
                No watched escrows yet. Look up an Escrow ID, or wait for a
                funder to initialize one with your verified address.
              </p>
            ) : null}

            {activeEscrows.length > 0 ? (
              <ul className="mt-5 space-y-4">
                {activeEscrows.map((item) => (
                  <VendorEscrowCard key={item.escrowId} item={item} />
                ))}
              </ul>
            ) : completedPayouts.length > 0 ? (
              <p className="mt-5 text-sm text-zinc-500">
                No active escrows. Completed payouts are available below.
              </p>
            ) : null}

            {completedPayouts.length > 0 ? (
              <section className="mt-5 border-t border-zinc-800 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Completed payouts
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {completedPayouts.length} completed {completedPayouts.length === 1 ? "escrow" : "escrows"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCompletedPayouts((visible) => !visible)}
                    aria-expanded={showCompletedPayouts}
                    aria-controls="completed-vendor-escrows"
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
                  >
                    {showCompletedPayouts ? "Hide completed" : "Show completed"}
                  </button>
                </div>

                <ul
                  id="completed-vendor-escrows"
                  className="mt-4 space-y-4"
                  hidden={!showCompletedPayouts}
                >
                  {completedPayouts.map((item) => (
                    <VendorEscrowCard key={item.escrowId} item={item} />
                  ))}
                </ul>
              </section>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
