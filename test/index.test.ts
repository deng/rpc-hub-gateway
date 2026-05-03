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
