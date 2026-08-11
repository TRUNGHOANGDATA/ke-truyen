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

docker compose up -d --build
echo ""
echo "Up. Once your domain's DNS points to this server, open https://${DOMAIN:-your-domain}"
