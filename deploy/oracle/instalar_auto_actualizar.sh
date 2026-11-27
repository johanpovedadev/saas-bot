#!/usr/bin/env bash
# Instala la actualización automática en el servidor de Oracle (una sola vez; se puede repetir sin problema).
# Lo corre ejecutar_en_oracle.bat desde el PC de Johan:
#   curl -fsSL https://raw.githubusercontent.com/johanpovedadev/saas-bot/develop/deploy/oracle/instalar_auto_actualizar.sh | bash
#
# Qué hace:
#  1. Deja auto_actualizar.sh en ~/lion-stack/auto/.
#  2. Programa el "despertador" (cron) cada 10 minutos, con candado (flock) para que nunca corran dos a la vez.
#  3. Lo corre una vez ya mismo, para subir lo que esté pendiente (por ejemplo el arreglo #220 de la heladería).
set -euo pipefail
DIR=~/lion-stack/auto
RAW=https://raw.githubusercontent.com/johanpovedadev/saas-bot/develop/deploy/oracle/auto_actualizar.sh

echo "== 1. Bajando el actualizador"
mkdir -p "$DIR"
curl -fsSL "$RAW?nocache=$(date +%s)" -o "$DIR/auto_actualizar.sh.nuevo"
bash -n "$DIR/auto_actualizar.sh.nuevo"
mv "$DIR/auto_actualizar.sh.nuevo" "$DIR/auto_actualizar.sh"
chmod +x "$DIR/auto_actualizar.sh"

echo "== 2. Programando cada 10 minutos"
LINEA="*/10 * * * * flock -n /tmp/auto_actualizar.lock bash $DIR/auto_actualizar.sh >> $DIR/auto.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'auto_actualizar.sh' ; echo "$LINEA" ) | crontab -
crontab -l | grep auto_actualizar

echo "== 3. Primera corrida (sube lo pendiente)"
flock -n /tmp/auto_actualizar.lock bash "$DIR/auto_actualizar.sh" 2>&1 | tee -a "$DIR/auto.log"
echo "== Listo. Registro en $DIR/auto.log"
