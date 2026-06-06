import Link from "next/link";

import { Navbar } from "@/src/components/Navbar";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/30 via-zinc-950 to-zinc-950" />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <section className="mx-auto max-w-3xl text-center">
            <p className="mb-4 inline-flex rounded-full border border-emerald-500/30 bg-emerald-950/50 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Verified Milestone Payouts
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Trustless escrow for{" "}
              <span className="text-emerald-400">Zambia&apos;s growers</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-zinc-400 sm:text-xl">
              SmartProtocol Zambia locks funds on Stellar until milestones are
              verified—protecting funders, empowering farmers, and paying vendors
              only when proof is signed.
            </p>
          </section>

          <section className="mt-16 grid gap-6 sm:grid-cols-2 lg:mt-20">
            <article
              id="funder-dashboard"
              className="scroll-mt-24 rounded-2xl border border-emerald-800/30 bg-gradient-to-br from-emerald-950/80 to-zinc-900/80 p-6 shadow-xl shadow-black/20 sm:p-8"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400">
                <svg
                  className="size-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M3.75 6v9m0 0v1.125c0 .621.504 1.125 1.125 1.125h16.5c.621 0 1.125-.504 1.125-1.125V15M3.75 6h16.5"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-white sm:text-2xl">
                For Funders
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
                Initialize escrows, deposit Native XLM, and release payments to
                vendors only after beneficiaries submit verified milestone proof.
              </p>
              <Link
                href="/funder"
                className="mt-6 inline-flex items-center text-sm font-semibold text-emerald-400 transition hover:text-emerald-300"
              >
                Open Funder Dashboard →
              </Link>
            </article>

            <article
              id="beneficiary-signoff"
              className="scroll-mt-24 rounded-2xl border border-amber-800/25 bg-gradient-to-br from-amber-950/40 to-zinc-900/80 p-6 shadow-xl shadow-black/20 sm:p-8"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-amber-600/20 text-amber-400">
                <svg
                  className="size-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-white sm:text-2xl">
                For Farmers &amp; Beneficiaries
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
                Submit cryptographic sign-off when milestones are complete.
                Your proof unlocks the release path—no payouts without your
                authorization.
              </p>
              <Link
                href="/beneficiary"
                className="mt-6 inline-flex items-center text-sm font-semibold text-amber-400 transition hover:text-amber-300"
              >
                Go to Beneficiary Sign-off →
              </Link>
            </article>
          </section>

          <section className="mt-16 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-8 text-center sm:mt-20 sm:px-10">
            <h3 className="text-lg font-semibold text-white">
              Built on Stellar &amp; Soroban
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-zinc-500 sm:text-base">
              Connect your Freighter wallet to interact with testnet escrows.
              Week 2 brings the UI—contract flows come next.
            </p>
          </section>
        </main>

        <footer className="border-t border-zinc-800/80 py-6 text-center text-xs text-zinc-600">
          © {new Date().getFullYear()} SmartProtocol Zambia · Code-verified
          agricultural payouts
        </footer>
      </div>
    </div>
  );
}
