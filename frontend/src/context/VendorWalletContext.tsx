"use client";

import { Keypair } from "@stellar/stellar-sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createVendorAccount,
  deleteVendorAccount as deleteStoredVendor,
  getActiveVendorSnapshot,
  getActiveVendorTpin,
  getVendorProfile,
  loginVendorAccount,
  signOutVendorSession,
  subscribeVendorRegistry,
  unlockActiveVendor,
  WalletAuthError,
  type VendorProfile,
  type VendorRegistrationInput,
} from "@/src/lib/vendorAuth";

export interface VendorWalletContextValue {
  isReady: boolean;
  isAuthenticated: boolean;
  activeTpin: string | null;
  publicKey: string | null;
  profile: VendorProfile | null;
  isUnlocked: boolean;
  keypair: Keypair | null;
  isBusy: boolean;
  signUp: (input: VendorRegistrationInput) => Promise<void>;
  login: (tpin: string, pin: string) => Promise<void>;
  signOut: () => void;
  deleteAccount: () => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const VendorWalletContext = createContext<VendorWalletContextValue | undefined>(
  undefined,
);

function applySession(
  tpin: string,
  profile: VendorProfile,
  keypair: Keypair | null,
  setters: {
    setActiveTpin: (value: string | null) => void;
    setProfile: (value: VendorProfile | null) => void;
    setPublicKey: (value: string | null) => void;
    setKeypair: (value: Keypair | null) => void;
  },
): void {
  setters.setActiveTpin(tpin);
  setters.setProfile(profile);
  setters.setPublicKey(profile.publicKey);
  setters.setKeypair(keypair);
}

export function VendorWalletProvider({ children }: { children: ReactNode }) {
  const [activeTpin, setActiveTpin] = useState<string | null>(null);
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const activeTpinRef = useRef<string | null>(null);

  const clearSessionState = useCallback(() => {
    activeTpinRef.current = null;
    setActiveTpin(null);
    setProfile(null);
    setPublicKey(null);
    setKeypair(null);
  }, []);

  const applyCurrentSession = useCallback(
    (tpin: string, nextProfile: VendorProfile, nextKeypair: Keypair | null) => {
      activeTpinRef.current = tpin;
      applySession(tpin, nextProfile, nextKeypair, {
        setActiveTpin,
        setProfile,
        setPublicKey,
        setKeypair,
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const hydrate = () => {
      const sessionTpin = getActiveVendorTpin();
      activeTpinRef.current = sessionTpin;
      if (!sessionTpin) {
        clearSessionState();
        setIsReady(true);
        return;
      }

      const snapshot = getActiveVendorSnapshot();
      const hasMatchingSnapshot = snapshot?.tpin === sessionTpin;
      if (hasMatchingSnapshot && snapshot) {
        applyCurrentSession(sessionTpin, snapshot, null);
        setIsReady(true);
      }

      void getVendorProfile(sessionTpin)
        .then((latest) => {
          if (
            cancelled ||
            activeTpinRef.current !== sessionTpin ||
            getActiveVendorTpin() !== sessionTpin
          ) {
            return;
          }

          if (!latest) {
            signOutVendorSession();
            clearSessionState();
            return;
          }

          applyCurrentSession(sessionTpin, latest, null);
        })
        .catch(() => {
          if (
            !cancelled &&
            activeTpinRef.current === sessionTpin &&
            !hasMatchingSnapshot
          ) {
            signOutVendorSession();
            clearSessionState();
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsReady(true);
          }
        });
    };

    hydrate();
    const unsubscribe = subscribeVendorRegistry(hydrate);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyCurrentSession, clearSessionState]);

  const signUp = useCallback(async (input: VendorRegistrationInput) => {
    setIsBusy(true);
    try {
      const created = await createVendorAccount(input);
      const session = await loginVendorAccount(created.tpin, input.pin);
      applyCurrentSession(session.tpin, session.profile, session.keypair);
    } finally {
      setIsBusy(false);
    }
  }, [applyCurrentSession]);

  const login = useCallback(async (tpin: string, pin: string) => {
    setIsBusy(true);
    try {
      const session = await loginVendorAccount(tpin, pin);
      applyCurrentSession(session.tpin, session.profile, session.keypair);
    } finally {
      setIsBusy(false);
    }
  }, [applyCurrentSession]);

  const signOut = useCallback(() => {
    signOutVendorSession();
    clearSessionState();
  }, [clearSessionState]);

  const deleteAccountHandler = useCallback(async () => {
    if (!activeTpin) {
      return;
    }

    await deleteStoredVendor(activeTpin);
    signOutVendorSession();
    clearSessionState();
  }, [activeTpin, clearSessionState]);

  const unlockWithPin = useCallback(async (pin: string) => {
    setIsBusy(true);
    try {
      const unlocked = await unlockActiveVendor(pin);
      setKeypair(unlocked);
      setPublicKey(unlocked.publicKey());
    } finally {
      setIsBusy(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!activeTpin) {
      return;
    }
    const sessionTpin = activeTpin;
    const stored = await getVendorProfile(sessionTpin);
    if (activeTpinRef.current !== sessionTpin) {
      return;
    }
    if (stored) {
      setProfile(stored);
      setPublicKey(stored.publicKey);
    }
  }, [activeTpin]);

  const value = useMemo<VendorWalletContextValue>(
    () => ({
      isReady,
      isAuthenticated: activeTpin !== null && publicKey !== null,
      activeTpin,
      publicKey,
      profile,
      isUnlocked: keypair !== null,
      keypair,
      isBusy,
      signUp,
      login,
      signOut,
      deleteAccount: deleteAccountHandler,
      unlockWithPin,
      refreshProfile,
    }),
    [
      isReady,
      activeTpin,
      publicKey,
      profile,
      keypair,
      isBusy,
      signUp,
      login,
      signOut,
      deleteAccountHandler,
      unlockWithPin,
      refreshProfile,
    ],
  );

  return (
    <VendorWalletContext.Provider value={value}>
      {children}
    </VendorWalletContext.Provider>
  );
}

export function useVendorWallet(): VendorWalletContextValue {
  const context = useContext(VendorWalletContext);
  if (context === undefined) {
    throw new Error("useVendorWallet must be used within a VendorWalletProvider");
  }
  return context;
}

export { WalletAuthError };
