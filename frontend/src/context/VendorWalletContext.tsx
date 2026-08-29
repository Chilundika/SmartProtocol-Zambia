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

  useEffect(() => {
    const sessionTpin = getActiveVendorTpin();
    if (!sessionTpin) {
      setIsReady(true);
      return undefined;
    }

    const snapshot = getActiveVendorSnapshot();
    if (snapshot) {
      applySession(sessionTpin, snapshot, null, {
        setActiveTpin,
        setProfile,
        setPublicKey,
        setKeypair,
      });
      setIsReady(true);
    }

    const hydrate = () => {
      void getVendorProfile(sessionTpin)
        .then((latest) => {
          if (!latest) {
            signOutVendorSession();
            setActiveTpin(null);
            setProfile(null);
            setPublicKey(null);
            setKeypair(null);
            return;
          }

          applySession(sessionTpin, latest, null, {
            setActiveTpin,
            setProfile,
            setPublicKey,
            setKeypair,
          });
        })
        .catch(() => {
          if (!snapshot) {
            signOutVendorSession();
          }
        })
        .finally(() => {
          setIsReady(true);
        });
    };

    hydrate();
    return subscribeVendorRegistry(hydrate);
  }, []);

  const signUp = useCallback(async (input: VendorRegistrationInput) => {
    setIsBusy(true);
    try {
      const created = await createVendorAccount(input);
      const session = await loginVendorAccount(created.tpin, input.pin);
      applySession(session.tpin, session.profile, session.keypair, {
        setActiveTpin,
        setProfile,
        setPublicKey,
        setKeypair,
      });
    } finally {
      setIsBusy(false);
    }
  }, []);

  const login = useCallback(async (tpin: string, pin: string) => {
    setIsBusy(true);
    try {
      const session = await loginVendorAccount(tpin, pin);
      applySession(session.tpin, session.profile, session.keypair, {
        setActiveTpin,
        setProfile,
        setPublicKey,
        setKeypair,
      });
    } finally {
      setIsBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    signOutVendorSession();
    setActiveTpin(null);
    setProfile(null);
    setPublicKey(null);
    setKeypair(null);
  }, []);

  const deleteAccountHandler = useCallback(async () => {
    if (!activeTpin) {
      return;
    }

    await deleteStoredVendor(activeTpin);
    signOutVendorSession();
    setActiveTpin(null);
    setProfile(null);
    setPublicKey(null);
    setKeypair(null);
  }, [activeTpin]);

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
    const stored = await getVendorProfile(activeTpin);
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
