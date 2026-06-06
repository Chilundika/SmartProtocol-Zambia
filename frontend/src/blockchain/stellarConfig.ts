/**
 * Stellar / Soroban testnet configuration for SmartProtocol Zambia.
 * Used by the frontend when connecting to the escrow factory contract.
 */

/** Soroban RPC endpoint for Stellar Testnet. */
export const STELLAR_TESTNET_RPC_URL =
  "https://soroban-testnet.stellar.org" as const;

/** Network passphrase for Stellar Testnet. */
export const STELLAR_TESTNET_NETWORK_PASSPHRASE =
  "Test SDF Network ; September 2015" as const;

/**
 * Deployed escrow factory contract ID on testnet.
 * Replace with the actual contract address after `stellar contract deploy`.
 */
export const ESCROW_FACTORY_CONTRACT_ID =
  "CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH" as const;

/**
 * Native XLM Stellar Asset Contract (SAC) on testnet.
 * Replace after deploying or look up the testnet native asset contract ID.
 */
export const NATIVE_XLM_TOKEN_CONTRACT_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" as const;
