#!/usr/bin/env bash
set -euo pipefail

# One-command provision for a fresh Ubuntu / Oracle Always Free VPS.
# Usage: DOMAIN=truyen.example.com ./scripts/setup-server.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  echo "Creating .env — you MUST set PASSWORD_HASH and DOMAIN before the app will work."
  cp .env.example .env
  SECRET=$(head -c 32 /dev/urandom | base64)
  sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
  sed -i "s|DOMAIN=.*|DOMAIN=${DOMAIN:-change-me.example.com}|" .env
  echo ""
  echo "Next steps:"
  echo "  1. Generate a password hash:"
  echo "       docker compose run --rm app node scripts/hash-password.js 'E521satan'"
  echo "  2. Paste it into .env as PASSWORD_HASH="
  echo "  3. Set DOMAIN= in .env to your real domain (DNS A-record must point here)"
  echo "  4. Re-run this script."
  exit 0
fi

# Mở cổng 80/443 trên tường lửa của máy — ảnh Oracle Ubuntu chặn sẵn mọi cổng trừ SSH,
# đây là lý do phổ biến nhất khiến web "không vào được" dù container đã chạy.
if command -v iptables >/dev/null 2>&1; then
  echo "Opening firewall ports 80/443…"
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || \
      sudo iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
  done
  # Lưu để giữ sau khi khởi động lại
  sudo netfilter-persistent save 2>/dev/null || \
    sudo sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true
fi

docker compose up -d --build
echo ""
echo "Up. Once your domain's DNS points to this server, open https://${DOMAIN:-your-domain}"
