# MiniMe — VPS Migration Guide

## What changes vs. what stays the same

| Component | Status | Notes |
|---|---|---|
| Supabase database | ✅ No change | Cloud-hosted, works from anywhere |
| Supabase Storage | ✅ No change | File uploads unchanged |
| Supabase Realtime | ✅ No change | Websocket connections unchanged |
| OpenAI API | ✅ No change | API calls unchanged |
| Telegram bots | ⚠️ Update webhook URLs | Point all webhooks to new domain |
| Meta webhooks | ⚠️ Update in Meta Dashboard | Point to new domain |
| Chapa webhooks | ⚠️ Update in Chapa Dashboard | Point to new domain |
| Vercel cron jobs | ❌ Replace with system cron | Use `deploy/crontab.txt` |
| Vercel env vars | ❌ Copy to VPS `.env` | See checklist below |

---

## Step-by-step migration

### 1. Provision VPS
- Minimum: 2 vCPU, 2GB RAM, 20GB SSD (Ubuntu 22.04 LTS recommended)
- Open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS)

### 2. Install dependencies
```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 process manager
sudo npm install -g pm2

# Nginx
sudo apt install -y nginx

# Certbot (Let's Encrypt SSL)
sudo apt install -y certbot python3-certbot-nginx
```

### 3. Clone and build
```bash
git clone https://github.com/your-org/minime.git /opt/minime
cd /opt/minime
npm install
cd apps/web
cp .env.example .env.local   # Fill in all values (see checklist below)
npm run build
```

### 4. Set environment variables
Edit `/opt/minime/apps/web/.env.local` — see full checklist at bottom of this file.

**Critical new values for VPS:**
```
WEB_URL=https://yourdomain.com
NODE_ENV=production
PORT=3000
```

### 5. Start with PM2
```bash
cd /opt/minime
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # Follow the printed command to enable auto-start on reboot
```

### 6. Configure Nginx
```bash
# Copy nginx config
sudo cp /opt/minime/deploy/nginx.conf /etc/nginx/sites-available/minime
sudo ln -s /etc/nginx/sites-available/minime /etc/nginx/sites-enabled/

# Edit the config — replace 'yourdomain.com' with your actual domain
sudo nano /etc/nginx/sites-available/minime

# Get SSL certificate (requires DNS pointed to VPS first)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test and reload
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Set up cron jobs (replaces Vercel cron)
```bash
# Edit crontab
crontab -e

# Paste the contents of deploy/crontab.txt
# Update CRON_SECRET and DOMAIN values
```

### 8. Update webhook URLs

**Telegram bots** — For each business bot, re-link via the MiniMe settings:
- Go to Settings → Bot → re-paste the bot token
- This automatically calls setWebhook with the new domain

**Meta webhooks** (if using WhatsApp/Instagram/Facebook):
- Log into Meta App Dashboard
- Go to Webhooks → Edit subscription URL
- Change from `https://web-theta-one-68.vercel.app/api/webhook/meta`
  to `https://yourdomain.com/api/webhook/meta`

**Chapa webhooks** (payment callbacks):
- Log into Chapa Dashboard
- Update webhook URL to `https://yourdomain.com/api/payment/callback`

### 9. DNS configuration
Point your domain to the VPS IP:
```
A     yourdomain.com      → your.vps.ip.address
A     www.yourdomain.com  → your.vps.ip.address
```

### 10. Verify deployment
```bash
# Check PM2 status
pm2 status

# Tail logs
pm2 logs minime-web

# Test healthcheck
curl https://yourdomain.com/api/cron/healthcheck?secret=your_cron_secret

# Test Telegram webhook (should return 404 for unknown secret, not 500)
curl -X POST https://yourdomain.com/api/telegram/webhook/test
```

---

## Environment Variable Checklist

Copy ALL of these to your VPS `.env.local`:

```bash
# Core
NODE_ENV=production
WEB_URL=https://yourdomain.com
NEXT_PUBLIC_APP_URL=https://yourdomain.com
PORT=3000

# Supabase (unchanged from Vercel)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=          # Platform bot (Alfred)
CRON_OWNER_CHAT_ID=          # Your personal Telegram chat ID for cron alerts

# AI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1

# Encryption (CRITICAL — must be exactly 32 bytes of hex or base64)
ENCRYPTION_KEY=

# Cron auth (any random string — must match crontab.txt)
CRON_SECRET=

# Admin
ADMIN_TELEGRAM_IDS=          # Comma-separated Telegram IDs
PLATFORM_ADMIN_TELEGRAM_ID=  # Single ID for critical alerts

# Payments
CHAPA_SECRET_KEY=

# Meta/Facebook (if using WhatsApp/Instagram/Facebook)
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=
META_SYSTEM_USER_TOKEN=

# Optional
HASAB_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

---

## Recommended VPS specs

| Traffic level | Spec | Cost estimate |
|---|---|---|
| Up to 50 businesses | 2 vCPU / 2GB RAM | ~$12/mo (Hetzner CX22) |
| 50–200 businesses | 4 vCPU / 8GB RAM | ~$25/mo (Hetzner CX32) |
| 200+ businesses | 8 vCPU / 16GB RAM | ~$50/mo (Hetzner CX42) |

**Recommended providers (in order):**
1. **Hetzner** (Germany/Finland) — best price/performance, ~$5/mo for entry
2. **Contabo** — high RAM per dollar
3. **DigitalOcean** — easier UX, slightly more expensive
4. **Vultr** — good global presence

---

## Security checklist for VPS

- [ ] SSH key authentication only (disable password login)
- [ ] UFW firewall: `sudo ufw allow 22,80,443/tcp && sudo ufw enable`
- [ ] Automatic security updates: `sudo apt install unattended-upgrades`
- [ ] Fail2ban for SSH brute-force: `sudo apt install fail2ban`
- [ ] SSL certificate auto-renewal: `sudo certbot renew --dry-run`
- [ ] Regular database backups (Supabase has this built in)
- [ ] PM2 log rotation: `pm2 install pm2-logrotate`
- [ ] Set strong ENCRYPTION_KEY (32 random bytes)
- [ ] Store .env.local outside git repo

---

## Rollback plan

If something goes wrong, Vercel deployment stays live until you:
1. Remove the domain from Vercel
2. Point DNS to VPS

You can run both simultaneously during testing — just keep Vercel active and add the VPS as a staging environment first.
