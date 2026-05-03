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
