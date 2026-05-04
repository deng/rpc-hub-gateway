# CLAUDE.md

## Commands

```bash
npm run dev           # Start local Wrangler dev server on :8787
npm run deploy        # Deploy to Cloudflare Workers
npm run deploy:eth    # Deploy Ethereum worker (eth-rpc-hub)
npm test              # Run all tests via Vitest
npm run typecheck     # Type-check with tsc --noEmit
npm run upstream:set  # Interactive: set UPSTREAMS secret
npm run upstream:add  # Interactive: add new upstream node
```

## Deploy

- Worker name: `eth-rpc-hub`
- Route: `eth-rpc.bithub.pro` (zone: `a2377099496ecf3fe85caa580e64b070`)
- DNS: CNAME `eth-rpc` → `eth-rpc-hub.deng-zz.workers.dev` (proxied)
- Deploy: `npm run deploy:eth`
- Requires `.env` with `CLOUDFLARE_API_TOKEN`

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
