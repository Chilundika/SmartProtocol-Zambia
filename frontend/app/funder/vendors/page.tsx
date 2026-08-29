"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { FunderSubnav } from "@/src/components/FunderSubnav";
import { Navbar } from "@/src/components/Navbar";
import { useFunderAuth } from "@/src/context/FunderAuthContext";
import { useWallet } from "@/src/context/WalletContext";
import {
  getVendorProfile,
  listVendorProfiles,
  setVendorVerificationStatus,
  subscribeVendorRegistry,
  type VendorProfile,
  type VendorVerificationStatus,
} from "@/src/lib/vendorAuth";

type FilterKey = "all" | VendorVerificationStatus;

function statusClass(status: VendorVerificationStatus): string {
  if (status === "verified") {
    return "bg-emerald-900/50 text-emerald-300";
  }
  if (status === "rejected") {
    return "bg-red-900/50 text-red-300";
  }
  return "bg-amber-900/50 text-amber-200";
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleString();
}

export default function FunderVendorVerificationPage() {
  const router = useRouter();
  const { isConnected, publicKey } = useWallet();
  const { isReady, isAuthenticated, organizationName, registeredPublicKey } =
    useFunderAuth();
  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [selectedTpin, setSelectedTpin] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/funder/auth");
    }
  }, [isReady, isAuthenticated, router]);

  const reload = useCallback(() => {
    void listVendorProfiles()
      .then(setVendors)
      .catch((error: unknown) => {
        setActionError(
          error instanceof Error
            ? error.message
            : "Unable to load vendor registrations from Supabase.",
        );
      });
  }, []);

  useEffect(() => {
    reload();
    return subscribeVendorRegistry(reload);
  }, [reload]);

  const filtered = useMemo(() => {
    if (filter === "all") {
      return vendors;
    }
    return vendors.filter((vendor) => vendor.status === filter);
  }, [filter, vendors]);

  const selectedSummary =
    vendors.find((vendor) => vendor.tpin === selectedTpin) ?? filtered[0] ?? null;
  const [selected, setSelected] = useState<VendorProfile | null>(null);

  useEffect(() => {
    if (!selectedSummary) {
      setSelected(null);
      return;
    }

    setSelected(selectedSummary);
    void getVendorProfile(selectedSummary.tpin)
      .then((full) => {
        if (full) {
          setSelected(full);
        }
      })
      .catch(() => {
        setSelected(selectedSummary);
      });
  }, [selectedSummary?.tpin]);

  const pendingCount = vendors.filter((vendor) => vendor.status === "pending").length;

  const handleStatus = (tpin: string, status: VendorVerificationStatus) => {
    setActionError(null);
    void setVendorVerificationStatus(tpin, status)
      .then(() => {
        setSelectedTpin(tpin);
        reload();
      })
      .catch((error: unknown) => {
        setActionError(
          error instanceof Error ? error.message : "Unable to update vendor status.",
        );
      });
  };

  if (!isReady || !isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/25 via-zinc-950 to-zinc-950" />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <header className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Funder Dashboard
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Vendor verification
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400 sm:text-base">
              Review Business TPIN, PACRA numbers, and supporting documents.
              Only <strong className="text-emerald-300">Verified</strong> vendors
              can be selected when you initialize an escrow.
            </p>
            {organizationName ? (
              <p className="mt-4 text-sm text-emerald-200">
                Organization:{" "}
                <span className="font-semibold">{organizationName}</span>
              </p>
            ) : null}
            {registeredPublicKey ? (
              <p className="mt-1 break-all font-mono text-xs text-emerald-400/90">
                Official key: {registeredPublicKey}
              </p>
            ) : null}
            {isConnected && publicKey ? (
              <p className="mt-4 font-mono text-xs text-emerald-400/90">
                Freighter: {publicKey}
              </p>
            ) : (
              <p className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                Connect Freighter via the navbar. Vendor profiles are stored in
                the shared Supabase registry.
              </p>
            )}
          </header>

          <FunderSubnav />

          <p className="mb-6 text-xs text-zinc-500">
            Registry is stored in the shared `vendors` table. Approving a vendor
            updates their `status` column so any funder device can initialize
            an escrow against that Vendor ID.
          </p>

          {actionError ? (
            <p
              className="mb-6 rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}

          <div className="mb-6 flex flex-wrap gap-2">
            {(
              [
                ["pending", `Pending (${pendingCount})`],
                ["verified", "Verified"],
                ["rejected", "Rejected"],
                ["all", "All"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  filter === key
                    ? "bg-emerald-600 text-white"
                    : "border border-zinc-700 text-zinc-300 hover:border-emerald-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {vendors.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
              No vendor registrations yet. Ask a vendor to register at{" "}
              <span className="font-mono text-sky-300">/vendor/auth</span>.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
              <ul className="space-y-3">
                {filtered.length === 0 ? (
                  <li className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-sm text-zinc-500">
                    No vendors in this filter.
                  </li>
                ) : (
                  filtered.map((vendor) => {
                    const active = selected?.tpin === vendor.tpin;
                    return (
                      <li key={vendor.tpin}>
                        <button
                          type="button"
                          onClick={() => setSelectedTpin(vendor.tpin)}
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            active
                              ? "border-emerald-600 bg-emerald-950/40"
                              : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
                          }`}
                        >
                          <p className="font-semibold text-white">
                            {vendor.businessName}
                          </p>
                          <p className="mt-1 font-mono text-xs text-emerald-300">
                            Vendor ID {vendor.vendorId}
                          </p>
                          <p className="mt-1 font-mono text-xs text-zinc-400">
                            {vendor.fullName} · TPIN {vendor.tpin}
                          </p>
                          <span
                            className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${statusClass(vendor.status)}`}
                          >
                            {vendor.status}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              {selected ? (
                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-white">
                        {selected.businessName}
                      </h2>
                      <p className="mt-1 font-mono text-sm text-emerald-300">
                        Vendor ID {selected.vendorId}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        Submitted {formatDate(selected.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClass(selected.status)}`}
                    >
                      {selected.status}
                    </span>
                  </div>

                  <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Full name
                      </dt>
                      <dd className="mt-1 text-sm text-zinc-200">
                        {selected.fullName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Business TPIN / ID
                      </dt>
                      <dd className="mt-1 font-mono text-sm text-emerald-200">
                        {selected.tpin}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        PACRA number
                      </dt>
                      <dd className="mt-1 font-mono text-sm text-zinc-200">
                        {selected.pacraNumber}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Mapped payout address
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs text-zinc-300">
                        {selected.stellarAddress || selected.publicKey}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Verification notes
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
                        {selected.documentNotes || "No notes provided."}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Verified at
                      </dt>
                      <dd className="mt-1 text-sm text-zinc-300">
                        {formatDate(selected.verifiedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Watched escrows
                      </dt>
                      <dd className="mt-1 text-sm text-zinc-300">
                        {selected.watchedEscrowIds.length}
                      </dd>
                    </div>
                  </dl>

                  {selected.document ? (
                    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <p className="text-sm font-semibold text-white">
                        Supporting document
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {selected.document.fileName} ·{" "}
                        {Math.ceil(selected.document.sizeBytes / 1024)} KB ·{" "}
                        {selected.document.mimeType}
                      </p>
                      {selected.document.mimeType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selected.document.dataUrl}
                          alt={selected.document.fileName}
                          className="mt-4 max-h-72 rounded-lg border border-zinc-800 object-contain"
                        />
                      ) : null}
                      <a
                        href={selected.document.dataUrl}
                        download={selected.document.fileName}
                        className="mt-3 inline-flex text-sm font-semibold text-emerald-400 hover:text-emerald-300"
                      >
                        Download document →
                      </a>
                    </div>
                  ) : (
                    <p className="mt-6 text-sm text-zinc-500">
                      No file uploaded — review the verification notes above.
                    </p>
                  )}

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleStatus(selected.tpin, "verified")}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      Approve / Verified
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStatus(selected.tpin, "pending")}
                      className="rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
                    >
                      Mark pending
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStatus(selected.tpin, "rejected")}
                      className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-950/70"
                    >
                      Reject
                    </button>
                  </div>
                </article>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
