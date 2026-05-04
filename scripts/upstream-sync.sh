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

echo "==> $WORKER ← $CHAIN.json"
cat "$FILE" | npx dotenv -- npx wrangler secret put UPSTREAMS --name "$WORKER"
echo "Done"
