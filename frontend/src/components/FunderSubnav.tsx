"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/funder", label: "Escrow" },
  { href: "/funder/vendors", label: "Vendor verification" },
] as const;

export function FunderSubnav() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex flex-wrap gap-2"
      aria-label="Funder sections"
    >
      {tabs.map((tab) => {
        const active =
          tab.href === "/funder"
            ? pathname === "/funder"
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              active
                ? "bg-emerald-600 text-white"
                : "border border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-emerald-700 hover:text-emerald-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
