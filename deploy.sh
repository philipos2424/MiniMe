#!/usr/bin/env bash
# MiniMe production deploy helper
# Usage: bash deploy.sh
# Builds, deploys to Vercel production, and aliases the domain automatically.
#
# Must run from the REPO ROOT, not apps/web. The Vercel project's Root
# Directory setting is already "apps/web" (see .vercel/project.json), so
# invoking the CLI from inside apps/web doubles the path to
# "apps/web/apps/web" and fails with "provided path does not exist".

set -e

ALIAS="web-theta-one-68.vercel.app"

echo "🚀 Deploying MiniMe to production..."

# Build + deploy
URL=$(npx -y vercel --prod --yes 2>&1 | grep '"message":' | grep -oP 'Deployment \K[^ "]+' | head -1)

if [ -z "$URL" ]; then
  # Fallback: grab the deployment URL from the output
  OUT=$(npx -y vercel --prod --yes 2>&1)
  URL=$(echo "$OUT" | grep -oP 'web-[a-z0-9]+-philiposw11-9068s-projects\.vercel\.app' | head -1)
fi

if [ -z "$URL" ]; then
  echo "❌ Could not parse deployment URL"
  exit 1
fi

echo "✅ Deployed: https://$URL"
echo "🔗 Aliasing to $ALIAS..."

npx -y vercel alias set "$URL" "$ALIAS"

echo ""
echo "🎉 Live at https://$ALIAS"

