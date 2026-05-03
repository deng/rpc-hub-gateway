import { ChainConfig } from '../types';

const READ_METHODS = [
  'eth_blockNumber', 'eth_getBalance', 'eth_getStorageAt',
  'eth_getTransactionCount', 'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber', 'eth_getUncleCountByBlockHash',
  'eth_getUncleCountByBlockNumber', 'eth_getCode', 'eth_call',
  'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_getBlockByHash', 'eth_getBlockByNumber',
  'eth_getTransactionByHash', 'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex', 'eth_getTransactionReceipt',
  'eth_getBlockReceipts', 'eth_getLogs', 'eth_chainId',
  'eth_getUncleByBlockHashAndIndex', 'eth_getUncleByBlockNumberAndIndex',
  'eth_syncing', 'eth_hashrate', 'eth_mining', 'eth_coinbase',
  'eth_accounts', 'eth_getProof', 'net_version', 'net_listening',
  'net_peerCount', 'web3_clientVersion', 'web3_sha3',
];

const WRITE_METHODS = [
  'eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign',
  'eth_signTransaction', 'eth_signTypedData', 'eth_signTypedData_v4',
  'personal_sign',
];

const CACHE_RULES: [string, number][] = [
  ['eth_chainId', 3600],
  ['net_version', 3600],
  ['eth_blockNumber', 3],
  ['eth_getBalance', 6],
  ['eth_gasPrice', 3],
  ['eth_maxPriorityFeePerGas', 3],
  ['eth_getTransactionCount', 6],
  ['eth_getBlockByNumber', 6],
];

export function getEvmConfig(): ChainConfig {
  return {
    name: 'evm',
    readMethods: new Set(READ_METHODS),
    writeMethods: new Set(WRITE_METHODS),
    cacheRules: new Map(CACHE_RULES),
  };
}
