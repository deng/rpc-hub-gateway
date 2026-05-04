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
| `eth-rpc.<your-domain>` | Ethereum | `eth-rpc-hub` | JSON-RPC |
| `bsc-rpc.<your-domain>` | BSC | `bsc-rpc-hub` | JSON-RPC (EVM) |
| `sol-rpc.<your-domain>` | Solana | `sol-rpc-hub` | JSON-RPC |
| `sui-rpc.<your-domain>` | Sui | `sui-rpc-hub` | JSON-RPC |
| `apt-rpc.<your-domain>` | Aptos | `apt-rpc-hub` | REST API |

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

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)，选择 `<your-domain>` 站点
2. **DNS → 添加记录**
3. 每条链一条 CNAME 记录，目标地址为对应 Worker 的 `*.workers.dev` 域名：

| 类型 | 名称 | 目标 | 代理 |
|------|------|------|------|
| `CNAME` | `eth-rpc` | `eth-rpc-hub.<你的CF子域名>.workers.dev` | ☁️ 已代理 |
| `CNAME` | `bsc-rpc` | `bsc-rpc-hub.<你的CF子域名>.workers.dev` | ☁️ 已代理 |
| `CNAME` | `sol-rpc` | `sol-rpc-hub.<你的CF子域名>.workers.dev` | ☁️ 已代理 |
| `CNAME` | `sui-rpc` | `sui-rpc-hub.<你的CF子域名>.workers.dev` | ☁️ 已代理 |
| `CNAME` | `apt-rpc` | `apt-rpc-hub.<你的CF子域名>.workers.dev` | ☁️ 已代理 |

> `workers.dev` 域名格式为 `<worker-name>.<cf-account-subdomain>.workers.dev`。其中 `<cf-account-subdomain>` 是 Cloudflare 账户级别的子域名，每个账户不同（如 `<你的CF子域名>`）。首次部署后控制台会输出完整 URL。

> 注意：DNS 记录必须开启橙色云（代理）状态，Worker 路由才能生效。

## Upstream 管理

每链一个配置文件 `config/<chain>.json`，编辑后一键同步到对应 Worker：

```bash
npm run upstream:sync -- eth   # 同步 ETH 上游
npm run upstream:sync -- bsc   # 同步 BSC 上游
npm run upstream:sync -- sol   # 同步 Solana 上游
npm run upstream:sync -- sui   # 同步 Sui 上游
npm run upstream:sync -- apt   # 同步 Aptos 上游
```

### 配置文件格式

`config/eth.json`:

```json
[
  {"url":"https://eth-mainnet.g.alchemy.com/v2/KEY","weight":3,"type":"primary","timeout":10000},
  {"url":"https://mainnet.infura.io/v3/KEY","weight":2,"type":"secondary","timeout":10000}
]
```

支持多节点负载均衡：
- **weight**: 权重，越高分配到请求越多
- **type**: `primary` / `secondary`，写请求优先选择 primary 节点，仅当全部 primary 不可用时回退到 secondary
- **timeout**: 单次请求超时时间（ms）
- 读请求（query）：使用 Promise.any 取最快响应
- 写请求（mutation）：按权重随机分发

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | JSON-RPC 2.0 request |
| `GET` | `/health` | Upstream health check |

## 隐私与安全

使用本仓库时请注意以下敏感信息：

| 内容 | 文件 | 风险 | 是否在 .gitignore |
|------|------|------|:-:|
| Cloudflare API Token | `.env` | 可操作你的 Cloudflare Worker | ✅ |
| RPC API Key (Alchemy/Infura) | `config/*.json` | API Key 泄露，被盗用产生费用 | ✅（除 template.json） |
| workers.dev 子域名 | `README.md / CLAUDE.md` | 暴露后可能被扫描攻击 | - |

**建议：**
- `config/*.json` 中的 API Key 已在 `.gitignore` 保护（保留 `template.json` 作为模板）
- 文档中 `*.workers.dev` 地址是账户特定信息，fork 后需替换为自己的地址
- Cloudflare API Token 请使用最小权限（仅 Worker 相关权限）

## Configuration

### Worker 环境变量

Set via `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `UPSTREAMS` | JSON array of upstream RPC endpoints |

通过 `config/*.json` + `npm run upstream:sync` 管理（推荐）。

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
