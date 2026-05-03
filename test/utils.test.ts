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
