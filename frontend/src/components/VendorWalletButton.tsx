"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useVendorWallet } from "@/src/context/VendorWalletContext";

function truncateLabel(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

export function VendorWalletButton() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, activeTpin, signOut } = useVendorWallet();

  if (pathname.startsWith("/vendor/auth") || !isAuthenticated || !activeTpin) {
    return (
      <Link
        href="/vendor/auth"
        className="inline-flex min-w-[9.5rem] items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-md shadow-sky-900/30 transition hover:bg-sky-400"
      >
        Vendor Log In
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono text-xs text-sky-200 sm:inline">
        {truncateLabel(activeTpin)}
      </span>
      <button
        type="button"
        onClick={() => {
          signOut();
          router.push("/vendor/auth");
        }}
        className="inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-sky-950/60 px-4 py-2 text-sm font-medium text-sky-50 transition hover:border-sky-400 hover:bg-sky-900/80"
      >
        Sign Out
      </button>
    </div>
  );
}
