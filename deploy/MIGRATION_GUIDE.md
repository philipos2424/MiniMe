# MiniMe — Domain & VPS Migration Guide

## What to Buy

### Domain (~$14/year)
**Best option:** `minime.app` at Cloudflare Registrar  
**Alternatives:** `getminime.com` · `tryminime.com` · `minime.et` (Ethiopian, but harder to get)

**Why Cloudflare Registrar:**
- Sells at cost (no markup) — cheapest prices
- Built-in DDoS protection and CDN (free)
- DNS propagates in seconds, not hours
- Automatic DNSSEC
- URL: https://www.cloudflare.com/products/registrar/

### VPS (~€4.51/month)
**Buy:** Hetzner CX21  
**URL:** https://www.hetzner.com/cloud  
**Specs:** 2 vCPU AMD, 4 GB RAM, 40 GB SSD, 20 TB traffic  
**Location:** Nuremberg, Germany (fastest from Ethiopia via EU fiber)

**Why Hetzner:**
- Best price/performance in the market
- 4x more RAM than DigitalOcean at same price
- 99.9% uptime SLA, been operating since 1997
- GDPR compliant (important for EU customers later)
- IPv4 + IPv6 included

---

## What NOT to Move

**Keep on Supabase (cloud):**
- PostgreSQL database
- File storage (your uploaded PDFs, images)
- Auth (if you use it)
- **Never self-host your database** — it's not worth the risk

**Keep external:**
- OpenAI API — no migration needed
- Chapa payment API — no migration needed  
- Telegram Bot API — no migration needed

---

## Architecture After Migration

```
Customer (Telegram)
    ↓
Telegram API → POST to your-domain.com/api/telegram/webhook/[secret]
    ↓
Nginx (your VPS) → reverse proxy → Next.js on port 3000
    ↓
Supabase (cloud) ← DB queries → Supabase
    ↓
Reply to customer
```

---

## Step-by-Step Migration

### Step 1: Buy domain on Cloudflare (~5 min)
1. Go to cloudflare.com → Registrar
2. Search `minime.app` or your chosen domain
3. Register for $14/year
4. Cloudflare automatically becomes your DNS provider

### Step 2: Buy Hetzner VPS (~5 min)
1. Go to console.hetzner.cloud
2. Create account → New Project → Add Server
3. **Settings:**
   - Location: Nuremberg (EU)
   - Image: Ubuntu 22.04
   - Type: CX21 (€4.51/mo)
   - SSH key: add your public key (get it: `cat ~/.ssh/id_rsa.pub`)
   - Leave everything else default
4. Click "Create & Buy Now"
5. Copy your server's IP address

### Step 3: Point domain to VPS (~2 min)
1. In Cloudflare dashboard → your domain → DNS
2. Add A record: `@` → your VPS IP → Proxy: ON (orange cloud)
3. Add A record: `www` → your VPS IP → Proxy: ON
4. Propagates immediately with Cloudflare

### Step 4: Run setup script on VPS
```bash
# SSH into your new server
ssh root@YOUR_VPS_IP

# Download and run setup
curl -sSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy/setup-vps.sh > setup.sh
# Edit DOMAIN= at top of setup.sh first!
nano setup.sh
bash setup.sh
```

### Step 5: Deploy the app
```bash
# Switch to app user
su - minime

# Clone repo (first time)
./deploy.sh --first-time

# Edit environment variables
nano ~/minime/apps/web/.env.local
# Copy all values from Vercel dashboard (Settings → Environment Variables)

# Deploy
./deploy.sh
```

### Step 6: Set up cron jobs
```bash
# Edit your domain and secret in the script
nano ~/deploy/cron-setup.sh
bash ~/deploy/cron-setup.sh
```

### Step 7: Update webhook URLs
The webhooks for each business bot still point to your old Vercel URL.
Run this from the Mini App to update all webhooks:

In each business's Settings → Bot → "🔧 Fix commands" button will also reset the webhook.

Or use the API:
```bash
curl -X POST https://your-domain.com/api/bot/refresh-webhook \
  -H "x-telegram-init-data: YOUR_INIT_DATA"
```

### Step 8: Test everything
1. Send a message to one of your bots
2. Check logs: `pm2 logs minime`
3. Test the dashboard at https://your-domain.com

### Step 9: Remove from Vercel (optional)
Once everything works on VPS for 48 hours, you can remove the Vercel project.

---

## Monthly Cost Comparison

| Before (Vercel) | After (VPS) | Savings |
|---|---|---|
| Vercel Hobby: $0 (limited) | Hetzner CX21: €4.51/mo | — |
| Would need Vercel Pro: $20/mo | Domain: $1.17/mo ($14/yr) | **$14.32/month saved** |
| Total: $20/mo | Total: **€5.68/mo (~$6.20)** | **$13.80/month cheaper** |

---

## What You Gain on VPS

| Feature | Vercel Hobby | VPS |
|---|---|---|
| Cron frequency | 1x/day max | Every 1 minute |
| Healthcheck | 1x/day | Every 15 minutes ✅ |
| Function timeout | ~60s | Unlimited |
| Cold starts | Yes (3-5s) | None |
| Memory | ~256MB/function | 4 GB shared |
| Process restarts | Auto | Auto (PM2) |
| Custom domain | Need Pro | Included |
| SSH access | No | Yes |
| Log retention | ~24h | Forever |

---

## Maintenance Schedule

**Monthly (~15 min):**
```bash
ssh minime@your-domain.com
sudo apt update && sudo apt upgrade -y
pm2 logs minime --lines 100  # Check for errors
```

**After code updates:**
```bash
ssh minime@your-domain.com
cd minime && git pull && cd apps/web && npm ci && npm run build && pm2 reload minime
```

**Automated:**
- SSL certificate renewals: automated via certbot
- Log rotation: configured automatically
- PM2 restarts on crash: configured
- PM2 starts on reboot: configured

---

## Need Help?

If something goes wrong:
```bash
# Check app status
pm2 status

# View recent logs
pm2 logs minime --lines 50

# View nginx logs
sudo tail -f /var/log/nginx/error.log

# Restart the app
pm2 restart minime

# Check nginx
sudo nginx -t && sudo systemctl reload nginx
```
