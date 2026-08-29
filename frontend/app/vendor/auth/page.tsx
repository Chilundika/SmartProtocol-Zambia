"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Navbar } from "@/src/components/Navbar";
import {
  useVendorWallet,
  WalletAuthError,
} from "@/src/context/VendorWalletContext";
import {
  extractNameInitials,
  MAX_DOCUMENT_BYTES,
  readVendorDocumentFile,
  type VendorDocument,
} from "@/src/lib/vendorAuth";

type AuthMode = "login" | "signup";

function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 text-sm font-medium text-sky-100"
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

function AuthOverlay({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/85 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-auth-overlay-label"
    >
      <div className="w-full max-w-sm rounded-2xl border border-sky-700/50 bg-zinc-900 p-8 text-center shadow-2xl">
        <Spinner label="Registering vendor and activating Testnet wallet…" />
        <p
          id="vendor-auth-overlay-label"
          className="mt-4 text-xs leading-relaxed text-zinc-400"
        >
          Funding your vendor address via Friendbot. Do not close this tab.
        </p>
      </div>
    </div>
  );
}

export default function VendorAuthPage() {
  const router = useRouter();
  const { isReady, isAuthenticated, isBusy, signUp, login } = useVendorWallet();

  const [mode, setMode] = useState<AuthMode>("login");
  const [tpin, setTpin] = useState("");
  const [pin, setPin] = useState("");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [pacraNumber, setPacraNumber] = useState("");
  const [documentNotes, setDocumentNotes] = useState("");
  const [document, setDocument] = useState<VendorDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      router.replace("/vendor");
    }
  }, [isReady, isAuthenticated, router]);

  const canSubmitLogin = tpin.trim().length >= 6 && pin.length === 4 && !isBusy;
  const canSubmitSignup =
    canSubmitLogin &&
    fullName.trim().split(/\s+/).length >= 2 &&
    businessName.trim().length >= 2 &&
    pacraNumber.trim().length >= 5 &&
    (documentNotes.trim().length > 0 || document !== null);

  let vendorIdPreview = "";
  try {
    vendorIdPreview = `${extractNameInitials(fullName)}#####`;
  } catch {
    vendorIdPreview = "";
  }

  const handleDocumentChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    setError(null);

    if (!file) {
      setDocument(null);
      return;
    }

    try {
      setDocument(await readVendorDocumentFile(file));
    } catch (fileError) {
      setDocument(null);
      event.target.value = "";
      if (fileError instanceof WalletAuthError) {
        setError(fileError.message);
      } else if (fileError instanceof Error) {
        setError(fileError.message);
      } else {
        setError("Could not attach the selected document.");
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === "signup") {
        await signUp({
          tpin,
          pin,
          fullName,
          businessName,
          pacraNumber,
          documentNotes,
          document,
        });
      } else {
        await login(tpin, pin);
      }
      router.push("/vendor");
    } catch (submitError) {
      if (submitError instanceof WalletAuthError) {
        setError(submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("Authentication failed. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-900/20 via-zinc-950 to-zinc-950" />

      <AuthOverlay visible={isBusy && mode === "signup"} />

      <div className="relative flex min-h-screen flex-col">
        <Navbar />

        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:px-6">
          <header className="mb-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">
              Vendor Access
            </p>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              {mode === "login" ? "Log in" : "Register your business"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Use your Business TPIN / ID and a 4-digit PIN. Funders must verify
              your PACRA documents. You will receive a 7-character Vendor ID
              (e.g. cc33791) that funders use instead of your Stellar key.
            </p>
          </header>

          <div className="mb-6 flex rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-sky-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                mode === "signup"
                  ? "bg-sky-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Register
            </button>
          </div>

          <section className="rounded-2xl border border-sky-800/40 bg-zinc-900/70 p-5 shadow-lg sm:p-6">
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-5"
            >
              <div>
                <label
                  htmlFor="vendor-tpin"
                  className="text-sm font-semibold text-zinc-200"
                >
                  Business TPIN / ID
                </label>
                <input
                  id="vendor-tpin"
                  type="text"
                  value={tpin}
                  onChange={(event) => setTpin(event.target.value)}
                  disabled={isBusy}
                  placeholder="1001234567"
                  autoComplete="username"
                  className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
                />
              </div>

              {mode === "signup" ? (
                <>
                  <div>
                    <label
                      htmlFor="vendor-full-name"
                      className="text-sm font-semibold text-zinc-200"
                    >
                      Full name
                    </label>
                    <input
                      id="vendor-full-name"
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      disabled={isBusy}
                      placeholder="Chipo Charoy"
                      autoComplete="name"
                      className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
                    />
                    {vendorIdPreview ? (
                      <p className="mt-2 text-xs text-sky-300">
                        Vendor ID will look like{" "}
                        <span className="font-mono">{vendorIdPreview}</span>
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">
                        First and last name initials plus 5 random digits.
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="vendor-business-name"
                      className="text-sm font-semibold text-zinc-200"
                    >
                      Business name
                    </label>
                    <input
                      id="vendor-business-name"
                      type="text"
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                      disabled={isBusy}
                      placeholder="Lusaka Agro Supplies Ltd"
                      className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="vendor-pacra"
                      className="text-sm font-semibold text-zinc-200"
                    >
                      PACRA registration number
                    </label>
                    <input
                      id="vendor-pacra"
                      type="text"
                      value={pacraNumber}
                      onChange={(event) => setPacraNumber(event.target.value)}
                      disabled={isBusy}
                      placeholder="120000012345"
                      className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="vendor-doc-notes"
                      className="text-sm font-semibold text-zinc-200"
                    >
                      Document verification details
                    </label>
                    <textarea
                      id="vendor-doc-notes"
                      value={documentNotes}
                      onChange={(event) => setDocumentNotes(event.target.value)}
                      disabled={isBusy}
                      rows={3}
                      placeholder="Describe the supporting document (tax clearance, PACRA certificate, etc.)"
                      className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
                    />
                    <label
                      htmlFor="vendor-doc-file"
                      className="mt-3 block text-xs font-medium text-zinc-500"
                    >
                      Optional file upload (PDF, image — max{" "}
                      {Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB)
                    </label>
                    <input
                      id="vendor-doc-file"
                      type="file"
                      accept=".pdf,image/*,.doc,.docx"
                      onChange={(event) => void handleDocumentChange(event)}
                      disabled={isBusy}
                      className="mt-2 block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-sky-600 disabled:opacity-50"
                    />
                    {document ? (
                      <p className="mt-2 text-xs text-sky-300">
                        Attached: {document.fileName} (
                        {Math.ceil(document.sizeBytes / 1024)} KB)
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div>
                <label
                  htmlFor="vendor-pin"
                  className="text-sm font-semibold text-zinc-200"
                >
                  4-digit PIN
                </label>
                <input
                  id="vendor-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  disabled={isBusy}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  className="mt-2 w-full rounded-xl border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-white focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
                />
              </div>

              {error ? (
                <p
                  className="rounded-lg border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-200"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={mode === "signup" ? !canSubmitSignup : !canSubmitLogin}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-sky-500 px-4 py-3 text-base font-bold text-zinc-950 transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? (
                  mode === "signup" ? (
                    <Spinner label="Registering…" />
                  ) : (
                    <Spinner label="Logging in…" />
                  )
                ) : mode === "signup" ? (
                  "Submit for verification"
                ) : (
                  "Log In"
                )}
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
