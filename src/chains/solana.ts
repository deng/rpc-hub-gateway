import { ChainConfig } from '../types';

const READ_METHODS = [
  'getAccountInfo', 'getBalance', 'getBlock', 'getBlockHeight',
  'getBlockProduction', 'getBlockTime', 'getBlocks', 'getBlocksWithLimit',
  'getClusterNodes', 'getEpochInfo', 'getEpochSchedule',
  'getFeeCalculatorForBlockhash', 'getFeeForMessage',
  'getFees', 'getFirstAvailableBlock', 'getGenesisHash', 'getHealth',
  'getHighestSnapshotSlot', 'getIdentity', 'getInflationGovernor',
  'getInflationRate', 'getInflationReward', 'getLargestAccounts',
  'getLatestBlockhash', 'getLeaderSchedule',
  'getMinimumBalanceForRentExemption', 'getMultipleAccounts',
  'getProgramAccounts', 'getRecentPerformanceSamples',
  'getRecentPrioritizationFees', 'getSignaturesForAddress',
  'getSignatureStatuses', 'getSlot', 'getSlotLeader', 'getSlotLeaders',
  'getStakeActivation', 'getSupply', 'getTokenAccountBalance',
  'getTokenAccountsByDelegate', 'getTokenAccountsByOwner',
  'getTokenLargestAccounts', 'getTransaction', 'getTransactionCount',
  'getVoteAccounts', 'minimumLedgerSlot', 'getVersion',
  'getStakeMinimumDelegation', 'getNonce',
];

const WRITE_METHODS = [
  'requestAirdrop', 'sendTransaction', 'simulateTransaction',
];

const CACHE_RULES: [string, number][] = [
  ['getHealth', 10],
  ['getGenesisHash', 3600],
  ['getVersion', 3600],
  ['getBlockHeight', 3],
  ['getSlot', 3],
  ['getLatestBlockhash', 3],
  ['getBalance', 6],
  ['getMultipleAccounts', 3],
  ['getEpochInfo', 6],
];

export function getSolanaConfig(): ChainConfig {
  return {
    name: 'solana',
    readMethods: new Set(READ_METHODS),
    writeMethods: new Set(WRITE_METHODS),
    cacheRules: new Map(CACHE_RULES),
  };
}
