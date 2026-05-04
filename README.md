# RPC Hub

Blockchain full-chain RPC reverse proxy gateway for ZeroWallet.

Proxies native RPC requests for various public chains (ETH, SOL, etc.) through
Cloudflare Workers, providing load balancing, failover, caching, and rate limiting.

## Architecture

```
Wallet App → Cloudflare Worker → Upstream RPC Pool (Alchemy / Infura / Self-hosted)
```

Each chain is deployed as an independent Worker:

| Domain | Chain | Worker Name | RPC Protocol |
|--------|-------|-------------|-------------|
| `eth-rpc.bithub.pro` | Ethereum | `eth-rpc-hub` | JSON-RPC |
| `bsc-rpc.bithub.pro` | BSC | `bsc-rpc-hub` | JSON-RPC (EVM) |
| `sol-rpc.bithub.pro` | Solana | `sol-rpc-hub` | JSON-RPC |
| `sui-rpc.bithub.pro` | Sui | `sui-rpc-hub` | JSON-RPC |
| `apt-rpc.bithub.pro` | Aptos | `apt-rpc-hub` | REST API |

## Getting Started

```bash
npm install
npm run dev     # local dev on :8787
```

## Deploy

```bash
# Ethereum
npm run deploy:eth

# BSC (EVM compatible)
npm run deploy:bsc

# Solana
npm run deploy:sol

# Sui
npm run deploy:sui

# Aptos
npm run deploy:apt
```

## DNS 配置

Worker 部署后，需要在 Cloudflare Dashboard 添加 DNS 记录使自定义域名生效：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)，选择 `bithub.pro` 站点
2. **DNS → 添加记录**
3. 每条链一条 CNAME 记录：

| 类型 | 名称 | 目标 | 代理 |
|------|------|------|------|
| `CNAME` | `eth-rpc` | `eth-rpc-hub.deng-zz.workers.dev` | ☁️ 已代理 |
| `CNAME` | `bsc-rpc` | `bsc-rpc-hub.deng-zz.workers.dev` | ☁️ 已代理 |
| `CNAME` | `sol-rpc` | `sol-rpc-hub.deng-zz.workers.dev` | ☁️ 已代理 |
| `CNAME` | `sui-rpc` | `sui-rpc-hub.deng-zz.workers.dev` | ☁️ 已代理 |
| `CNAME` | `apt-rpc` | `apt-rpc-hub.deng-zz.workers.dev` | ☁️ 已代理 |

> 注意：DNS 记录必须开启橙色云（代理）状态，Worker 路由才能生效。

## Upstream 管理

```bash
npm run upstream:set    # 交互式设置完整的 UPSTREAMS JSON
npm run upstream:add    # 交互式新增上游节点
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
