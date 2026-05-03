import { describe, it, expect, afterEach } from 'vitest';
import { checkRateLimit, cleanupBuckets } from '../src/ratelimit';

describe('checkRateLimit', () => {
  afterEach(() => cleanupBuckets());

  it('allows first request', () => {
    const result = checkRateLimit('1.2.3.4', 5, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('blocks when exceeding limit', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4', 5, 1000);
    expect(checkRateLimit('1.2.3.4', 5, 1000).allowed).toBe(false);
  });

  it('treats different IPs independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4', 5, 1000);
    expect(checkRateLimit('5.6.7.8', 5, 1000).allowed).toBe(true);
  });
});
