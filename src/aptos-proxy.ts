import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseUpstreams, createUpstreamStates, selectUpstreamForWrite, recordSuccess, recordFailure, isAllDegraded } from './upstream';
import { checkRateLimit, cleanupBuckets } from './ratelimit';
import type { Env, UpstreamState } from './types';

const app = new Hono<{ Bindings: Env; Variables: { upstreamStates: UpstreamState[] } }>();

app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

// Health
app.get('/health', async (c) => {
  const env = c.env;
  let states: UpstreamState[];
  try {
    states = createUpstreamStates(parseUpstreams(env.UPSTREAMS));
    c.set('upstreamStates', states);
  } catch {
    return c.json({ status: 'healthy', chain: 'aptos', upstreams: [] });
  }
  return c.json({
    status: isAllDegraded(states) ? 'degraded' : 'healthy',
    chain: 'aptos',
    upstreams: states.map(s => ({ url: s.config.url, status: s.status })),
  });
});

// Forward all other requests to upstream
app.all('/*', async (c) => {
  const env = c.env;
  const timeoutMs = parseInt(env.RPC_TIMEOUT || '10000', 10);

  // Parse upstream config
  let states: UpstreamState[];
  try {
    states = createUpstreamStates(parseUpstreams(env.UPSTREAMS));
    c.set('upstreamStates', states);
  } catch {
    return c.json({ error: 'server configuration error' }, 500);
  }

  // Rate limit
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip).allowed) {
    return c.json({ error: 'rate limit exceeded' }, 429);
  }

  // Buffer body once for retry (binary-safe)
  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    body = await c.req.raw.arrayBuffer();
  }

  // Build target URL
  const url = new URL(c.req.url);
  const buildTarget = (base: string) => new URL(url.pathname + url.search, base).toString();
  const doFetch = async (state: UpstreamState, target: string) => {
    const start = Date.now();
    const res = await fetch(target, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    recordSuccess(state, Date.now() - start);
    return res;
  };

  // Pick one upstream, retry once on failure
  const first = selectUpstreamForWrite(states);
  if (!first) {
    return c.json({ error: 'all upstreams degraded' }, 502);
  }

  try {
    const res = await doFetch(first, buildTarget(first.config.url));
    const response = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
    return response;
  } catch {
    recordFailure(first);
    const second = selectUpstreamForWrite(states);
    if (!second || second.config.url === first.config.url) {
      try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
      return c.json({ error: 'upstream request failed' }, 502);
    }
    try {
      const res = await doFetch(second, buildTarget(second.config.url));
      const response = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
      return response;
    } catch {
      recordFailure(second);
      try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
      return c.json({ error: 'upstream request failed' }, 502);
    }
  }
});

export default { fetch: app.fetch };
