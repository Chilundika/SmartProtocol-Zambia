/** Freighter extension API shape (window.freighterApi). */
export interface FreighterApiError {
  message: string;
}

export interface FreighterIsConnectedResult {
  isConnected: boolean;
  error?: FreighterApiError;
}

export interface FreighterAddressResult {
  address: string;
  error?: FreighterApiError;
}

export interface WindowFreighterApi {
  isConnected: () => Promise<FreighterIsConnectedResult>;
  requestAccess: () => Promise<FreighterAddressResult>;
  getAddress: () => Promise<FreighterAddressResult>;
}

/** Optional Starlight wallet injection (when extension is present). */
export interface WindowStarlightApi {
  isConnected?: () => Promise<boolean>;
  connect?: () => Promise<{ publicKey: string } | string>;
  getPublicKey?: () => Promise<string>;
}

declare global {
  interface Window {
    freighterApi?: WindowFreighterApi;
    starlight?: WindowStarlightApi;
    stellar?: {
      platform?: string;
    };
  }
}

export {};
