"use client";

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
  createFunderAccount,
  getActiveFunderSessionSnapshot,
  loginFunderAccount,
  signOutFunderSession,
  WalletAuthError,
  type FunderRegistrationInput,
} from "@/src/lib/funderAuth";

export interface FunderAuthContextValue {
  isReady: boolean;
  isAuthenticated: boolean;
  organizationName: string | null;
  email: string | null;
  registeredPublicKey: string | null;
  isBusy: boolean;
  signUp: (input: FunderRegistrationInput) => Promise<void>;
  login: (email: string, pin: string) => Promise<void>;
  signOut: () => void;
}

const FunderAuthContext = createContext<FunderAuthContextValue | undefined>(
  undefined,
);

export function FunderAuthProvider({ children }: { children: ReactNode }) {
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [registeredPublicKey, setRegisteredPublicKey] = useState<string | null>(
    null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const snapshot = getActiveFunderSessionSnapshot();
    if (snapshot) {
      setOrganizationName(snapshot.organizationName);
      setEmail(snapshot.email);
      setRegisteredPublicKey(snapshot.publicKey);
    }
    setIsReady(true);
  }, []);

  const signUp = useCallback(async (input: FunderRegistrationInput) => {
    setIsBusy(true);
    try {
      await createFunderAccount(input);
      const session = await loginFunderAccount(input.email, input.pin);
      setOrganizationName(session.organizationName);
      setEmail(session.email);
      setRegisteredPublicKey(session.publicKey);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const login = useCallback(async (emailInput: string, pin: string) => {
    setIsBusy(true);
    try {
      const session = await loginFunderAccount(emailInput, pin);
      setOrganizationName(session.organizationName);
      setEmail(session.email);
      setRegisteredPublicKey(session.publicKey);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    signOutFunderSession();
    setOrganizationName(null);
    setEmail(null);
    setRegisteredPublicKey(null);
  }, []);

  const value = useMemo<FunderAuthContextValue>(
    () => ({
      isReady,
      isAuthenticated: email !== null && registeredPublicKey !== null,
      organizationName,
      email,
      registeredPublicKey,
      isBusy,
      signUp,
      login,
      signOut,
    }),
    [
      isReady,
      organizationName,
      email,
      registeredPublicKey,
      isBusy,
      signUp,
      login,
      signOut,
    ],
  );

  return (
    <FunderAuthContext.Provider value={value}>
      {children}
    </FunderAuthContext.Provider>
  );
}

export function useFunderAuth(): FunderAuthContextValue {
  const context = useContext(FunderAuthContext);
  if (context === undefined) {
    throw new Error("useFunderAuth must be used within a FunderAuthProvider");
  }
  return context;
}

export { WalletAuthError };
