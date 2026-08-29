"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { WalletConnectButton } from "@/src/components/WalletConnectButton";
import { useFunderAuth } from "@/src/context/FunderAuthContext";

function truncateLabel(value: string, max = 18): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function truncatePublicKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 2)}…${key.slice(-4)}`;
}

export function FunderAuthButton() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, organizationName, registeredPublicKey, signOut } =
    useFunderAuth();

  if (pathname.startsWith("/funder/auth") || !isAuthenticated) {
    return (
      <Link
        href="/funder/auth"
        className="inline-flex min-w-[9.5rem] items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/30 transition hover:bg-emerald-500"
      >
        Funder Log In
      </Link>
    );
  }

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
      <div className="hidden min-w-0 flex-col items-end leading-tight sm:flex">
        <span className="truncate text-xs font-semibold text-emerald-100">
          {truncateLabel(organizationName ?? "Organization")}
        </span>
        {registeredPublicKey ? (
          <span className="font-mono text-[10px] text-emerald-300/80">
            {truncatePublicKey(registeredPublicKey)}
          </span>
        ) : null}
      </div>
      <WalletConnectButton />
      <button
        type="button"
        onClick={() => {
          signOut();
          router.push("/funder/auth");
        }}
        className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-950/60 px-3 py-2 text-sm font-medium text-emerald-50 transition hover:border-emerald-400 hover:bg-emerald-900/80"
      >
        Sign Out
      </button>
    </div>
  );
}
