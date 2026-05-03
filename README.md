# RPC Hub

Blockchain full-chain RPC reverse proxy gateway for ZeroWallet.

Proxies native RPC requests for various public chains (ETH, SOL, etc.) through
Cloudflare Workers, providing load balancing, failover, caching, and rate limiting.

## Architecture

```
Wallet App → Cloudflare Worker → Upstream RPC Pool (Alchemy / Infura / Self-hosted)
```

Each chain is deployed as an independent Worker:

| Domain | Chain | Worker Name |
|--------|-------|-------------|
| `eth.rpc-hub.example.com` | Ethereum | `eth-rpc-hub` |
| `sol.rpc-hub.example.com` | Solana | `sol-rpc-hub` |

## Getting Started

```bash
npm install
npm run dev     # local dev on :8787
```

## Deploy

```bash
# Ethereum
npm run deploy:eth

# Solana
npm run deploy:sol
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | JSON-RPC 2.0 request |
| `GET` | `/health` | Upstream health check |

## Configuration

Set via `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `UPSTREAMS` | JSON array of upstream RPC endpoints |

### Upstream format

```json
[
  {"url":"https://eth-mainnet.g.alchemy.com/v2/KEY","weight":3,"type":"primary","timeout":10000},
  {"url":"https://mainnet.infura.io/v3/KEY","weight":2,"type":"secondary","timeout":10000}
]
```

## Testing

```bash
npm test        # Run all tests
npm run typecheck  # TypeScript check
```

## Features

- **Load balancing**: First-Wins for reads, weighted round-robin for writes
- **Failover**: Automatic degraded detection with 30s recovery
- **Caching**: Per-method TTL via Cache API (eth_chainId: 1h, eth_blockNumber: 3s)
- **Rate limiting**: Per-IP limit (100 req/s)
- **Batch support**: JSON-RPC batch request handling
