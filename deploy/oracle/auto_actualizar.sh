#!/usr/bin/env bash
# =====================================================================================================================
# Actualización automática del servidor de Oracle (Johan, 27 nov 2026: "lo máximo que se pueda pasar a la nube").
#
# EN FÁCIL: cada 10 minutos el servidor mira en GitHub si hay un cambio nuevo aprobado (en develop). Si lo hay, se lo
# baja, revisa que no tenga errores de escritura, cambia los archivos, reinicia el bot y mira que haya quedado vivo.
# Si algo sale mal, vuelve solo a la versión de antes. En los dos casos le avisa a Johan por Telegram (Jarvis).
# Así ya no hace falta el PC ni el doble clic al .bat para subir un arreglo.
#
# TÉRMINOS:
#  - cron: el "despertador" de Linux que corre este script cada 10 minutos (lo instala instalar_auto_actualizar.sh).
#  - SHA: la "huella" de cada versión en GitHub. Si la huella de develop cambió, hay algo nuevo.
#  - tarball: el código de esa versión empacado en un solo archivo .tar.gz (los repos son públicos: no hay claves).
#  - rollback: volver a la versión anterior si la nueva no arranca.
#
# Qué actualiza:
#  1. saas-bot (bot-wasap): el bot de la heladería (Docker, ~/lion-stack/saas-bot) y Leo (PM2, ~/saas-bot).
#     Solo reemplaza archivos que están en GitHub: nunca toca .env, sesiones de WhatsApp, bases de datos ni node_modules.
#     Si cambiaron las dependencias (package-lock.json), NO se aplica solo: avisa para instalarlo a mano.
#  2. AGentVents (~/agentvents): con su propio instalador, conservando el .env y la carpeta data/.
# =====================================================================================================================
set -uo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$HOME/.local/bin"  # cron arranca con un PATH mínimo

OWNER=johanpovedadev
BRANCH=${AUTO_BRANCH:-develop}
STATE=${AUTO_STATE:-$HOME/lion-stack/auto/estado}
WORK=${AUTO_WORK:-$HOME/lion-stack/auto/trabajo}
STACK=${AUTO_STACK:-$HOME/lion-stack}
HELADERIA_TREE=${AUTO_HELADERIA_TREE:-$STACK/saas-bot}
LEO_TREE=${AUTO_LEO_TREE:-$HOME/saas-bot}
AGENTVENTS=${AUTO_AGENTVENTS:-$HOME/agentvents}
GITHUB_API=${AUTO_GITHUB_API:-https://api.github.com}
CODELOAD=${AUTO_CODELOAD:-https://codeload.github.com}
WAIT_HEALTH=${AUTO_WAIT_HEALTH:-40}
SUDO=${AUTO_SUDO-sudo}  # vacío en las pruebas (sin sudo)

mkdir -p "$STATE" "$WORK"
log() { echo "[$(date '+%F %T')] $*"; }

# --- Aviso a Johan por Telegram (Jarvis), con las llaves que ya tiene AGentVents ------------------------------------
avisar() {
  local env="$AGENTVENTS/.env" token chat
  [ -f "$env" ] || { log "sin $env: no aviso por Telegram"; return 0; }
  token=$(grep -E '^HERMES_BOT_TOKEN=' "$env" | cut -d= -f2-)
  chat=$(grep -E '^HERMES_CHAT_ID=' "$env" | cut -d= -f2-)
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  curl -fsS -m 15 "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat}" --data-urlencode "text=$1" >/dev/null 2>&1 || log "no se pudo avisar por Telegram"
}

# Huella (SHA) de la última versión de la rama en GitHub.
huella() { curl -fsS -m 20 -H 'Accept: application/vnd.github.sha' "$GITHUB_API/repos/$OWNER/$1/commits/$BRANCH"; }

# Baja el código de esa huella y lo deja en $WORK/<repo>.
bajar() {
  local repo=$1 sha=$2 dir="$WORK/$1"
  rm -rf "$dir" && mkdir -p "$dir"
  curl -fsSL -m 120 "$CODELOAD/$OWNER/$repo/tar.gz/$sha" | tar -xz -C "$dir" --strip-components=1
}

# Revisa que todos los .js de una carpeta se puedan leer (errores de escritura = no se sube nada).
revisar_js() {
  local bad=0 f
  while IFS= read -r -d '' f; do
    node --check "$f" 2>/dev/null || { log "ERROR de sintaxis en ${f#"$1"/}"; bad=1; }
  done < <(find "$1" -name '*.js' -not -path '*/node_modules/*' -print0)
  return $bad
}

# Copia los archivos del código nuevo sobre una carpeta, guardando antes los que va a reemplazar (para volver atrás).
aplicar() {
  local src=$1 dest=$2 backup=$3 list
  list=$(mktemp)
  (cd "$src" && find . -type f -not -path './.git/*' -not -name '.env*' -not -path './bot-wasap/data/*') > "$list"
  rm -f "$backup"
  (cd "$dest" && tar -czf "$backup" --ignore-failed-read -T "$list" 2>/dev/null) || true
  tar -C "$src" -cf - -T "$list" | tar -C "$dest" -xf -
  rm -f "$list"
}

volver_atras() { local dest=$1 backup=$2; [ -s "$backup" ] && tar -C "$dest" -xzf "$backup"; }

heladeria_viva() { [ -n "$($SUDO docker compose -f "$STACK/docker-compose.yml" ps --status running -q heladeria-bot 2>/dev/null)" ]; }
# Estado de una app de PM2: online, stopped, errored… (vacío si no existe).
pm2_estado() { pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d).find(x=>x.name===process.argv[1]);process.stdout.write(a?a.pm2_env.status:"")}catch(_){}})' "$1"; }
leo_vivo() { [ "$(pm2_estado bot-finance-telegram)" = online ]; }

# ---------------------------------------------------------------------------------------------------------------------
# 1. saas-bot: heladería (Docker) y Leo (PM2)
# ---------------------------------------------------------------------------------------------------------------------
actualizar_saas_bot() {
  local sha last src msg
  sha=$(huella saas-bot) || { log "saas-bot: no pude consultar GitHub"; return 0; }
  last=$(cat "$STATE/saas-bot" 2>/dev/null || true)
  [ "$sha" = "$last" ] && return 0
  log "saas-bot: versión nueva ${sha:0:7} (antes ${last:0:7})"
  bajar saas-bot "$sha" || { log "saas-bot: no pude bajar el código"; return 0; }
  src="$WORK/saas-bot"

  if ! revisar_js "$src/bot-wasap"; then
    avisar "⚠️ Actualización ${sha:0:7} de los bots NO se subió: tiene errores de escritura. El bot sigue con la versión anterior."
    echo "$sha" > "$STATE/saas-bot"; return 0
  fi
  if [ -f "$HELADERIA_TREE/bot-wasap/package-lock.json" ] && ! cmp -s "$src/bot-wasap/package-lock.json" "$HELADERIA_TREE/bot-wasap/package-lock.json"; then
    avisar "⚠️ La actualización ${sha:0:7} de los bots cambia dependencias (package-lock.json): no se sube sola. Toca instalarla a mano."
    echo "$sha" > "$STATE/saas-bot"; return 0
  fi

  local cambio_py=0
  if [ -d "$HELADERIA_TREE" ]; then
    (cd "$src" && find . -name '*.py' -not -path './bot-wasap/*' -print0 | xargs -0 -r -I{} cmp -s {} "$HELADERIA_TREE/{}") || cambio_py=1
  fi

  local ok=1 fallas=""
  if [ -d "$HELADERIA_TREE" ]; then
    aplicar "$src" "$HELADERIA_TREE" "$STATE/respaldo_heladeria.tgz"
    $SUDO docker compose -f "$STACK/docker-compose.yml" restart heladeria-bot >/dev/null 2>&1
    [ "$cambio_py" = 1 ] && $SUDO docker compose -f "$STACK/docker-compose.yml" restart heladeria-django >/dev/null 2>&1
  fi
  if [ -d "$LEO_TREE" ]; then
    aplicar "$src" "$LEO_TREE" "$STATE/respaldo_leo.tgz"
    pm2 restart bot-finance-telegram >/dev/null 2>&1 || true
  fi
  sleep "$WAIT_HEALTH"

  if [ -d "$HELADERIA_TREE" ] && ! heladeria_viva; then
    ok=0; fallas="heladería"
    volver_atras "$HELADERIA_TREE" "$STATE/respaldo_heladeria.tgz"
    $SUDO docker compose -f "$STACK/docker-compose.yml" restart heladeria-bot >/dev/null 2>&1
  fi
  if [ -d "$LEO_TREE" ] && [ -n "$(pm2_estado bot-finance-telegram)" ] && ! leo_vivo; then
    ok=0; fallas="${fallas:+$fallas y }Leo"
    volver_atras "$LEO_TREE" "$STATE/respaldo_leo.tgz"
    pm2 restart bot-finance-telegram >/dev/null 2>&1 || true
  fi

  echo "$sha" > "$STATE/saas-bot"
  # El actualizador también se actualiza solo (vale desde la próxima corrida).
  if bash -n "$src/deploy/oracle/auto_actualizar.sh" 2>/dev/null; then cp "$src/deploy/oracle/auto_actualizar.sh" "$(dirname "$STATE")/auto_actualizar.sh" 2>/dev/null || true; fi
  msg=$(curl -fsS -m 20 "$GITHUB_API/repos/$OWNER/saas-bot/commits/$sha" 2>/dev/null | grep -m1 '"message"' | sed -E 's/.*"message": "([^"\\]*).*/\1/' | cut -c1-140)
  if [ "$ok" = 1 ]; then
    avisar "✅ Bots actualizados solos (${sha:0:7}): ${msg:-sin descripción}. Heladería y Leo quedaron funcionando."
  else
    avisar "❌ La actualización ${sha:0:7} no arrancó bien en ${fallas}: volví solo a la versión anterior. ${msg:-}"
  fi
  log "saas-bot: listo (ok=$ok)"
}

# ---------------------------------------------------------------------------------------------------------------------
# 2. AGentVents: informes y plan de ventas
# ---------------------------------------------------------------------------------------------------------------------
actualizar_agentvents() {
  local sha last src
  [ -d "$AGENTVENTS" ] || return 0
  sha=$(huella AGentVents) || { log "AGentVents: no pude consultar GitHub"; return 0; }
  last=$(cat "$STATE/agentvents" 2>/dev/null || true)
  [ "$sha" = "$last" ] && return 0
  log "AGentVents: versión nueva ${sha:0:7}"
  bajar AGentVents "$sha" || { log "AGentVents: no pude bajar el código"; return 0; }
  src="$WORK/AGentVents"
  if ! revisar_js "$src"; then
    avisar "⚠️ Actualización ${sha:0:7} de AGentVents NO se subió: tiene errores de escritura."
    echo "$sha" > "$STATE/agentvents"; return 0
  fi
  cp "$AGENTVENTS/.env" "$src/.env"
  [ -d "$AGENTVENTS/data" ] && cp -r "$AGENTVENTS/data" "$src/data"
  tar -czf "$HOME/agentvents_oracle.tgz" -C "$src" .
  if bash "$src/deploy/oracle/instalar_agentvents.sh" > "$STATE/agentvents_ultima.log" 2>&1; then
    avisar "✅ AGentVents actualizado solo (${sha:0:7}). Informes y plan de ventas al día."
  else
    # El instalador deja la versión anterior en ~/agentvents.anterior; si falló antes del cambio, no se tocó nada.
    avisar "❌ AGentVents ${sha:0:7} no se pudo instalar. Revisar ~/lion-stack/auto/estado/agentvents_ultima.log"
  fi
  echo "$sha" > "$STATE/agentvents"
}

actualizar_saas_bot
actualizar_agentvents
rm -rf "$WORK"
