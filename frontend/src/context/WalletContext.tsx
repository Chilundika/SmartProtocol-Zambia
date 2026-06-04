"use client";

import {
  getAddress,
  isConnected as freighterExtensionInstalled,
  requestAccess,
} from "@stellar/freighter-api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  FreighterAddressResult,
  FreighterIsConnectedResult,
  WindowFreighterApi,
  WindowStarlightApi,
} from "@/src/types/wallet";

export interface WalletContextValue {
  isConnected: boolean;
  publicKey: string | null;
  isConnecting: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getWindowFreighter(): WindowFreighterApi | undefined {
  if (!isBrowser()) return undefined;
  return window.freighterApi;
}

function getWindowStarlight(): WindowStarlightApi | undefined {
  if (!isBrowser()) return undefined;
  return window.starlight;
}

async function requestFreighterAccess(): Promise<string> {
  const access: FreighterAddressResult = await requestAccess();
  if (access.error) {
    throw new Error(access.error.message);
  }
  if (!access.address) {
    throw new Error("Freighter did not return a public key.");
  }
  return access.address;
}

async function connectViaWindowFreighter(
  api: WindowFreighterApi,
): Promise<string> {
  const installed = await api.isConnected();
  if (installed.error) {
    throw new Error(installed.error.message);
  }
  if (!installed.isConnected) {
    throw new Error(
      "Freighter is not installed. Please install the Freighter browser extension.",
    );
  }

  const access = await api.requestAccess();
  if (access.error) {
    throw new Error(access.error.message);
  }
  if (!access.address) {
    throw new Error("Freighter did not return a public key.");
  }

  return access.address;
}

async function connectViaStarlight(api: WindowStarlightApi): Promise<string> {
  if (api.connect) {
    const result = await api.connect();
    const key =
      typeof result === "string" ? result : result.publicKey;
    if (!key) {
      throw new Error("Starlight did not return a public key.");
    }
    return key;
  }

  if (api.getPublicKey) {
    const key = await api.getPublicKey();
    if (!key) {
      throw new Error("Starlight did not return a public key.");
    }
    return key;
  }

  throw new Error("Starlight wallet API is not available.");
}

async function resolveWalletPublicKey(): Promise<string> {
  const installed: FreighterIsConnectedResult =
    await freighterExtensionInstalled();

  if (!installed.error && installed.isConnected) {
    return requestFreighterAccess();
  }

  const windowFreighter = getWindowFreighter();
  if (windowFreighter) {
    return connectViaWindowFreighter(windowFreighter);
  }

  const starlight = getWindowStarlight();
  if (starlight) {
    return connectViaStarlight(starlight);
  }

  throw new Error(
    "No Stellar wallet found. Install Freighter (https://www.freighter.app) or use a compatible wallet.",
  );
}

async function tryRestoreSession(): Promise<string | null> {
  if (!isBrowser()) return null;

  try {
    const installed = await freighterExtensionInstalled();
    if (!installed.isConnected || installed.error) {
      return null;
    }

    const { address, error } = await getAddress();
    if (error || !address) {
      return null;
    }
    return address;
  } catch {
    const windowFreighter = getWindowFreighter();
    if (windowFreighter) {
      try {
        const installed = await windowFreighter.isConnected();
        if (!installed.isConnected) return null;
        const { address, error } = await windowFreighter.getAddress();
        if (error || !address) return null;
        return address;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const isConnected = publicKey !== null;

  useEffect(() => {
    let cancelled = false;

    void tryRestoreSession().then((address) => {
      if (!cancelled && address) {
        setPublicKey(address);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    try {
      const address = await resolveWalletPublicKey();
      setPublicKey(address);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setPublicKey(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      isConnected,
      publicKey,
      isConnecting,
      connectWallet,
      disconnectWallet,
    }),
    [isConnected, publicKey, isConnecting, connectWallet, disconnectWallet],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
