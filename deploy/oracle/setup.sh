#!/usr/bin/env bash
# Deja listo el servidor gratis de Oracle (Ubuntu 22.04/24.04 ARM) para los bots. Se corre una vez:
#   bash setup.sh
# Es idempotente: si algo ya está instalado, lo salta. No copia datos ni sesiones (ver LEEME.md).
set -euo pipefail
HOME_DIR="${HOME:-/home/ubuntu}"

echo "== Zona horaria de Colombia (los informes corren a la hora de Bogotá)"
sudo timedatectl set-timezone America/Bogota

echo "== Memoria de intercambio de 2 GB (por si varios Chromium arrancan juntos)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== Paquetes base, Python y Chromium"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates python3 python3-venv python3-pip fonts-noto-color-emoji
# En Ubuntu, chromium-browser es un snap; funciona con puppeteer pasando su ruta en CHROME_PATH.
command -v chromium-browser >/dev/null || sudo snap install chromium
command -v chromium-browser >/dev/null || { echo "No quedó Chromium instalado"; exit 1; }

echo "== Node 20 y PM2"
if ! command -v node >/dev/null || ! node -v | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v pm2 >/dev/null || sudo npm install -g pm2

echo "== Repos"
cd "$HOME_DIR"
[ -d saas-bot ] || git clone https://github.com/johanpovedadev/saas-bot.git
[ -d agentvents ] || git clone https://github.com/johanpovedadev/agentvents.git
(cd saas-bot && git checkout main && git pull --ff-only)
(cd agentvents && git checkout main && git pull --ff-only)

echo "== Dependencias"
(cd saas-bot && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt)
(cd saas-bot/bot-wasap && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund)
(cd agentvents && npm ci --omit=dev --no-audit --no-fund)

echo "== PM2 arranca solo cuando el servidor se reinicia"
sudo env PATH="$PATH" pm2 startup systemd -u "$(whoami)" --hp "$HOME_DIR" >/dev/null

cat <<MSG

LISTO el servidor. Faltan los datos (no van en git):
  1. Copiar los .env, las bases (.db/.sqlite) y las sesiones de WhatsApp desde el PC (ver LEEME.md).
  2. pm2 start ~/saas-bot/deploy/oracle/ecosystem.oracle.config.js --only bot-finance-telegram   (probar uno)
  3. pm2 start ~/saas-bot/deploy/oracle/ecosystem.oracle.config.js && pm2 save
MSG
