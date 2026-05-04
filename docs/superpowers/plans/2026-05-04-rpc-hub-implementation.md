# RPC Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the blockchain full-chain RPC reverse proxy gateway (`rpc-hub`) as a Cloudflare Worker, starting with Ethereum (EVM) support.

**Architecture:** Single Hono Worker with modular internal components (upstream pool, cache, rate limiter). Chain-specific config in `src/chains/`. Multi-chain via separate deployments with env vars. Testing pattern follows dex-swap: dynamic imports, mock `fetch`, `app.fetch()` direct calls.

**Tech Stack:** TypeScript + Hono v4 + Cloudflare Workers + Vitest + Wrangler CLI

---

### Task 1: Project Scaffolding

**Files:**
- Create: `gateway/rpc-hub/package.json`
- Create: `gateway/rpc-hub/tsconfig.json`
- Create: `gateway/rpc-hub/wrangler.toml`
- Create: `gateway/rpc-hub/.gitignore`
- Create: `gateway/rpc-hub/.env.example`
- Create: `gateway/rpc-hub/.dev.vars.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "rpc-hub",
  "version": "0.1.0",
  "description": "Blockchain full-chain RPC reverse proxy gateway for ZeroWallet",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "dotenv -- wrangler deploy",
    "deploy:eth": "CHAIN=ethereum dotenv -- wrangler deploy --name eth-rpc-hub",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.12.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250201.0",
    "dotenv-cli": "^11.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.100.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ES2022",
    "lib": ["ES2021"],
    "types": ["@cloudflare/workers-types"],
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "outDir": "dist",
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `wrangler.toml`**

```toml
name = "rpc-hub"
main = "src/index.ts"
compatibility_date = "2026-05-01"

[vars]
CHAIN = "ethereum"
CACHE_ENABLED = "true"
RPC_TIMEOUT = "10000"
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
.wrangler/
.dev.vars
```

- [ ] **Step 5: Create `.env.example`**

```
CLOUDFLARE_API_TOKEN=
```

- [ ] **Step 6: Create `.dev.vars.example`**

```
CHAIN=ethereum
CACHE_ENABLED=true
RPC_TIMEOUT=10000
UPSTREAMS=[{"url":"https://eth-mainnet.g.alchemy.com/v2/demo","weight":1,"type":"primary","timeout":10000}]
```

- [ ] **Step 7: Install dependencies**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npm install
```

- [ ] **Step 8: Create empty source directories so tsc doesn't complain**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && mkdir -p src/chains test
```

- [ ] **Step 9: Verify TypeScript compiles cleanly**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/package.json gateway/rpc-hub/tsconfig.json gateway/rpc-hub/wrangler.toml gateway/rpc-hub/.gitignore gateway/rpc-hub/.env.example gateway/rpc-hub/.dev.vars.example gateway/rpc-hub/package-lock.json
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "chore(rpc-hub): scaffold project structure"
```

---

### Task 2: Types and Utilities

**Files:**
- Create: `gateway/rpc-hub/src/types.ts`
- Create: `gateway/rpc-hub/src/utils.ts`
- Create: `gateway/rpc-hub/test/utils.test.ts`

- [ ] **Step 1: Create `src/types.ts`**

```typescript
import { Context } from 'hono';

export interface UpstreamConfig {
  url: string;
  weight: number;
  type: 'primary' | 'secondary';
  timeout: number;
}

export interface Env {
  CHAIN: string;
  CACHE_ENABLED: string;
  RPC_TIMEOUT: string;
  UPSTREAMS: string;
}

export interface RpcRequest {
  jsonrpc: string;
  method: string;
  params: unknown[];
  id: number | string | null;
}

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcResponse {
  jsonrpc: string;
  result?: unknown;
  error?: RpcError;
  id: number | string | null;
}

export type UpstreamStatus = 'active' | 'degraded' | 'unknown';

export interface UpstreamState {
  config: UpstreamConfig;
  status: UpstreamStatus;
  failures: number;
  lastFailure: number;
  latency: number;
}

export type Bindings = Env;

export type Variables = {
  upstreamStates: UpstreamState[];
};

export interface ChainConfig {
  name: string;
  readMethods: Set<string>;
  writeMethods: Set<string>;
  cacheRules: Map<string, number>;
}

export type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
```

- [ ] **Step 2: Create `src/utils.ts`**

```typescript
import { RpcRequest, RpcResponse } from './types';

export function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(data)).then(hashBuffer => {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

export function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
): RpcResponse {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

export function jsonRpcResult(
  id: number | string | null,
  result: unknown,
): RpcResponse {
  return { jsonrpc: '2.0', result, id };
}

export function parseRpcBody(body: unknown): {
  requests: RpcRequest[];
  isBatch: boolean;
} {
  if (Array.isArray(body)) {
    return { requests: body as RpcRequest[], isBatch: true };
  }
  return { requests: [body as RpcRequest], isBatch: false };
}

export function extractMethod(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? (parsed[0] as RpcRequest).method : null;
    }
    return (parsed as RpcRequest).method ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Create `test/utils.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { sha256, jsonRpcError, jsonRpcResult, parseRpcBody, extractMethod } from '../src/utils';

describe('sha256', () => {
  it('produces a consistent 64-char hex hash', async () => {
    const hash = await sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for same input', async () => {
    expect(await sha256('test')).toBe(await sha256('test'));
  });

  it('produces different hashes for different inputs', async () => {
    expect(await sha256('abc')).not.toBe(await sha256('xyz'));
  });
});

describe('jsonRpcError / jsonRpcResult', () => {
  it('builds a parse error', () => {
    expect(jsonRpcError(null, -32700, 'Parse error')).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
  });

  it('builds a success response', () => {
    expect(jsonRpcResult(1, '0x1')).toEqual({
      jsonrpc: '2.0',
      result: '0x1',
      id: 1,
    });
  });
});

describe('parseRpcBody', () => {
  it('parses a single request', () => {
    const { requests, isBatch } = parseRpcBody({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
    expect(isBatch).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('parses a batch', () => {
    const { requests, isBatch } = parseRpcBody([
      { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 },
      { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 2 },
    ]);
    expect(isBatch).toBe(true);
    expect(requests).toHaveLength(2);
  });
});

describe('extractMethod', () => {
  it('extracts method from single request', () => {
    expect(extractMethod('{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}')).toBe('eth_blockNumber');
  });

  it('extracts method from first batch item', () => {
    expect(extractMethod('[{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}]')).toBe('eth_blockNumber');
  });

  it('returns null for invalid JSON', () => {
    expect(extractMethod('not json')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(extractMethod('[]')).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx vitest run test/utils.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/src/types.ts gateway/rpc-hub/src/utils.ts gateway/rpc-hub/test/utils.test.ts
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "feat(rpc-hub): add types and utility functions"
```

---

### Task 3: EVM Chain Config

**Files:**
- Create: `gateway/rpc-hub/src/chains/evm.ts`
- Create: `gateway/rpc-hub/test/chains/evm.test.ts`

- [ ] **Step 1: Create `src/chains/evm.ts`**

```typescript
import { ChainConfig } from '../types';

const READ_METHODS = [
  'eth_blockNumber', 'eth_getBalance', 'eth_getStorageAt',
  'eth_getTransactionCount', 'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber', 'eth_getUncleCountByBlockHash',
  'eth_getUncleCountByBlockNumber', 'eth_getCode', 'eth_call',
  'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_getBlockByHash', 'eth_getBlockByNumber',
  'eth_getTransactionByHash', 'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex', 'eth_getTransactionReceipt',
  'eth_getBlockReceipts', 'eth_getLogs', 'eth_chainId',
  'eth_getUncleByBlockHashAndIndex', 'eth_getUncleByBlockNumberAndIndex',
  'eth_syncing', 'eth_hashrate', 'eth_mining', 'eth_coinbase',
  'eth_accounts', 'eth_getProof', 'net_version', 'net_listening',
  'net_peerCount', 'web3_clientVersion', 'web3_sha3',
];

const WRITE_METHODS = [
  'eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign',
  'eth_signTransaction', 'eth_signTypedData', 'eth_signTypedData_v4',
  'personal_sign',
];

const CACHE_RULES: [string, number][] = [
  ['eth_chainId', 3600],
  ['net_version', 3600],
  ['eth_blockNumber', 3],
  ['eth_getBalance', 6],
  ['eth_gasPrice', 3],
  ['eth_maxPriorityFeePerGas', 3],
  ['eth_getTransactionCount', 6],
  ['eth_getBlockByNumber', 6],
];

export function getEvmConfig(): ChainConfig {
  return {
    name: 'evm',
    readMethods: new Set(READ_METHODS),
    writeMethods: new Set(WRITE_METHODS),
    cacheRules: new Map(CACHE_RULES),
  };
}
```

- [ ] **Step 2: Create `test/chains/evm.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { getEvmConfig } from '../../src/chains/evm';

describe('getEvmConfig', () => {
  const config = getEvmConfig();

  it('returns name evm', () => {
    expect(config.name).toBe('evm');
  });

  it('classifies eth_blockNumber as read', () => {
    expect(config.readMethods.has('eth_blockNumber')).toBe(true);
  });

  it('classifies eth_sendRawTransaction as write', () => {
    expect(config.writeMethods.has('eth_sendRawTransaction')).toBe(true);
  });

  it('read and write sets are disjoint', () => {
    for (const m of config.readMethods) {
      expect(config.writeMethods.has(m)).toBe(false);
    }
  });

  it('has cache rules for common methods', () => {
    expect(config.cacheRules.has('eth_chainId')).toBe(true);
    expect(config.cacheRules.has('eth_blockNumber')).toBe(true);
  });

  it('eth_call is not cached', () => {
    expect(config.cacheRules.has('eth_call')).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx vitest run test/chains/evm.test.ts
```
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/src/chains/evm.ts gateway/rpc-hub/test/chains/evm.test.ts
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "feat(rpc-hub): add EVM chain config with method classification"
```

---

### Task 4: Upstream Management

**Files:**
- Create: `gateway/rpc-hub/src/upstream.ts`
- Create: `gateway/rpc-hub/test/upstream.test.ts`

- [ ] **Step 1: Create `src/upstream.ts`**

```typescript
import { UpstreamConfig, UpstreamState } from './types';

export function parseUpstreams(raw: string): UpstreamConfig[] {
  try {
    return JSON.parse(raw) as UpstreamConfig[];
  } catch {
    throw new Error('Invalid UPSTREAMS JSON: failed to parse');
  }
}

export function createUpstreamStates(configs: UpstreamConfig[]): UpstreamState[] {
  return configs.map(c => ({
    config: c,
    status: 'active' as const,
    failures: 0,
    lastFailure: 0,
    latency: 0,
  }));
}

function getActiveUpstreams(states: UpstreamState[]): UpstreamState[] {
  const now = Date.now();
  return states.filter(s => {
    if (s.status === 'active') return true;
    // degraded for more than 30s → attempt recovery
    if (s.status === 'degraded' && now - s.lastFailure > 30_000) {
      s.status = 'unknown';
      return true;
    }
    return false;
  });
}

export function selectUpstreamForWrite(states: UpstreamState[]): UpstreamState | null {
  const active = getActiveUpstreams(states);
  if (active.length === 0) return null;

  const pool = active.filter(s => s.config.type === 'primary');
  const candidates = pool.length > 0 ? pool : active;

  const totalWeight = candidates.reduce((sum, s) => sum + s.config.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const s of candidates) {
    rand -= s.config.weight;
    if (rand <= 0) return s;
  }
  return candidates[candidates.length - 1];
}

export function selectUpstreamsForRead(states: UpstreamState[]): UpstreamState[] {
  return getActiveUpstreams(states);
}

export function recordSuccess(state: UpstreamState, latency: number): void {
  state.status = 'active';
  state.failures = 0;
  state.latency = latency;
}

export function recordFailure(state: UpstreamState): void {
  state.failures += 1;
  state.lastFailure = Date.now();
  if (state.failures >= 3) {
    state.status = 'degraded';
  }
}

export function isAllDegraded(states: UpstreamState[]): boolean {
  return getActiveUpstreams(states).length === 0;
}

export function getUpstreamsHealth(states: UpstreamState[]) {
  return states.map(s => ({
    url: s.config.url,
    status: s.status,
    latency: s.status === 'active' ? s.latency : 0,
  }));
}
```

- [ ] **Step 2: Create `test/upstream.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseUpstreams, createUpstreamStates, selectUpstreamForWrite,
  selectUpstreamsForRead, recordSuccess, recordFailure,
  isAllDegraded, getUpstreamsHealth,
} from '../src/upstream';
import { UpstreamState } from '../src/types';

function makeState(url: string, overrides?: Partial<UpstreamState>): UpstreamState {
  return {
    config: { url, weight: 1, type: 'primary', timeout: 10000, ...(overrides?.config || {}) },
    status: 'active',
    failures: 0,
    lastFailure: 0,
    latency: 0,
    ...overrides,
    config: { url, weight: 1, type: 'primary', timeout: 10000, ...(overrides?.config || {}) },
  };
}

describe('parseUpstreams', () => {
  it('parses valid JSON', () => {
    const raw = '[{"url":"https://a.com","weight":3,"type":"primary","timeout":10000}]';
    expect(parseUpstreams(raw)).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseUpstreams('not json')).toThrow('Invalid UPSTREAMS JSON');
  });
});

describe('selectUpstreamForWrite', () => {
  it('prefers primary type', () => {
    const states = [
      makeState('a', { config: { url: 'a', weight: 1, type: 'primary', timeout: 10000 } }),
      makeState('b', { config: { url: 'b', weight: 1, type: 'secondary', timeout: 10000 } }),
    ];
    const result = selectUpstreamForWrite(states);
    expect(result!.config.type).toBe('primary');
  });

  it('falls back to secondary when primary is degraded', () => {
    const states = [
      makeState('a', { status: 'degraded', failures: 3, lastFailure: Date.now(), config: { url: 'a', weight: 1, type: 'primary', timeout: 10000 } }),
      makeState('b', { config: { url: 'b', weight: 1, type: 'secondary', timeout: 10000 } }),
    ];
    expect(selectUpstreamForWrite(states)!.config.url).toBe('b');
  });

  it('returns null when all degraded', () => {
    const now = Date.now();
    const states = [
      makeState('a', { status: 'degraded', failures: 3, lastFailure: now, config: { url: 'a', weight: 1, type: 'primary', timeout: 10000 } }),
      makeState('b', { status: 'degraded', failures: 3, lastFailure: now, config: { url: 'b', weight: 1, type: 'secondary', timeout: 10000 } }),
    ];
    expect(selectUpstreamForWrite(states)).toBeNull();
  });
});

describe('selectUpstreamsForRead', () => {
  it('excludes degraded upstreams', () => {
    const states = [
      makeState('a'),
      makeState('b', { status: 'degraded', failures: 3, lastFailure: Date.now() }),
    ];
    expect(selectUpstreamsForRead(states)).toHaveLength(1);
  });
});

describe('recordFailure / recordSuccess', () => {
  it('degrades after 3 failures', () => {
    const state = makeState('a');
    recordFailure(state); recordFailure(state); recordFailure(state);
    expect(state.status).toBe('degraded');
  });

  it('recovers on success', () => {
    const state = makeState('a', { failures: 5, status: 'degraded', lastFailure: 1000 });
    recordSuccess(state, 50);
    expect(state.status).toBe('active');
    expect(state.failures).toBe(0);
    expect(state.latency).toBe(50);
  });
});

describe('isAllDegraded', () => {
  it('returns true when none active', () => {
    const states = [makeState('a', { status: 'degraded', failures: 3, lastFailure: Date.now() })];
    expect(isAllDegraded(states)).toBe(true);
  });

  it('returns false when one is active', () => {
    const states = [
      makeState('a'),
      makeState('b', { status: 'degraded', failures: 3, lastFailure: Date.now() }),
    ];
    expect(isAllDegraded(states)).toBe(false);
  });
});

describe('getUpstreamsHealth', () => {
  it('reports status for each upstream', () => {
    const states = [
      makeState('a', { latency: 42 }),
      makeState('b', { status: 'degraded', failures: 3, lastFailure: Date.now() }),
    ];
    expect(getUpstreamsHealth(states)).toEqual([
      { url: 'a', status: 'active', latency: 42 },
      { url: 'b', status: 'degraded', latency: 0 },
    ]);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx vitest run test/upstream.test.ts
```
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/src/upstream.ts gateway/rpc-hub/test/upstream.test.ts
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "feat(rpc-hub): add upstream management with load balancing and failover"
```

---

### Task 5: Rate Limiter

**Files:**
- Create: `gateway/rpc-hub/src/ratelimit.ts`
- Create: `gateway/rpc-hub/test/ratelimit.test.ts`

- [ ] **Step 1: Create `src/ratelimit.ts`**

```typescript
// In-memory IP-based rate limiter.
// Per-CF-node isolation is sufficient for C-wallet abuse protection.

const buckets = new Map<string, { count: number; windowStart: number }>();

export const DEFAULT_LIMIT = 100;
export const DEFAULT_WINDOW_MS = 1000;

export function checkRateLimit(
  ip: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const key = `${ip}:${Math.floor(now / windowMs)}`;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: limit - bucket.count };
}

// Cleanup old entries to avoid unbounded growth.
export function cleanupBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > DEFAULT_WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
}
```

- [ ] **Step 2: Create `test/ratelimit.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { checkRateLimit, cleanupBuckets } from '../src/ratelimit';

describe('checkRateLimit', () => {
  afterEach(() => cleanupBuckets());

  it('allows first request', () => {
    const result = checkRateLimit('1.2.3.4', 5, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('blocks when exceeding limit', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4', 5, 1000);
    expect(checkRateLimit('1.2.3.4', 5, 1000).allowed).toBe(false);
  });

  it('treats different IPs independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4', 5, 1000);
    expect(checkRateLimit('5.6.7.8', 5, 1000).allowed).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx vitest run test/ratelimit.test.ts
```
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/src/ratelimit.ts gateway/rpc-hub/test/ratelimit.test.ts
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "feat(rpc-hub): add IP-based rate limiter"
```

---

### Task 6: Cache Module

**Files:**
- Create: `gateway/rpc-hub/src/cache.ts`
- Create: `gateway/rpc-hub/test/cache.test.ts`

- [ ] **Step 1: Create `src/cache.ts`**

```typescript
import { ChainConfig } from './types';

export function isCacheable(method: string, chainConfig: ChainConfig): boolean {
  if (!chainConfig.readMethods.has(method)) return false;
  return chainConfig.cacheRules.has(method);
}

export function getMethodTTL(method: string, chainConfig: ChainConfig): number {
  return chainConfig.cacheRules.get(method) ?? 0;
}

export async function getCacheKey(body: string): Promise<Request> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://cache/${hash}`);
}

export async function getCached(key: Request): Promise<Response | null> {
  try {
    return await caches.default.match(key);
  } catch {
    return null;
  }
}

export async function setCache(
  key: Request,
  response: Response,
  ttl: number,
  ctx: ExecutionContext,
): Promise<void> {
  if (ttl <= 0) return;
  const cloned = response.clone();
  ctx.waitUntil(caches.default.put(key, cloned));
}
```

- [ ] **Step 2: Create `test/cache.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { isCacheable, getMethodTTL } from '../src/cache';
import { getEvmConfig } from '../src/chains/evm';

const evmConfig = getEvmConfig();

describe('isCacheable', () => {
  it('caches methods with explicit rules', () => {
    expect(isCacheable('eth_chainId', evmConfig)).toBe(true);
    expect(isCacheable('eth_blockNumber', evmConfig)).toBe(true);
  });

  it('does not cache write methods', () => {
    expect(isCacheable('eth_sendRawTransaction', evmConfig)).toBe(false);
  });

  it('does not cache read methods without rules', () => {
    expect(isCacheable('eth_call', evmConfig)).toBe(false);
  });

  it('does not cache unknown methods', () => {
    expect(isCacheable('unknown_method', evmConfig)).toBe(false);
  });
});

describe('getMethodTTL', () => {
  it('returns 3600 for eth_chainId', () => {
    expect(getMethodTTL('eth_chainId', evmConfig)).toBe(3600);
  });

  it('returns 0 for uncached methods', () => {
    expect(getMethodTTL('eth_call', evmConfig)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx vitest run test/cache.test.ts
```
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/src/cache.ts gateway/rpc-hub/test/cache.test.ts
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "feat(rpc-hub): add RPC cache module"
```

---

### Task 7: Main Worker (Index)

**Files:**
- Create: `gateway/rpc-hub/src/index.ts`
- Create: `gateway/rpc-hub/test/index.test.ts`

- [ ] **Step 1: Create `src/index.ts`**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Variables, RpcRequest, ChainConfig, UpstreamState } from './types';
import { getEvmConfig } from './chains/evm';
import {
  parseUpstreams, createUpstreamStates, selectUpstreamForWrite,
  selectUpstreamsForRead, recordSuccess, recordFailure,
  isAllDegraded, getUpstreamsHealth,
} from './upstream';
import { parseRpcBody, jsonRpcError } from './utils';
import { checkRateLimit, cleanupBuckets } from './ratelimit';
import { isCacheable, getMethodTTL, getCacheKey, getCached, setCache } from './cache';

function loadChainConfig(env: Env): ChainConfig {
  const chain = (env.CHAIN || 'ethereum').toLowerCase();
  return chain === 'ethereum' || chain === 'evm' ? getEvmConfig() : getEvmConfig();
}

async function forwardSingle(
  bodyStr: string,
  states: UpstreamState[],
  isRead: boolean,
  timeoutMs: number,
): Promise<{ data: unknown; status: number }> {
  if (isRead) {
    const upstreams = selectUpstreamsForRead(states);
    if (upstreams.length === 0) {
      return { data: jsonRpcError(null, -32603, 'all upstreams are degraded'), status: 502 };
    }

    const controllers = upstreams.map(() => new AbortController());
    const fetches = upstreams.map((state, i) =>
      fetch(state.config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: controllers[i].signal,
      }).then(async (res) => {
        const start = Date.now();
        const data = await res.json();
        recordSuccess(state, Date.now() - start);
        controllers.forEach((c, j) => { if (j !== i) c.abort(); });
        return { data, status: res.status };
      }).catch((err) => {
        recordFailure(state);
        throw err;
      }),
    );

    try {
      return await Promise.any(fetches);
    } catch {
      return { data: jsonRpcError(null, -32603, 'all upstreams failed'), status: 502 };
    }
  }

  // Write: weighted selection, retry once on failure
  const first = selectUpstreamForWrite(states);
  if (!first) {
    return { data: jsonRpcError(null, -32603, 'all upstreams are degraded'), status: 502 };
  }

  try {
    const start = Date.now();
    const res = await fetch(first.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    recordSuccess(first, Date.now() - start);
    return { data, status: res.status };
  } catch {
    recordFailure(first);
    const second = selectUpstreamForWrite(states);
    if (!second || second.config.url === first.config.url) {
      return { data: jsonRpcError(null, -32603, 'upstream request failed'), status: 502 };
    }
    try {
      const start = Date.now();
      const res = await fetch(second.config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json();
      recordSuccess(second, Date.now() - start);
      return { data, status: res.status };
    } catch {
      recordFailure(second);
      return { data: jsonRpcError(null, -32603, 'upstream request failed'), status: 502 };
    }
  }
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

// --- Health check ---
app.get('/health', async (c) => {
  const states = c.get('upstreamStates');
  if (!states) {
    return c.json({ status: 'healthy', chain: c.env.CHAIN || 'ethereum' });
  }
  return c.json({
    status: isAllDegraded(states) ? 'degraded' : 'healthy',
    chain: c.env.CHAIN || 'ethereum',
    upstreams: getUpstreamsHealth(states),
  });
});

// --- RPC endpoint ---
app.post('/', async (c) => {
  const env = c.env;
  const chainConfig = loadChainConfig(env);
  const timeoutMs = parseInt(env.RPC_TIMEOUT || '10000', 10);
  const cacheEnabled = env.CACHE_ENABLED !== 'false';

  // Parse upstream config
  let states: UpstreamState[];
  try {
    states = createUpstreamStates(parseUpstreams(env.UPSTREAMS));
    c.set('upstreamStates', states);
  } catch {
    return c.json(jsonRpcError(null, -32603, 'server configuration error'), 500);
  }

  // Read body
  let bodyStr: string;
  try {
    bodyStr = await c.req.text();
  } catch {
    return c.json(jsonRpcError(null, -32700, 'Parse error'), 400);
  }

  if (bodyStr.length > 1_048_576) {
    return c.json(jsonRpcError(null, -32603, 'payload too large'), 413);
  }

  // Rate limit
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip).allowed) {
    return c.json(jsonRpcError(null, -32005, 'rate limit exceeded'), 429);
  }

  // Parse RPC body
  let requests: RpcRequest[];
  let isBatch: boolean;
  try {
    const parsed = parseRpcBody(JSON.parse(bodyStr));
    requests = parsed.requests;
    isBatch = parsed.isBatch;
  } catch {
    return c.json(jsonRpcError(null, -32700, 'Parse error'), 400);
  }

  // Batch handling
  if (isBatch) {
    const results = await Promise.all(
      requests.map(async (req) => {
        if (!req || !req.method) return jsonRpcError(null, -32601, 'Method not found');
        const bodySingle = JSON.stringify(req);
        if (cacheEnabled && isCacheable(req.method, chainConfig)) {
          const ck = await getCacheKey(bodySingle);
          const cached = await getCached(ck);
          if (cached) return cached.json();
        }
        const { data } = await forwardSingle(bodySingle, states, chainConfig.readMethods.has(req.method), timeoutMs);
        return data;
      }),
    );
    c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets()));
    return c.json(results);
  }

  // Single request
  const req = requests[0];
  if (!req || !req.method) {
    return c.json(jsonRpcError(null, -32601, 'Method not found'), 400);
  }

  const method = req.method;
  const isRead = chainConfig.readMethods.has(method);

  if (!isRead && !chainConfig.writeMethods.has(method)) {
    return c.json(jsonRpcError(null, -32601, `Method not found: ${method}`), 400);
  }

  if (method === 'eth_subscribe') {
    return c.json(jsonRpcError(null, -32601, 'eth_subscribe not supported, use polling instead'), 400);
  }

  // Cache hit
  if (isRead && cacheEnabled && isCacheable(method, chainConfig)) {
    const ck = await getCacheKey(bodyStr);
    const cached = await getCached(ck);
    if (cached) {
      const cachedData = await cached.json();
      return c.json(cachedData);
    }
  }

  // Forward
  const { data, status } = await forwardSingle(bodyStr, states, isRead, timeoutMs);

  // Post-response cache
  if (isRead && status === 200 && cacheEnabled && isCacheable(method, chainConfig)) {
    const ttl = getMethodTTL(method, chainConfig);
    if (ttl > 0) {
      const ck = await getCacheKey(bodyStr);
      const cacheRes = new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      await setCache(ck, cacheRes, ttl, c.executionCtx);
    }
  }

  c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets()));
  return c.json(data, status as 200 | 400 | 429 | 413 | 500 | 502);
});

export default { fetch: app.fetch };
```

- [ ] **Step 2: Create `test/index.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcResponse } from '../src/types';

const MOCK_UPSTREAMS = JSON.stringify([
  { url: 'https://rpc.ankr.com/eth', weight: 1, type: 'primary', timeout: 5000 },
]);

const MOCK_ENV = {
  CHAIN: 'ethereum',
  CACHE_ENABLED: 'false',
  RPC_TIMEOUT: '5000',
  UPSTREAMS: MOCK_UPSTREAMS,
};

function mockFetchOnce(data: unknown, status = 200) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('RPC Hub Worker', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('health endpoint returns healthy', async () => {
    const { default: worker } = await import('../src/index');
    const req = new Request('http://localhost/health');
    const res = await worker.fetch(req, MOCK_ENV);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('healthy');
  });

  it('proxies a valid RPC request and returns result', async () => {
    const { default: worker } = await import('../src/index');
    const rpcRes: RpcResponse = { jsonrpc: '2.0', result: '0x1', id: 1 };
    mockFetchOnce(rpcRes);

    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(200);
    const body = await res.json<RpcResponse>();
    expect(body.result).toBe('0x1');
  });

  it('returns 400 for unsupported method', async () => {
    const { default: worker } = await import('../src/index');
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_unknownMethod', params: [], id: 1 }),
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(400);
    const body = await res.json<RpcResponse>();
    expect(body.error?.code).toBe(-32601);
  });

  it('returns 400 for eth_subscribe', async () => {
    const { default: worker } = await import('../src/index');
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'], id: 1 }),
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON body', async () => {
    const { default: worker } = await import('../src/index');
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(400);
  });

  it('handles batch requests', async () => {
    const { default: worker } = await import('../src/index');
    mockFetchOnce({ jsonrpc: '2.0', result: '0x1', id: 1 });
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 },
      ]),
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(200);
    const body = await res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 413 for oversized payload', async () => {
    const { default: worker } = await import('../src/index');
    const largeBody = 'x'.repeat(2_000_000);
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1, padding: largeBody }),
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(413);
  });

  it('forwards write requests to upstream', async () => {
    const { default: worker } = await import('../src/index');
    const txHash = '0xabc123';
    mockFetchOnce({ jsonrpc: '2.0', result: txHash, id: 1 });

    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: ['0xsignedtx'],
        id: 1,
      }),
    });
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.status).toBe(200);
    const body = await res.json<RpcResponse>();
    expect(body.result).toBe(txHash);
  });

  it('returns CORS headers', async () => {
    const { default: worker } = await import('../src/index');
    const req = new Request('http://localhost/health');
    const res = await worker.fetch(req, MOCK_ENV);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx vitest run
```
Expected: 20+ tests PASS.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/src/index.ts gateway/rpc-hub/test/index.test.ts
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "feat(rpc-hub): main worker with RPC proxy, caching, and rate limiting"
```

---

### Task 8: README and CLAUDE.md

**Files:**
- Create: `gateway/rpc-hub/README.md`
- Create: `gateway/rpc-hub/CLAUDE.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Create `CLAUDE.md`**

```markdown
# CLAUDE.md

## Commands

```bash
npm run dev           # Start local Wrangler dev server on :8787
npm run deploy        # Deploy to Cloudflare Workers
npm run deploy:eth    # Deploy Ethereum worker
npm test              # Run all tests via Vitest
npm run typecheck     # Type-check with tsc --noEmit
```

## Architecture

**Modular Cloudflare Worker** (`src/index.ts`) that proxies JSON-RPC requests to configurable upstream pools. Each module has a single responsibility.

### Data flow

```
Wallet App → Hono Router → Rate Limiter → Cache → Upstream Pool → RPC Nodes
```

### Module layout

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Hono app, route handlers, orchestration |
| `src/upstream.ts` | Load balancing, failover, health tracking |
| `src/cache.ts` | Cache API wrapper with per-method TTL |
| `src/ratelimit.ts` | IP-based in-memory rate limiter |
| `src/chains/evm.ts` | EVM method classification & cache rules |
| `src/utils.ts` | SHA256, JSON-RPC helpers |
| `src/types.ts` | TypeScript interfaces |

### Testing pattern

Tests use Hono's `app.fetch()` directly. Mock `Env` objects provide test config.
`globalThis.fetch` is mocked with `vi.fn()` to simulate upstream responses.

```typescript
const { default: worker } = await import('../src/index');
const req = new Request('http://localhost/', { method: 'POST', ... });
const res = await worker.fetch(req, mockEnv);
```

### Adding a new chain

1. Create `src/chains/<chain>.ts` with method classification and cache rules
2. Add chain to `loadChainConfig()` in `src/index.ts`
3. Create a deploy script in `package.json`

## Configuration

Secrets set via `wrangler secret put`:
- `UPSTREAMS` — JSON array of upstream RPC endpoints

Local dev uses `.dev.vars` (not committed).
```

- [ ] **Step 3: Verify typecheck still passes after adding files**

```bash
cd /Users/dengzhizhong/data/repos/deng/ZeroWallet/gateway/rpc-hub && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet add gateway/rpc-hub/README.md gateway/rpc-hub/CLAUDE.md
git -C /Users/dengzhizhong/data/repos/deng/ZeroWallet commit -m "docs(rpc-hub): add README and CLAUDE.md"
```
