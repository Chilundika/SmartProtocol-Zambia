"use client";

import Link from "next/link";
import { useState } from "react";

import { WalletConnectButton } from "@/src/components/WalletConnectButton";

const navLinks = [
  { href: "/funder", label: "Funder Dashboard" },
  { href: "/beneficiary", label: "Beneficiary Sign-off" },
] as const;

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-emerald-900/20 bg-zinc-950/80 backdrop-blur-md">
      <nav
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8"
        aria-label="Main navigation"
      >
        <Link
          href="/"
          className="group flex shrink-0 flex-col leading-tight"
          onClick={() => setMobileOpen(false)}
        >
          <span className="text-lg font-bold tracking-tight text-white sm:text-xl">
            SmartProtocol
          </span>
          <span className="text-xs font-medium text-emerald-400 sm:text-sm">
            Zambia
          </span>
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-emerald-950/80 hover:text-emerald-300"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 sm:gap-3">
          <WalletConnectButton />

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 p-2 text-zinc-200 transition hover:bg-zinc-800 md:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span className="sr-only">Toggle menu</span>
            {mobileOpen ? (
              <svg
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div
          id="mobile-nav-menu"
          className="border-t border-emerald-900/20 bg-zinc-950/95 px-4 py-4 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-200 hover:bg-emerald-950/80 hover:text-emerald-300"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
