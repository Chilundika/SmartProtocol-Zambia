#!/usr/bin/env bash
# Dry-run description of an escrow deployment.
# This script does not invoke the Stellar CLI and has no deployment path.
set -euo pipefail

usage() {
  echo "Usage: bash contracts/scripts/deploy-escrow.sh [--network <name>]" >&2
  echo "Dry-run only. This script does not deploy to any network." >&2
}

network="testnet"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "Missing network name." >&2
        usage
        exit 2
      fi
      network="$2"
      shift 2
      ;;
    --network=*)
      network="${1#*=}"
      if [[ -z "$network" ]]; then
        echo "Missing network name." >&2
        usage
        exit 2
      fi
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unrecognized argument: $1" >&2
      echo "This script is dry-run only. It does not accept a deploy or confirmation flag." >&2
      usage
      exit 2
      ;;
  esac
done

normalized="$(printf '%s' "$network" | tr '[:upper:]' '[:lower:]')"
case "$normalized" in
  mainnet|public|"public global stellar network ; september 2015")
    echo "Refusing network '${network}'. Mainnet is not available to this dry-run script." >&2
    exit 2
    ;;
  testnet|"test sdf network ; september 2015")
    ;;
  *)
    echo "Refusing network '${network}'. This dry-run describes Testnet only." >&2
    exit 2
    ;;
esac

echo "Dry run. No contract will be deployed."
echo "Network: testnet"
echo "Wasm path: contracts/target/wasm32v1-none/release/escrow.wasm"
echo "Source account label: deployer"
echo "The Stellar CLI is not invoked."
exit 0
