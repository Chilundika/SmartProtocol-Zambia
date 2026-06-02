# SmartProtocol Zambia

Monorepo for the SmartProtocol Zambia full-stack project.

## Structure

| Directory   | Stack                                      |
| ----------- | ------------------------------------------ |
| `frontend/` | Next.js 15, TypeScript, Tailwind, App Router |
| `contracts/`| Soroban smart contracts (Rust workspace)   |

## Prerequisites

- Node.js 18+ and npm
- Rust (stable) and `wasm32v1-none` target: `rustup target add wasm32v1-none`
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) for contract build/deploy

## Quick start

```bash
# Frontend
cd frontend && npm run dev

# Contracts (from contracts/)
cd contracts && cargo test
```
