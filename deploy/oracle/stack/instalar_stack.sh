#!/usr/bin/env bash
# Instala o actualiza el stack (Lion Platform + Mundo Helados) en el servidor de Oracle con Docker.
# Lo corre mudar_heladeria_lion_oracle.bat despues de subir ~/stack_oracle.tgz:
#   bash ~/instalar_stack.sh
# Idempotente: la primera vez instala Docker y restaura la base del CRM; las siguientes solo
# actualiza codigo y reconstruye. Nunca pisa una base que ya tiene datos.
set -euo pipefail
PKG="$HOME/stack_oracle.tgz"
DIR="$HOME/lion-stack"
[ -f "$PKG" ] || { echo "Falta $PKG"; exit 1; }

echo "== Docker (solo la primera vez)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo docker compose version >/dev/null

echo "== Puertos 80/443 en el firewall de Ubuntu"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT 5 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
command -v netfilter-persistent >/dev/null && sudo netfilter-persistent save >/dev/null || true
# Si quedo un Caddy instalado fuera de Docker (instalar_lion.sh), se apaga: el puerto es del contenedor.
systemctl is-active -q caddy 2>/dev/null && sudo systemctl disable --now caddy || true
systemctl is-active -q lion-api 2>/dev/null && sudo systemctl disable --now lion-api || true

echo "== Puertos que usa el stack deben estar libres (o ser del propio stack)"
cd "$DIR" 2>/dev/null && sudo docker compose down --remove-orphans >/dev/null 2>&1 || true
for p in 80 443 5432 8000 8081 8096; do
  if sudo ss -ltnp | grep -q ":$p "; then echo "PUERTO $p OCUPADO por otro programa:"; sudo ss -ltnp | grep ":$p "; exit 78; fi
done

echo "== Archivos"
mkdir -p "$DIR/saas-bot"
tar -xzf "$PKG" -C "$DIR"
rm -f "$PKG"
cd "$DIR"
# Codigo de los bots: la primera vez entra completo (con la sesion de WhatsApp, db.sqlite3 y data
# del PC). En las siguientes solo se actualiza el codigo: los datos del servidor mandan.
if [ -f "$HOME/saas_oracle.tgz" ]; then
  rm -rf /tmp/saas_nuevo && mkdir /tmp/saas_nuevo && tar -xzf "$HOME/saas_oracle.tgz" -C /tmp/saas_nuevo
  if [ -f saas-bot/db.sqlite3 ]; then
    rsync -a --exclude db.sqlite3 --exclude bot-wasap/auth --exclude bot-wasap/data --exclude node_modules /tmp/saas_nuevo/ saas-bot/
  else
    rsync -a /tmp/saas_nuevo/ saas-bot/
  fi
  rm -rf /tmp/saas_nuevo "$HOME/saas_oracle.tgz"
fi

IP=$(curl -fsS https://api.ipify.org)
HOST="$(echo "$IP" | tr . -).sslip.io"
if [ ! -f .env ]; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
  echo "QR_TOKEN=qr-$(openssl rand -hex 8)" >> .env
fi
grep -q '^PUBLIC_HOST=' .env && sed -i "s/^PUBLIC_HOST=.*/PUBLIC_HOST=$HOST/" .env || echo "PUBLIC_HOST=$HOST" >> .env
chmod 600 .env lion-api/lion-api.env
. ./.env
sed -e "s/{{HOST}}/$HOST/" -e "s/{{QR_TOKEN}}/$QR_TOKEN/" Caddyfile.plantilla > Caddyfile

echo "== Imagenes"
sudo docker compose build

echo "== Dependencias del bot para Linux (node_modules de Windows no sirve)"
rm -rf saas-bot/bot-wasap/node_modules
sudo docker compose run --rm --no-deps heladeria-bot sh -c "npm ci --omit=dev --no-audit --no-fund"

echo "== Base del CRM"
sudo docker compose up -d postgres
for i in $(seq 1 30); do sudo docker compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 3; done
TABLAS=$(sudo docker compose exec -T postgres psql -U postgres -d lionplatform -tAc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$TABLAS" = "0" ] && [ -f lion.sql ]; then
  echo "Restaurando la copia del PC..."
  sudo docker compose exec -T postgres psql -U postgres -d lionplatform -v ON_ERROR_STOP=1 -q < lion.sql
else
  echo "La base ya tiene $TABLAS tablas: no se toca"
fi
rm -f lion.sql
sudo docker compose exec -T postgres psql -U postgres -d lionplatform -tAc "select 'prospectos='||count(*) from prospects"

echo "== Arrancando todo"
sudo docker compose up -d
for i in $(seq 1 40); do curl -fsS 127.0.0.1:8081/api/v1/health >/dev/null 2>&1 && break; sleep 5; done
sudo docker compose ps
echo "API: $(curl -fsS 127.0.0.1:8081/api/v1/health || echo 'NO RESPONDE')"
echo "Django: $(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:8000/ || true)"
echo "CRM:        https://$HOST"
echo "QR heladeria: https://$HOST/$QR_TOKEN/qr_code.png"
echo "LISTO_STACK"
