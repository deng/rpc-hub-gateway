# RPC Hub — 区块链全链 RPC 反向代理网关设计文档

- **日期**: 2026-05-04
- **项目**: ZeroWallet / gateway / rpc-hub
- **状态**: 设计完成，待实现
- **技术栈**: TypeScript + Hono + Cloudflare Workers + Wrangler CLI

---

## 1. 概述

RPC Hub 是 ZeroWallet 的区块链全链 RPC 反向代理网关服务，为钱包 App 中转转发各类公链原生 RPC 接口请求。后端隐藏上游 RPC 供应商地址、管理密钥、负载均衡和故障转移，前端为钱包 App 提供统一、可靠的 RPC 访问入口。

### 核心目标

- **可靠**: 多上游负载均衡 + 自动故障转移，避免单点 RPC 供应商故障
- **灵活**: 按链独立部署，互不干扰，独立扩缩容
- **安全**: 无需钱包 App 持有任何 API Key，服务端管理所有凭证
- **高效**: 只读请求智能缓存，减少上游调用量，降低延迟
- **防滥用**: 多层限流保护，防止被爬虫/恶意刷量

---

## 2. 整体架构

### 2.1 多链独立部署模型

每条公链部署为独立的 Cloudflare Worker，绑定独立的二级域名：

```
eth.rpc-hub.example.com   →  ETH Worker（Ethereum JSON-RPC）
sol.rpc-hub.example.com   →  SOL Worker（Solana HTTP RPC，后续支持）
tron.rpc-hub.example.com  →  TRON Worker（后续支持）
...
```

**选型理由**:
- **隔离性**: 一条链的流量暴涨或上游故障不影响其他链
- **独立配置**: 每条链可独立配置上游池、限流阈值、缓存 TTL
- **独立部署**: 按链灰度发布，更新 ETH 不影响 SOL

### 2.2 单 Worker 内部模块

```
Wallet App ──HTTPS──►  Cloudflare Edge (DDoS 防护)
                            │
                            ▼
                      ┌─────────────┐
                      │  index.ts   │  ← 入口，解析环境变量加载链配置
                      │  router.ts  │  ← 路由：POST / (RPC), GET /health
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │ ratelimit.ts│  ← L2 内存限流（每 IP）
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │  cache.ts   │  ← 只读 RPC 请求缓存（Cache API）
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │ upstream.ts │  ← 上游池管理 + 负载均衡 + 故障检测
                      └──────┬──────┘
                             │ 并发请求 / 加权轮询
                             ▼
              ┌──────────────────────────┐
              │  Upstream 1  │  Upstream 2│  ...  (Infura / Alchemy / 自有节点)
              └──────────────────────────┘
```

### 2.3 代码复用策略

同一份代码仓库，通过 **环境变量 + wrangler 配置** 区分链部署。新增链时仅需：
1. 在 `src/chains/` 下添加链适配配置（方法白名单、缓存规则）
2. 在部署命令中传入对应的环境变量

---

## 3. 路由 & 请求处理

### 3.1 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/` | **唯一 RPC 入口**。body 为标准 JSON-RPC 2.0 请求格式 |
| `GET` | `/health` | 健康检查，返回各上游状态 |

### 3.2 JSON-RPC 处理流程

```
1. 解析 body
   ├── JSON 解析失败 → 400 {"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}
   └── 成功 → 提取 method, params, id

2. 判断请求类型
   ├── 批量请求（body 为数组）→ 拆分为单个请求，逐个处理，合并返回
   ├── 单个请求 → 继续
   └── 格式错误 → 400

3. method 分类
   ├── 只读方法（eth_call, eth_getBalance, eth_blockNumber...）
   │   ├── 检查缓存命中 → 命中直接返回
   │   └── 未命中 → 上游转发 → 可缓存的写入缓存
   ├── 写方法（eth_sendRawTransaction, eth_sendTransaction...）
   │   └── 直接上游转发，不缓存
   └── 方法不在白名单中
       └── 返回 400 JSON-RPC 错误码

4. 上游负载均衡转发（见第 4 节）

5. 处理上游响应
   ├── 超时 / 连接错误 / 5xx → 标记上游 degraded，重试其他上游
   └── 正常 → 构造 JSON-RPC 成功响应返回
```

### 3.3 不支持的功能

- **eth_subscribe / WebSocket**: Cloudflare Workers 不支持持久 WebSocket 连接。返回 400 告知客户端使用轮询
- **eth_newFilter / eth_getFilterChanges**: 不做 filter 支持（状态在 Workers 中无法持久化）

---

## 4. 上游管理 & 负载均衡

### 4.1 上游配置

通过环境变量 `UPSTREAMS` 注入 JSON 字符串数组：

```json
[
  {"url":"https://eth-mainnet.g.alchemy.com/v2/xxx","weight":3,"type":"primary","timeout":10000},
  {"url":"https://mainnet.infura.io/v3/xxx","weight":2,"type":"secondary","timeout":10000},
  {"url":"https://my-own-node.xyz:8545","weight":1,"type":"secondary","timeout":15000}
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 上游 RPC 端点 URL |
| `weight` | number | 负载均衡权重，越高分配越多流量 |
| `type` | "primary" / "secondary" | primary 优先使用，secondary 作为备用 |
| `timeout` | number | 单次请求超时（ms），默认 10000 |

对于需要 API Key 的上游（Infura, Alchemy 等），Key 直接拼入 URL 或通过单独的环境变量传入。

### 4.2 负载均衡策略

**读请求（只读方法）— First-Wins 竞速**:
- 同时向所有 active 上游并发发请求
- 取第一个成功响应的结果返回
- 其余正在进行中的请求自动取消（`AbortController`）
- 优势：延迟最优，自动选择当前最快的上游

**写请求 — 加权轮询 + 优先级**:
- 按 `weight` 比例分配，优先 `primary` 类型
- 只有当前 primary 都不可用时才使用 secondary
- 确保交易不会被不同节点回滚

### 4.3 故障检测 & 恢复

```
┌─────────────────────────────────────┐
│ 请求超时 / HTTP 5xx / 网络错误       │
│         │                           │
│         ▼                           │
│ 错误计数 +1，计算滑动窗口错误率      │
│         │                           │
│ 错误率 > 阈值 (连续3次失败)?         │
│   ├── 否 → 继续使用                  │
│   └── 是 → 标记 degraded，暂停分配 30s │
│              │                      │
│              30s 后 → 发送探测请求   │
│                ├── 成功 → 恢复 active│
│                └── 失败 → 继续暂停   │
└─────────────────────────────────────┘
```

### 4.4 上游健康检查端点 `/health`

```json
{
  "status": "healthy",
  "chain": "ethereum",
  "upstreams": [
    {"url":"https://eth-mainnet.g.alchemy.com/v2/xxx","status":"active","latency":120},
    {"url":"https://mainnet.infura.io/v3/xxx","status":"active","latency":200},
    {"url":"https://my-own-node.xyz:8545","status":"degraded","latency":0}
  ],
  "blockHeight": 21547896
}
```

---

## 5. 缓存策略

### 5.1 缓存原则

- **只缓存幂等只读请求**，写请求永不缓存
- 请求体 SHA256 作为缓存键，通过 Cache API 存储
- 差异化的 per-method TTL

### 5.2 缓存规则（EVM 示例）

| 方法 | TTL | 缓存策略 |
|------|-----|---------|
| `eth_chainId` | 3600s | 全局变量 + Cache API |
| `eth_blockNumber` | 3s | Cache API |
| `eth_getBalance` | 6s | Cache API |
| `eth_gasPrice` | 3s | Cache API |
| `eth_getTransactionCount` | 6s | Cache API |
| `eth_call` | 0s（默认不缓存） | 调用参数千变万化，命中率极低，跳过 |
| `eth_getBlockByNumber` | 6s | Cache API |
| `eth_getLogs` | 0s（不缓存） | 查询范围变化大，命中率低 |

### 5.3 实现方式

```typescript
// 伪代码
const bodyHash = await sha256(body);
const cacheKey = new Request(`https://cache/${bodyHash}`);

// 检查缓存
const cached = await caches.default.match(cacheKey);
if (cached) return cached;

// 上游转发
const response = await forward(body);

// 可缓存且状态正常 → 写入缓存
if (isCacheable(method) && response.ok) {
  const ttl = getMethodTTL(method);
  const resClone = response.clone();
  ctx.waitUntil(caches.default.put(cacheKey, resClone, { ttl }));
}

return response;
```

### 5.4 边界情况

- **批量请求**：不缓存（批次内可能混合读写）
- **错误响应**：不缓存（上游 4xx/5xx）
- **写方法**：即使 POST 到正确路径也不缓存

---

## 6. 限流 & 防滥用

### 6.1 三层防护模型

| 层级 | 粒度 | 限流值 | 实现 | 作用 |
|------|------|--------|------|------|
| L1: Cloudflare WAF | 全局 | 自动 | Cloudflare 原生 DDoS 防护 | 挡住大规模攻击 |
| L2: Worker 内存限流 | 每 IP | 100 req/s | 基于 CF 节点内存 + `cf-connecting-ip` | 防止单 IP 刷接口 |
| L3: 上游配额保护 | 每上游 | 按配置 | Worker 内滑动窗口计数 | 避免打爆免费层上游 |

### 6.2 L2 限流实现

Workers 在单 CF 边缘节点内共享全局内存，但不跨节点。对于 C 端钱包场景，单节点限流已足够防御大多数滥用行为。

```
key = `${ip}:${Math.floor(Date.now()/1000)}`
count = (MEMO.get(key) || 0) + 1
MEMO.set(key, count)

if count > 100:
  return new Response('Rate limit exceeded', { status: 429 })
```

如未来需要更精确的全局限流，引入 Durable Objects 做集中计数。

### 6.3 响应格式

限流响应使用标准 JSON 格式以便客户端解析：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "rate limit exceeded"
  },
  "id": null
}
```

---

## 7. 项目结构

```
gateway/rpc-hub/
├── src/
│   ├── index.ts             # Worker 入口，路由绑定，环境变量解析
│   ├── router.ts            # 路由分发（POST /, GET /health）
│   ├── upstream.ts          # 上游池管理、负载均衡、故障检测
│   ├── cache.ts             # 只读 RPC 缓存
│   ├── ratelimit.ts         # 内存级别限流
│   ├── chains/
│   │   ├── evm.ts           # EVM JSON-RPC 方法白名单 & 缓存规则
│   │   └── solana.ts        # Solana RPC 适配（后续实现）
│   ├── utils.ts             # 工具：SHA256 hash、日志、JSON-RPC 错误构造
│   └── types.ts             # 类型定义：Env, UpstreamConfig, RpcRequest 等
├── test/
│   ├── upstream.test.ts     # 上游管理 & 负载均衡测试
│   ├── cache.test.ts        # 缓存逻辑测试
│   ├── ratelimit.test.ts    # 限流逻辑测试
│   └── integration.test.ts  # 集成测试（模拟完整请求流）
├── wrangler.toml            # 基础 Worker 配置
├── package.json
├── tsconfig.json
├── .env.example
├── .dev.vars.example
└── README.md
```

### 部署脚本（package.json scripts）

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy:eth": "CHAIN=ethereum wrangler deploy --name eth-rpc-hub",
    "deploy:sol": "CHAIN=solana wrangler deploy --name sol-rpc-hub",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## 8. 配置 & 环境变量

### wrangler.toml 示例

```toml
name = "rpc-hub"
main = "src/index.ts"
compatibility_date = "2026-05-01"

[vars]
CHAIN = "ethereum"
CACHE_ENABLED = "true"
RPC_TIMEOUT = "10000"
UPSTREAMS = '[{"url":"...","weight":3,"type":"primary"}]'
```

**secrets**（通过 `wrangler secret put` 设置，不入库）:

| Secret | 说明 |
|--------|------|
| `UPSTREAMS` | 上游 RPC 端点配置 JSON（含 API Key） |

### .dev.vars 示例

```
CHAIN=ethereum
CACHE_ENABLED=true
RPC_TIMEOUT=10000
UPSTREAMS=[{"url":"https://eth-mainnet.g.alchemy.com/v2/demo","weight":1,"type":"primary"}]
```

---

## 9. 测试策略

| 测试 | 内容 | Mock |
|------|------|------|
| upstream.test.ts | 负载均衡策略选择、故障检测、degraded 恢复 | Mock `fetch` |
| cache.test.ts | 缓存命中/未命中、TTL 过期、不可缓存方法跳过 | Mock `caches.default` |
| ratelimit.test.ts | 限流阈值、429 响应、多 IP 隔离 | 模拟时间窗口 |
| integration.test.ts | 完整请求流：解析 → 限流 → 缓存 → 上游 → 响应 | Mock 全部外部依赖 |

延续 dex-swap 的模式：使用 `vitest`，通过 `vi.fn()` 模拟所有外部请求。

---

## 10. 边界情况 & 错误处理

| 场景 | 处理方式 |
|------|---------|
| 请求体非 JSON | 400, JSON-RPC Parse Error (-32700) |
| method 不在白名单 | 400, JSON-RPC Method Not Found (-32601) |
| 所有上游都 degraded | 502, JSON-RPC Internal Error (-32603) |
| 批量请求中有部分失败 | 逐项处理，返回混合成功/失败数组 |
| 请求体超大（>1MB） | 413 Payload Too Large |
| 非 POST 请求访问 / | 405 Method Not Allowed |
| eth_subscribe 请求 | 400, JSON-RPC Method Not Found + 说明不支持 |
| 上游响应非 JSON | 转发错误，返回 502 |
| Content-Type 非 application/json | 415 Unsupported Media Type |

---

## 11. 部署 & 运维

### 开发流程

```bash
# 1. 本地开发
cd gateway/rpc-hub
npm install
npm run dev

# 2. 测试
npm test

# 3. 部署 ETH 链
npm run deploy:eth

# 4. 部署 SOL 链（后续添加后）
npm run deploy:sol
```

### 运维要点

- **日志**: Cloudflare Workers Analytics + Logpush，按 worker name 区分
- **监控**: Workers Metrics Dashboard，关注 P95 延迟、错误率、429 触发量
- **告警**: 上游 degraded 次数过多时告警上游健康

---

## 12. 未来扩展

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Solana 链支持 | 高 | 新增 `src/chains/solana.ts`，适配 Solana HTTP RPC |
| 更多 EVM 链 | 中 | 新增链配置 + 部署，同 ETH 方案 |
| Durable Objects 精准限流 | 中 | 全局精确速率限制（当前内存限流已够用时推迟） |
| 请求日志到 R2 | 低 | 可选的 RPC 请求日志持久化 |
| Admin API | 低 | 动态管理上游节点（增删、权重调整） |

---

## 13. 设计决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 部署模型 | 单 Worker多链 / 每链独立 Worker | 每链独立 Worker | 隔离性最优，互不影响 |
| Web 框架 | Hono | Hono | 与 dex-swap 一致，轻量、类型安全 |
| 缓存 | Cache API / KV / D1 | Cache API | 低延迟，无额外计费 |
| 限流 | 内存 / Durable Objects | 内存 | 实现简单，对 C 端场景足够 |
| 负载均衡 | First-Wins / Round-Robin | 读: First-Wins, 写: 加权轮询 | 读追求最低延迟，写追求一致性 |
