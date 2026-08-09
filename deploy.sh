#!/usr/bin/env bash
# MiniMe production deploy helper
# Usage: bash deploy.sh
# Builds, deploys to Vercel production, and aliases the domain automatically.
#
# Must run from the REPO ROOT, not apps/web. The Vercel project's Root
# Directory setting is already "apps/web" (see .vercel/project.json), so
# invoking the CLI from inside apps/web doubles the path to
# "apps/web/apps/web" and fails with "provided path does not exist".

set -uo pipefail

ALIAS="web-theta-one-68.vercel.app"

echo "🚀 Deploying MiniMe to production..."

# Run the deploy ONCE and keep the full output.
#
# This used to be `URL=$(npx vercel ... | grep '"message":' | grep -oP ...)`
# under `set -e`. Two failure modes, both silent and both hit in practice:
#
#   1. If either grep matched nothing, the pipeline exited non-zero and `set -e`
#      killed the script immediately after the banner above — no error, no URL,
#      exit 1, and nothing deployed. The CLI's output format is not a stable
#      contract, so this broke on a CLI update while still looking like it had
#      run.
#   2. The `if [ -z "$URL" ]` fallback re-ran `npx vercel --prod` a SECOND time,
#      so a parse failure meant two production deployments, not one.
#
# Deploy once, print everything, and only then try to find the URL.
set +e
OUT=$(npx -y vercel --prod --yes 2>&1)
DEPLOY_RC=$?
set -e

echo "$OUT"

if [ $DEPLOY_RC -ne 0 ]; then
  echo ""
  echo "❌ vercel exited $DEPLOY_RC — see the output above. Nothing was aliased."
  exit $DEPLOY_RC
fi

# Take the LAST vercel.app URL in the output: the CLI prints the inspect URL
# first and the deployment URL last. Matches any project/scope, so this keeps
# working if the project is renamed or moved to another team.
URL=$(printf '%s\n' "$OUT" | grep -oE 'https://[A-Za-z0-9._-]+\.vercel\.app' | tail -1)
URL="${URL#https://}"

if [ -z "$URL" ]; then
  echo ""
  echo "❌ Deploy reported success but no deployment URL was found in the output."
  echo "   The alias was NOT moved — production still points at the previous"
  echo "   deployment. Check the Vercel dashboard before retrying."
  exit 1
fi

echo ""
echo "✅ Deployed: https://$URL"
echo "🔗 Aliasing to $ALIAS..."

if ! npx -y vercel alias set "$URL" "$ALIAS"; then
  echo ""
  echo "❌ Alias failed. The deployment exists at https://$URL but $ALIAS still"
  echo "   points at the previous one."
  exit 1
fi

echo ""
echo "🎉 Live at https://$ALIAS"
