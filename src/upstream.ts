import { UpstreamConfig, UpstreamState } from './types';

export function parseUpstreams(raw: string): UpstreamConfig[] {
  try {
    return JSON.parse(raw) as UpstreamConfig[];
  } catch {
    throw new Error('Invalid UPSTREAMS JSON: failed to parse');
  }
}

export function createUpstreamStates(configs: UpstreamConfig[]): UpstreamState[] {
  return configs.map(c => ({
    config: c,
    status: 'active' as const,
    failures: 0,
    lastFailure: 0,
    latency: 0,
  }));
}

function getActiveUpstreams(states: UpstreamState[]): UpstreamState[] {
  const now = Date.now();
  return states.filter(s => {
    if (s.status === 'active') return true;
    // degraded for more than 30s → attempt recovery
    if (s.status === 'degraded' && now - s.lastFailure > 30_000) {
      s.status = 'unknown';
      return true;
    }
    return false;
  });
}

export function selectUpstreamForWrite(states: UpstreamState[]): UpstreamState | null {
  const active = getActiveUpstreams(states);
  if (active.length === 0) return null;

  const pool = active.filter(s => s.config.type === 'primary');
  const candidates = pool.length > 0 ? pool : active;

  const totalWeight = candidates.reduce((sum, s) => sum + s.config.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const s of candidates) {
    rand -= s.config.weight;
    if (rand <= 0) return s;
  }
  return candidates[candidates.length - 1];
}

export function selectUpstreamsForRead(states: UpstreamState[]): UpstreamState[] {
  return getActiveUpstreams(states);
}

export function recordSuccess(state: UpstreamState, latency: number): void {
  state.status = 'active';
  state.failures = 0;
  state.latency = latency;
}

export function recordFailure(state: UpstreamState): void {
  state.failures += 1;
  state.lastFailure = Date.now();
  if (state.failures >= 3) {
    state.status = 'degraded';
  }
}

export function isAllDegraded(states: UpstreamState[]): boolean {
  return getActiveUpstreams(states).length === 0;
}

export function getUpstreamsHealth(states: UpstreamState[]) {
  return states.map(s => ({
    url: s.config.url,
    status: s.status,
    latency: s.status === 'active' ? s.latency : 0,
  }));
}
