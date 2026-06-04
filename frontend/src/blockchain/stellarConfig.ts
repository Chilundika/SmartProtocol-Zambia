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
  "REPLACE_WITH_DEPLOYED_CONTRACT_ID" as const;
