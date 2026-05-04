import { ChainConfig } from '../types';

// Aptos uses REST API, not JSON-RPC.
// The worker will forward all POST requests to the upstream as-is.
// Method classification is lenient since paths like /v1/transactions
// are handled by the upstream directly.

const READ_METHODS = new Set<string>(); // REST-based, no JSON-RPC methods
const WRITE_METHODS = new Set<string>(); // REST-based, no JSON-RPC methods

const CACHE_RULES = new Map<string, number>();

export function getAptosConfig(): ChainConfig {
  return {
    name: 'aptos',
    readMethods: READ_METHODS,
    writeMethods: WRITE_METHODS,
    cacheRules: CACHE_RULES,
  };
}
