#!/bin/bash
# ============================================================
# MiniMe Deploy Script
# Run this as the 'minime' user to deploy/update the app
# First run: ./deploy.sh --first-time
# Updates:   ./deploy.sh
# ============================================================

set -e

APP_DIR="/home/minime/minime"
FIRST_TIME=false
[[ "$1" == "--first-time" ]] && FIRST_TIME=true

# Load nvm
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

# --- Pull latest code ---
if $FIRST_TIME; then
  echo "Cloning repository..."
  git clone https://github.com/YOUR_GITHUB_USERNAME/minime.git $APP_DIR
  cd $APP_DIR
else
  echo "Pulling latest changes..."
  cd $APP_DIR
  git pull origin main
fi

# --- Install dependencies ---
cd apps/web
npm ci --only=production

# --- Write environment variables ---
# Edit this section with your actual values
if $FIRST_TIME; then
  cat > .env.local << 'ENVEOF'
# ── Supabase ──────────────────────────────────────────
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# ── App ───────────────────────────────────────────────
WEB_URL=https://your-domain.com
ENCRYPTION_KEY=your_32_byte_base64_key
CRON_SECRET=your_long_random_secret

# ── Telegram ──────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_platform_bot_token
ADMIN_TELEGRAM_IDS=your_telegram_id
PLATFORM_ADMIN_TELEGRAM_ID=your_telegram_id

# ── AI ────────────────────────────────────────────────
OPENAI_API_KEY=sk-your-openai-key
HASAB_API_KEY=your_hasab_key

# ── Payments ──────────────────────────────────────────
CHAPA_SECRET_KEY=your_chapa_key

# ── Optional ──────────────────────────────────────────
SENTRY_DSN=your_sentry_dsn
IMPERSONATE_SECRET=your_32_char_secret
ENVEOF
  echo "⚠️  Edit .env.local with your actual values, then run deploy.sh again"
  exit 0
fi

# --- Build ---
echo "Building Next.js app..."
npm run build

# --- PM2 setup ---
if $FIRST_TIME; then
  pm2 start npm --name "minime" -- start -- --port 3000
  pm2 save
  pm2 startup | tail -1 | bash  # Set up auto-start on reboot
  echo "✅ PM2 started"
else
  pm2 reload minime
  echo "✅ PM2 reloaded"
fi

echo "✅ Deploy complete! App running at http://localhost:3000"
