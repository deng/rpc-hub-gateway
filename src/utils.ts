import { RpcRequest, RpcResponse } from './types';

export function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(data)).then(hashBuffer => {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

export function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
): RpcResponse {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

export function jsonRpcResult(
  id: number | string | null,
  result: unknown,
): RpcResponse {
  return { jsonrpc: '2.0', result, id };
}

export function parseRpcBody(body: unknown): {
  requests: RpcRequest[];
  isBatch: boolean;
} {
  if (Array.isArray(body)) {
    return { requests: body as RpcRequest[], isBatch: true };
  }
  return { requests: [body as RpcRequest], isBatch: false };
}

export function extractMethod(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? (parsed[0] as RpcRequest).method : null;
    }
    return (parsed as RpcRequest).method ?? null;
  } catch {
    return null;
  }
}
