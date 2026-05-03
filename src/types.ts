import { Context } from 'hono';

export interface UpstreamConfig {
  url: string;
  weight: number;
  type: 'primary' | 'secondary';
  timeout: number;
}

export interface Env {
  CHAIN: string;
  CACHE_ENABLED: string;
  RPC_TIMEOUT: string;
  UPSTREAMS: string;
}

export interface RpcRequest {
  jsonrpc: string;
  method: string;
  params: unknown[];
  id: number | string | null;
}

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcResponse {
  jsonrpc: string;
  result?: unknown;
  error?: RpcError;
  id: number | string | null;
}

export type UpstreamStatus = 'active' | 'degraded' | 'unknown';

export interface UpstreamState {
  config: UpstreamConfig;
  status: UpstreamStatus;
  failures: number;
  lastFailure: number;
  latency: number;
}

export type Bindings = Env;

export type Variables = {
  upstreamStates: UpstreamState[];
};

export interface ChainConfig {
  name: string;
  readMethods: Set<string>;
  writeMethods: Set<string>;
  cacheRules: Map<string, number>;
}

export type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
