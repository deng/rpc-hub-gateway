import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Variables, RpcRequest, ChainConfig, UpstreamState } from './types';
import { getEvmConfig } from './chains/evm';
import { getSolanaConfig } from './chains/solana';
import { getSuiConfig } from './chains/sui';
import { getAptosConfig } from './chains/aptos';
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
  switch (chain) {
    case 'ethereum':
    case 'evm':
    case 'bsc':
      return getEvmConfig();
    case 'solana':
    case 'sol':
      return getSolanaConfig();
    case 'sui':
      return getSuiConfig();
    case 'aptos':
    case 'apt':
      return getAptosConfig();
    default:
      return getEvmConfig();
  }
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

  // REST pass-through mode (e.g. Aptos): forward all POST requests as-is
  const isREST = chainConfig.readMethods.size === 0 && chainConfig.writeMethods.size === 0;
  if (isREST) {
    const { data, status } = await forwardSingle(bodyStr, states, false, timeoutMs);
    try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
    return c.json(data, status as 200 | 400 | 429 | 413 | 500 | 502);
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
    try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
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
      try { await setCache(ck, cacheRes, ttl, c.executionCtx); } catch { /* no executionCtx */ }
    }
  }

  try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
  return c.json(data, status as 200 | 400 | 429 | 413 | 500 | 502);
});

export default { fetch: app.fetch };
