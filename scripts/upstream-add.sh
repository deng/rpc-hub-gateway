#!/bin/bash
# Interactive: append a new upstream to existing UPSTREAMS secret
# Usage: npm run upstream:add
# Requires .env with CLOUDFLARE_API_TOKEN
# Note: wrangler cannot read existing secret values, so you must
# provide the current UPSTREAMS as base. Use upstream:current for reference.

set -e

echo "=== 新增上游节点 ==="
echo ""

read -p "RPC URL: " url
read -p "权重 (weight, 默认 1): " weight
weight=${weight:-1}
read -p "类型 (primary/secondary, 默认 primary): " type
type=${type:-primary}
read -p "超时 (ms, 默认 10000): " timeout
timeout=${timeout:-10000}

# Build the new node JSON
node=$(cat <<EOF
  {"url":"$url","weight":$weight,"type":"$type","timeout":$timeout}
EOF
)

echo ""
echo "新上游节点:"
echo "$node" | python3 -m json.tool
echo ""
echo "正在获取当前 UPSTREAMS 值..."
echo "！请复制当前值 (或从 Cloudflare Dashboard 获取)，粘贴后追加新节点。"
echo "或者直接输入完整的 UPSTREAMS JSON (包含已有 + 新增):"
echo "---"
IFS= read -d '' -r full_json

if [ -z "$full_json" ]; then
  echo "错误: 未输入内容"
  exit 1
fi

# Validate
echo "$full_json" | python3 -m json.tool > /dev/null 2>&1 || { echo "错误: JSON 格式无效"; exit 1; }

read -p "确认设置? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "已取消"
  exit 0
fi

echo "$full_json" | npx dotenv -- npx wrangler secret put UPSTREAMS
echo "完成!"
