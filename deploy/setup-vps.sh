#!/bin/bash
# ============================================================
# MiniMe VPS Setup Script
# Run as root on a fresh Ubuntu 22.04 LTS server
# Usage: curl -sSL https://your-domain/setup.sh | bash
# ============================================================

set -e

DOMAIN="your-domain.com"         # CHANGE THIS
APP_USER="minime"
APP_DIR="/home/$APP_USER/minime"
NODE_VERSION="20"

echo "=== MiniMe VPS Setup ==="
echo "Domain: $DOMAIN"
echo ""

# --- 1. System packages ---
apt-get update -y
apt-get upgrade -y
apt-get install -y curl wget git nginx certbot python3-certbot-nginx ufw fail2ban htop

# --- 2. Firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable
echo "✅ Firewall configured"

# --- 3. fail2ban (brute-force protection) ---
systemctl enable fail2ban
systemctl start fail2ban
echo "✅ fail2ban active"

# --- 4. Create app user (never run as root) ---
useradd -m -s /bin/bash $APP_USER 2>/dev/null || true
echo "✅ App user created: $APP_USER"

# --- 5. Node.js via nvm ---
sudo -u $APP_USER bash -c "
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR=\"\$HOME/.nvm\"
  source \"\$NVM_DIR/nvm.sh\"
  nvm install $NODE_VERSION
  nvm use $NODE_VERSION
  nvm alias default $NODE_VERSION
  npm install -g pm2
"
echo "✅ Node.js $NODE_VERSION + PM2 installed"

# --- 6. Nginx config ---
cat > /etc/nginx/sites-available/minime << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options ALLOWALL always;        # Telegram Mini App needs this
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;    # matches our webhook maxDuration
        proxy_connect_timeout 10s;
    }

    # Static files cache
    location /_next/static {
        proxy_pass http://localhost:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
EOF

ln -sf /etc/nginx/sites-available/minime /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "✅ Nginx configured"

# --- 7. SSL certificate ---
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN
echo "✅ SSL certificate obtained"

# --- 8. Cron for certificate renewal ---
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
echo "✅ Certificate auto-renewal scheduled"

echo ""
echo "=== Setup complete! ==="
echo "Next step: deploy your app as user '$APP_USER'"
echo "See deploy.sh for deployment instructions"
