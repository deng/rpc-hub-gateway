#!/bin/bash
# Sync UPSTREAMS from config/<chain>.json
# Usage: npm run upstream:sync eth
#        npm run upstream:sync bsc
set -e

CHAIN="$1"
DIR="$(cd "$(dirname "$0")/../config" && pwd)"

if [ -z "$CHAIN" ]; then
  echo "Usage: npm run upstream:sync <chain>"
  echo "Chains: eth, bsc, sol, sui, apt"
  exit 1
fi

case "$CHAIN" in
  eth) WORKER="eth-rpc-hub" ;;
  bsc) WORKER="bsc-rpc-hub" ;;
  sol) WORKER="sol-rpc-hub" ;;
  sui) WORKER="sui-rpc-hub" ;;
  apt) WORKER="apt-rpc-hub" ;;
  *) echo "Unknown chain: $CHAIN"; exit 1 ;;
esac

FILE="$DIR/$CHAIN.json"

if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE"
  exit 1
fi

python3 -m json.tool "$FILE" > /dev/null 2>&1 || { echo "JSON invalid"; exit 1; }

# Validate each upstream object has required fields
python3 -c "
import json, sys
data = json.load(open('$FILE'))
if not isinstance(data, list):
    sys.exit('root must be an array')
for i, item in enumerate(data):
    for field in ['url', 'weight', 'type', 'timeout']:
        if field not in item:
            sys.exit(f'item[{i}] missing required field: {field}')
    if item['weight'] < 1:
        sys.exit(f'item[{i}] weight must be >= 1')
    if item['timeout'] < 1:
        sys.exit(f'item[{i}] timeout must be > 0')
" 2>&1 | sed 's/^/  /' || { echo "结构校验失败"; exit 1; }

echo "==> $WORKER ← $CHAIN.json"
cat "$FILE" | npx dotenv -- npx wrangler secret put UPSTREAMS --name "$WORKER"
echo "Done"
