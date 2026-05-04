import { ChainConfig } from '../types';

const READ_METHODS = [
  'sui_getChainIdentifier', 'sui_getCheckpoint', 'sui_getCheckpoints',
  'sui_getLatestCheckpointSequenceNumber', 'sui_getCheckpointContentsBySequenceNumber',
  'sui_getCheckpointContentsByDigest', 'sui_getLoadedChildObjects',
  'sui_getObject', 'sui_getObjectOwnedByAddress', 'sui_getRawObject',
  'sui_getPastObject', 'sui_getBalance', 'sui_getAllBalances',
  'sui_getCoinMetadata', 'sui_getCoins', 'sui_getAllCoins',
  'sui_getOwnedObjects', 'sui_getTotalSupply',
  'sui_getTransactionBlock', 'sui_getTransactionBlockEffects',
  'sui_getTransactionBlockEffectsDigest',
  'sui_getTransactionBlockEffectsOpt',
  'sui_getEvents', 'sui_getNumCheckpoints', 'sui_getTotalTransactionBlocks',
  'sui_getCurrentEpoch', 'sui_getEpoch', 'sui_getCommitteeInfo',
  'sui_getReferenceGasPrice', 'sui_getValidators',
  'sui_getValidatorsApy', 'sui_getNetwork', 'sui_getAddresses',
  'sui_getStakes', 'sui_getStakesByIds',
  'sui_getDynamicFieldObject', 'sui_getDynamicFields',
  'sui_getMoveFunctionArgTypes', 'sui_getNormalizedMoveFunction',
  'sui_getNormalizedMoveModule', 'sui_getNormalizedMoveStruct',
  'sui_getNormalizedMoveModulesByPackage',
  'sui_getObjectType', 'sui_getProtocolConfig',
  'sui_getRpcVersion', 'sui_getAllEpochAddressCounts',
  'sui_getEpochMetrics', 'suix_getAllBalances', 'suix_getAllCoins',
  'suix_getBalance', 'suix_getCoins', 'suix_getOwnedObjects',
  'suix_getStakes', 'suix_getStakesByIds', 'suix_getPastObject',
  'suix_getDynamicFieldObject', 'suix_getDynamicFields',
  'suix_getLatestSuiSystemState', 'suix_getReferenceGasPrice',
  'suix_getValidatorsApy', 'suix_getAllEpochAddressCounts',
  'suix_getEpochMetrics', 'suix_queryTransactionBlocks',
  'suix_getCommitteeInfo',
];

const WRITE_METHODS = [
  'sui_executeTransactionBlock', 'sui_dryRunTransactionBlock',
  'sui_devInspectTransactionBlock', 'sui_executeTransaction',
  'sui_dryRunTransaction',
  'suix_submitTransaction', 'suix_dryRunTransactionBlock',
  'suix_devInspectTransactionBlock',
];

const CACHE_RULES: [string, number][] = [
  ['sui_getChainIdentifier', 3600],
  ['sui_getReferenceGasPrice', 6],
  ['sui_getBalance', 6],
  ['sui_getLatestCheckpointSequenceNumber', 3],
  ['sui_getTotalTransactionBlocks', 60],
  ['sui_getValidatorsApy', 300],
  ['sui_getCommitteeInfo', 300],
  ['sui_getNetwork', 3600],
  ['sui_getRpcVersion', 3600],
];

export function getSuiConfig(): ChainConfig {
  return {
    name: 'sui',
    readMethods: new Set(READ_METHODS),
    writeMethods: new Set(WRITE_METHODS),
    cacheRules: new Map(CACHE_RULES),
  };
}
