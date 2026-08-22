"use client";

import { Keypair } from "@stellar/stellar-sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  createAccount,
  deleteAccount as deleteStoredAccount,
  getAccountPublicKey,
  getActiveSessionNrc,
  loginAccount,
  signOutSession,
  unlockActiveAccount,
  WalletAuthError,
} from "@/src/lib/walletAuth";

export interface EmbeddedWalletContextValue {
  isAuthenticated: boolean;
  activeNrc: string | null;
  publicKey: string | null;
  isUnlocked: boolean;
  keypair: Keypair | null;
  isBusy: boolean;
  signUp: (nrc: string, pin: string) => Promise<void>;
  login: (nrc: string, pin: string) => Promise<void>;
  signOut: () => void;
  deleteAccount: () => void;
  unlockWithPin: (pin: string) => Promise<void>;
}

const EmbeddedWalletContext = createContext<
  EmbeddedWalletContextValue | undefined
>(undefined);

function applySession(
  nrc: string,
  publicKey: string,
  keypair: Keypair | null,
  setters: {
    setActiveNrc: (value: string | null) => void;
    setPublicKey: (value: string | null) => void;
    setKeypair: (value: Keypair | null) => void;
  },
): void {
  setters.setActiveNrc(nrc);
  setters.setPublicKey(publicKey);
  setters.setKeypair(keypair);
}

export function EmbeddedWalletProvider({ children }: { children: ReactNode }) {
  const [activeNrc, setActiveNrc] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const sessionNrc = getActiveSessionNrc();
    if (!sessionNrc) {
      return;
    }

    const storedPublicKey = getAccountPublicKey(sessionNrc);
    if (!storedPublicKey) {
      signOutSession();
      return;
    }

    applySession(sessionNrc, storedPublicKey, null, {
      setActiveNrc,
      setPublicKey,
      setKeypair,
    });
  }, []);

  const signUp = useCallback(async (nrc: string, pin: string) => {
    setIsBusy(true);
    try {
      const created = await createAccount(nrc, pin);
      const session = await loginAccount(created.nrc, pin);
      applySession(session.nrc, session.publicKey, session.keypair, {
        setActiveNrc,
        setPublicKey,
        setKeypair,
      });
    } finally {
      setIsBusy(false);
    }
  }, []);

  const login = useCallback(async (nrc: string, pin: string) => {
    setIsBusy(true);
    try {
      const session = await loginAccount(nrc, pin);
      applySession(session.nrc, session.publicKey, session.keypair, {
        setActiveNrc,
        setPublicKey,
        setKeypair,
      });
    } finally {
      setIsBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    signOutSession();
    setActiveNrc(null);
    setPublicKey(null);
    setKeypair(null);
  }, []);

  const deleteAccountHandler = useCallback(() => {
    if (!activeNrc) {
      return;
    }

    deleteStoredAccount(activeNrc);
    signOutSession();
    setActiveNrc(null);
    setPublicKey(null);
    setKeypair(null);
  }, [activeNrc]);

  const unlockWithPin = useCallback(async (pin: string) => {
    setIsBusy(true);
    try {
      const unlocked = await unlockActiveAccount(pin);
      setKeypair(unlocked);
      setPublicKey(unlocked.publicKey());
    } finally {
      setIsBusy(false);
    }
  }, []);

  const value = useMemo<EmbeddedWalletContextValue>(
    () => ({
      isAuthenticated: activeNrc !== null && publicKey !== null,
      activeNrc,
      publicKey,
      isUnlocked: keypair !== null,
      keypair,
      isBusy,
      signUp,
      login,
      signOut,
      deleteAccount: deleteAccountHandler,
      unlockWithPin,
    }),
    [
      activeNrc,
      publicKey,
      keypair,
      isBusy,
      signUp,
      login,
      signOut,
      deleteAccountHandler,
      unlockWithPin,
    ],
  );

  return (
    <EmbeddedWalletContext.Provider value={value}>
      {children}
    </EmbeddedWalletContext.Provider>
  );
}

export function useEmbeddedWallet(): EmbeddedWalletContextValue {
  const context = useContext(EmbeddedWalletContext);
  if (context === undefined) {
    throw new Error(
      "useEmbeddedWallet must be used within an EmbeddedWalletProvider",
    );
  }
  return context;
}

export { WalletAuthError };
