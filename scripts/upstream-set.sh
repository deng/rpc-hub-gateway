#!/bin/bash
# Interactive: set UPSTREAMS secret
# Usage: npm run upstream:set
# Requires .env with CLOUDFLARE_API_TOKEN

set -e

echo "=== UPSTREAMS 设置 ==="
echo "请输入完整的 UPSTREAMS JSON 数组 (支持多行粘贴):"
echo "---"
IFS= read -d '' -r json

if [ -z "$json" ]; then
  echo "错误: 未输入内容"
  exit 1
fi

# Validate JSON
echo "$json" | python3 -m json.tool > /dev/null 2>&1 || { echo "错误: JSON 格式无效"; exit 1; }

echo ""
echo "即将设置 UPSTREAMS:"
echo "$json" | python3 -m json.tool
echo ""

read -p "确认设置? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "已取消"
  exit 0
fi

echo "$json" | npx dotenv -- npx wrangler secret put UPSTREAMS
echo "完成!"
