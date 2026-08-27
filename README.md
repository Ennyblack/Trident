<div align="center">

# 🔱 Trident

**Soroban Event Indexer for Stellar**

[![Status: Pre-Alpha](https://img.shields.io/badge/Status%20Pre--Alpha-orange?style=flat-square)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](./LICENSE)
[![Built with Rust](https://img.shields.io/badge/Built%20with-Rust-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Network: Stellar](https://img.shields.io/badge/Network-Stellar%20%2F%20Soroban-black?style=flat-square)](https://stellar.org)

*The indexing layer Stellar's developer ecosystem needs.*

> 🚀 **New here? Check out the [10-Minute Quickstart Guide](./docs/site/quickstart.md) to go from zero to a decoded event in all five SDK languages!**

</div>

---

## Quick Start

### Prerequisites
Before running Trident locally, make sure you have the following installed:
- **Docker** with Compose v2
- **Rust** (via [rustup](https://rustup.rs))
- **Go** (1.21+)
- **Node.js** (20 LTS+)

### Setup & Run
Get the entire development stack running in seconds:
```bash
cp .env.example .env
make dev
```

This command will:
1. Start Postgres and Redis via Docker Compose.
2. Wait for Postgres to be healthy.
3. Apply all database migrations automatically.
4. Compile and start the Rust indexer, the Rust gRPC API, and the Go REST API.

Use `Ctrl+C` or `make stop` to cleanly shut down all services.

---

## The Problem

Soroban's RPC node is intentionally thin — no long-term event storage, no historical queries, no filtering. That's a reasonable protocol design, but it leaves application developers to build their own polling loops, database schemas, and reorg handlers from scratch. Trident solves this with robust indexing, real-time streaming, and multi-language SDKs.