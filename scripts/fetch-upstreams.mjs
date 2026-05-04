#!/usr/bin/env node
// Fetch public RPC endpoints from chainlist-rpcs and other sources,
// health-check each, write only healthy ones to config/<chain>.json.
// Usage: node scripts/fetch-upstreams.mjs [chain]

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chainlistRpcs from 'chainlist-rpcs/constants/extraRpcs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

// Chainlist chain IDs for EVM chains
const CHAINLIST_IDS = { eth: 1, bsc: 56 };

// Known public endpoints for non-EVM chains (chainlist doesn't cover these)
const FALLBACK_RPCS = {
  sol: [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com',
    'https://solana-api.projectserum.com',
  ],
  sui: [
    'https://rpc.mainnet.sui.io',
    'https://sui-rpc.publicnode.com',
  ],
  apt: [
    'https://fullnode.mainnet.aptoslabs.com/v1',
    'https://aptos-rpc.publicnode.com',
  ],
};

const WORKER_MAP = { eth: 'eth-rpc-hub', bsc: 'bsc-rpc-hub', sol: 'sol-rpc-hub', sui: 'sui-rpc-hub', apt: 'apt-rpc-hub' };

const HEALTH_CHECKS = {
  eth:  { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }), expect: r => r.result === '0x1' },
  bsc:  { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }), expect: r => r.result === '0x38' },
  sol:  { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'getVersion', params: [], id: 1 }), expect: r => r.result !== undefined },
  sui:  { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'sui_getChainIdentifier', params: [], id: 1 }), expect: r => r.result !== undefined },
  apt:  { method: 'GET', body: null, expect: r => r && typeof r === 'object' && r.chain_id !== undefined },
};

async function checkEndpoint(url, chain) {
  const hc = HEALTH_CHECKS[chain];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const opts = {
      method: hc.method,
      headers: hc.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      signal: controller.signal,
    };
    if (hc.body) opts.body = hc.body;

    const start = Date.now();
    const res = await fetch(url, opts);
    const ms = Date.now() - start;

    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, ms };

    const data = await res.json();
    if (!hc.expect(data)) return { ok: false, reason: 'unexpected response', ms };

    return { ok: true, ms };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message.split('\n')[0], ms: 5000 };
  } finally {
    clearTimeout(timer);
  }
}

function extractUrls(rawRpcs) {
  const urls = [];
  for (const rpc of rawRpcs) {
    if (typeof rpc === 'string') {
      urls.push(rpc);
    } else if (rpc?.url && typeof rpc.url === 'string') {
      urls.push(rpc.url);
    }
  }
  return urls.filter(u => u.startsWith('https'));
}

function dedup(urls) {
  const seen = new Set();
  return urls.filter(u => {
    const key = u.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const targetChain = process.argv[2]?.toLowerCase();
  const allChains = [...new Set([...Object.keys(CHAINLIST_IDS), ...Object.keys(FALLBACK_RPCS)])];
  const chains = targetChain ? [targetChain] : allChains;

  for (const chain of chains) {
    let urls = [];

    // Fetch from chainlist-rpcs (EVM chains)
    const chainId = CHAINLIST_IDS[chain];
    if (chainId && chainlistRpcs[chainId]) {
      const raw = chainlistRpcs[chainId];
      const rpcList = Array.isArray(raw) ? raw : raw.rpcs;
      if (rpcList) urls.push(...extractUrls(rpcList));
    }

    // Fallback list for non-EVM chains or as supplement
    if (FALLBACK_RPCS[chain]) {
      urls.push(...FALLBACK_RPCS[chain]);
    }

    urls = dedup(urls);

    if (urls.length === 0) {
      console.log(`\n⚠️  No sources for ${chain}, skipping`);
      continue;
    }

    console.log(`\n🔍 ${chain} — testing ${urls.length} endpoints...`);

    const results = await Promise.all(urls.map(async url => {
      const result = await checkEndpoint(url, chain);
      return { url, ...result };
    }));

    let passed = 0, failed = 0;
    for (const r of results) {
      if (r.ok) {
        console.log(`  ✅ ${r.url} (${r.ms}ms)`);
        passed++;
      } else {
        console.log(`  ❌ ${r.url} — ${r.reason} (${r.ms}ms)`);
        failed++;
      }
    }

    const healthy = results.filter(r => r.ok).map(r => ({
      url: r.url,
      weight: 1,
      type: 'primary',
      timeout: 10000,
    }));

    if (healthy.length === 0) {
      console.log(`  ⚠️  No healthy endpoints for ${chain}, skipping`);
      continue;
    }

    const file = join(CONFIG_DIR, `${chain}.json`);
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(healthy, null, 2) + '\n');

    console.log(`  📝 ${passed}/${urls.length} healthy → config/${chain}.json`);
  }

  if (!targetChain) {
    console.log('\n✅ Done. Sync to workers:');
    for (const chain of chains) {
      console.log(`  npm run upstream:sync -- ${chain}`);
    }
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
