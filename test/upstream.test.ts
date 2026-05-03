import { describe, it, expect } from 'vitest';
import {
  parseUpstreams, selectUpstreamForWrite,
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
