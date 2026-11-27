#!/usr/bin/env bash
# Instala la actualización automática en el servidor de Oracle (una sola vez; se puede repetir sin problema).
# Lo corre ejecutar_en_oracle.bat desde el PC de Johan:
#   curl -fsSL https://raw.githubusercontent.com/johanpovedadev/saas-bot/develop/deploy/oracle/instalar_auto_actualizar.sh | bash
#
# Qué hace:
#  1. Deja auto_actualizar.sh en ~/lion-stack/auto/.
#  2. Lo corre una vez ya mismo, para subir lo que esté pendiente (por ejemplo el arreglo #220 de la heladería).
#  3. Programa el "despertador" cada 10 minutos (un temporizador de systemd), con candado (flock) para que nunca corran
#     dos a la vez.
set -euo pipefail
exec 2>&1  # los errores también se ven en el registro del PC
DIR=~/lion-stack/auto
RAW=https://raw.githubusercontent.com/johanpovedadev/saas-bot/develop/deploy/oracle/auto_actualizar.sh

echo "== 1. Bajando el actualizador"
mkdir -p "$DIR"
curl -fsSL "$RAW?nocache=$(date +%s)" -o "$DIR/auto_actualizar.sh.nuevo"
bash -n "$DIR/auto_actualizar.sh.nuevo"
mv "$DIR/auto_actualizar.sh.nuevo" "$DIR/auto_actualizar.sh"
chmod +x "$DIR/auto_actualizar.sh"

echo "== 2. Primera corrida (sube lo pendiente; antes de prender el temporizador para que no se crucen)"
flock -w 600 /tmp/auto_actualizar.lock bash "$DIR/auto_actualizar.sh" 2>&1 | tee -a "$DIR/auto.log" || echo "(la primera corrida terminó con aviso: ver $DIR/auto.log)"

echo "== 3. Programando cada 10 minutos (temporizador de systemd; no necesita cron instalado)"
# El primer intento usaba cron, pero el servidor no lo tiene instalado (27 nov 2026): systemd viene siempre en Ubuntu.
( crontab -l 2>/dev/null | grep -v 'auto_actualizar.sh' | crontab - ) 2>/dev/null || true   # quita la línea vieja si existiera
sudo tee /etc/systemd/system/auto-actualizar.service >/dev/null <<UNIT
[Unit]
Description=Actualizacion automatica de los bots (Lion)
After=network-online.target docker.service

[Service]
Type=oneshot
User=$(whoami)
Environment=HOME=$HOME
ExecStart=/usr/bin/flock -n /tmp/auto_actualizar.lock /bin/bash $DIR/auto_actualizar.sh
StandardOutput=append:$DIR/auto.log
StandardError=append:$DIR/auto.log
UNIT
sudo tee /etc/systemd/system/auto-actualizar.timer >/dev/null <<UNIT
[Unit]
Description=Cada 10 minutos: revisar si hay cambios nuevos de los bots

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now auto-actualizar.timer
systemctl list-timers auto-actualizar.timer --no-pager | head -3

echo "== Listo. Registro en $DIR/auto.log"
