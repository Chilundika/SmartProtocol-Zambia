"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listPendingVendors,
  setVendorVerificationStatus,
  subscribeVendorRegistry,
  type VendorProfile,
} from "@/src/lib/vendorAuth";

function formatRegisteredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

export function FunderVendorApprovals({
  onRegistryChange,
}: {
  onRegistryChange?: () => void;
}) {
  const [pendingVendors, setPendingVendors] = useState<VendorProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyTpin, setBusyTpin] = useState<string | null>(null);

  const refreshVendorList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setPendingVendors(await listPendingVendors());
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to load pending vendors from Supabase.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshVendorList();
    return subscribeVendorRegistry(() => {
      void refreshVendorList();
    });
  }, [refreshVendorList]);

  const handleStatus = async (
    tpin: string,
    status: "verified" | "rejected",
  ) => {
    setBusyTpin(tpin);
    setError(null);
    try {
      await setVendorVerificationStatus(tpin, status);
      await refreshVendorList();
      onRegistryChange?.();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update vendor status.",
      );
    } finally {
      setBusyTpin(null);
    }
  };

  return (
    <section className="mb-8 rounded-2xl border border-amber-800/30 bg-zinc-900/60 p-6 shadow-xl shadow-black/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Vendor Approvals</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Pending registrations from every device. Approve a vendor to make
            their Vendor ID selectable when you initialize an escrow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshVendorList()}
          disabled={isLoading}
          className="shrink-0 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-950/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Refreshing…" : "Refresh Vendor List"}
        </button>
      </div>

      {error ? (
        <p
          className="mt-4 rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {pendingVendors.length === 0 && !isLoading ? (
        <p className="mt-6 text-sm text-zinc-500">
          No pending vendors. Newly registered businesses will appear here after
          you refresh.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2 font-semibold">Business name</th>
                <th className="px-3 py-2 font-semibold">TPIN</th>
                <th className="px-3 py-2 font-semibold">PACRA</th>
                <th className="px-3 py-2 font-semibold">Vendor ID</th>
                <th className="px-3 py-2 font-semibold">Registered</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingVendors.map((vendor) => {
                const busy = busyTpin === vendor.tpin;
                return (
                  <tr
                    key={vendor.tpin}
                    className="border-b border-zinc-800/80 last:border-0"
                  >
                    <td className="px-3 py-3 text-zinc-100">
                      <p className="font-medium">{vendor.businessName}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {vendor.fullName}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-emerald-200">
                      {vendor.tpin}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                      {vendor.pacraNumber}
                    </td>
                    <td className="px-3 py-3 font-mono text-sm font-semibold text-amber-200">
                      {vendor.vendorId}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-400">
                      {formatRegisteredAt(vendor.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleStatus(vendor.tpin, "verified")}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Approve Vendor"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleStatus(vendor.tpin, "rejected")}
                          className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-950/70 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
