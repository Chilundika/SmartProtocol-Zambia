# SmartProtocol Zambia — Soroban contracts

Rust workspace for Soroban smart contracts. Matches the layout from `stellar contract init`.

## Layout

```
contracts/
├── Cargo.toml              # workspace root
└── contracts/
    └── hello_world/        # starter contract crate
```

## Commands

```bash
# Run unit tests
cargo test

# Build WASM (requires Stellar CLI and wasm32v1-none target)
stellar contract build
```

Install the CLI: https://developers.stellar.org/docs/tools/cli
