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
