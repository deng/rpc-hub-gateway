import { ChainConfig } from './types';

export function isCacheable(method: string, chainConfig: ChainConfig): boolean {
  if (!chainConfig.readMethods.has(method)) return false;
  return chainConfig.cacheRules.has(method);
}

export function getMethodTTL(method: string, chainConfig: ChainConfig): number {
  return chainConfig.cacheRules.get(method) ?? 0;
}

export async function getCacheKey(body: string): Promise<Request> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://cache/${hash}`);
}

export async function getCached(key: Request): Promise<Response | null> {
  try {
    return await caches.default.match(key);
  } catch {
    return null;
  }
}

export async function setCache(
  key: Request,
  response: Response,
  ttl: number,
  ctx: ExecutionContext,
): Promise<void> {
  if (ttl <= 0) return;
  const cloned = response.clone();
  ctx.waitUntil(caches.default.put(key, cloned));
}
