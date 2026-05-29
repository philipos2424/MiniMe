#!/usr/bin/env bash
# MiniMe production deploy helper
# Usage: bash deploy.sh
# Builds, deploys to Vercel production, and aliases the domain automatically.

set -e

ALIAS="web-theta-one-68.vercel.app"
WEB="apps/web"

echo "🚀 Deploying MiniMe to production..."

# Build + deploy
URL=$(cd "$WEB" && vercel --prod --yes 2>&1 | grep '"message":' | grep -oP 'Deployment \K[^ "]+' | head -1)

if [ -z "$URL" ]; then
  # Fallback: grab the deployment URL from the output
  OUT=$(cd "$WEB" && vercel --prod --yes 2>&1)
  URL=$(echo "$OUT" | grep -oP 'web-[a-z0-9]+-philiposw11-9068s-projects\.vercel\.app' | head -1)
fi

if [ -z "$URL" ]; then
  echo "❌ Could not parse deployment URL"
  exit 1
fi

echo "✅ Deployed: https://$URL"
echo "🔗 Aliasing to $ALIAS..."

cd "$WEB" && vercel alias set "$URL" "$ALIAS"

echo ""
echo "🎉 Live at https://$ALIAS"
