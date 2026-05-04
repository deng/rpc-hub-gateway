import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseUpstreams, createUpstreamStates, selectUpstreamForWrite, selectUpstreamsForRead, recordSuccess, recordFailure, isAllDegraded } from './upstream';
import { checkRateLimit, cleanupBuckets } from './ratelimit';
import type { Env, UpstreamState } from './types';

const app = new Hono<{ Bindings: Env; Variables: { upstreamStates: UpstreamState[] } }>();

app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

// Health
app.get('/health', async (c) => {
  const states = c.get('upstreamStates');
  if (!states) return c.json({ status: 'healthy', chain: 'aptos' });
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

  // Select upstream
  const active = selectUpstreamsForRead(states);
  if (active.length === 0) {
    return c.json({ error: 'all upstreams degraded' }, 502);
  }

  // Pick one upstream (race-style, first-wins)
  const controllers = active.map(() => new AbortController());
  try {
    const result = await Promise.any(
      active.map(async (state, i) => {
        // Build target URL: preserve request path
        const url = new URL(c.req.url);
        const target = new URL(url.pathname + url.search, state.config.url).toString();

        const start = Date.now();
        const res = await fetch(target, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().text(),
          signal: controllers[i].signal,
          redirect: 'follow',
        });
        recordSuccess(state, Date.now() - start);
        controllers.forEach((ctrl, j) => { if (j !== i) ctrl.abort(); });
        return res;
      }),
    );

    const response = new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
    // Clean up rate limit buckets
    try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
    return response;
  } catch {
    active.forEach(s => recordFailure(s));
    try { c.executionCtx.waitUntil(Promise.resolve(cleanupBuckets())); } catch { /* no executionCtx */ }
    return c.json({ error: 'upstream request failed' }, 502);
  }
});

export default { fetch: app.fetch };
