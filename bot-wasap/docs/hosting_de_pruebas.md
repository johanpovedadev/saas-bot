# Servidor de pruebas para los bots (Docker)

Estado al 11 oct 2026. **Preparado y sin probar con Docker**: el daemon de Docker de este equipo estaba apagado, así que la
imagen no se construyó todavía; los archivos YAML y `index.js` sí se validaron. La primera construcción en el servidor es la
prueba real. Contexto y precios: `LionCore/estudio_hosting_servidor_bots.html` (8 oct 2026).

## Qué es

Un contenedor por negocio, con su **propio número de WhatsApp de prueba**, en un servidor barato (recomendado: Hetzner
CX23, ≈ €5,5–6/mes; sirve para 4–6 bots). No reemplaza al equipo de producción: sirve para probar sin tocar clientes reales.

> **Regla de oro:** nunca el mismo número de WhatsApp que el de producción. Dos sesiones del mismo número se cierran entre sí.

## Qué se agregó

| Archivo | Para qué |
|---|---|
| `bot-wasap/Dockerfile` | Node 20 + Chromium del sistema, usuario sin privilegios, `tini`, healthcheck en `/health` |
| `bot-wasap/.dockerignore` | No mete sesiones, datos, `.env` ni pruebas en la imagen |
| `deploy/docker-compose.pruebas.yml` | Un negocio por contenedor; volúmenes para sesión, datos y logs; estado solo en `127.0.0.1` |
| `deploy/.env.pruebas.example` | Variables de prueba (sin secretos) |
| `.github/workflows/deploy-pruebas.yml` | Despliegue **manual** por SSH (nunca automático) |
| `bot-wasap/index.js` | `CHROME_PATH` y `WA_HEADLESS` (sin ellas, igual que siempre: Chrome de Windows con ventana) |

## Puesta en marcha (una sola vez, ~30 min)

1. **Crear el servidor**: Hetzner CX23, Ubuntu 24.04, con tu llave SSH. Firewall: solo el puerto 22.
2. **Instalar Docker**:
   ```bash
   curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
   ```
3. **Clonar** el repositorio (con una *deploy key* de solo lectura) en `~/lion-bot`.
4. **Configurar**: `cd ~/lion-bot/deploy && cp .env.pruebas.example .env.pruebas` y completar `LION_STATUS_TOKEN`
   (`openssl rand -hex 32`) y, si se quiere IA, `GEMINI_API_KEY` de pruebas.
5. **Levantar**: `docker compose -f docker-compose.pruebas.yml up -d --build`.
6. **Vincular el WhatsApp de prueba**: `docker logs -f lion-bot-pruebas` muestra el QR (o se guarda en el volumen); se
   escanea con el teléfono de prueba. La sesión queda en el volumen `bot_auth`.
7. **Ver el estado desde tu equipo**: `ssh -L 8096:127.0.0.1:8096 usuario@servidor` y abrir `http://localhost:8096/health`.

## Desplegar después

GitHub → Actions → **Desplegar al servidor de pruebas** → *Run workflow* (rama por defecto `develop`). Necesita los
secretos del repositorio `PRUEBAS_HOST`, `PRUEBAS_USER` y `PRUEBAS_SSH_KEY` (y opcionalmente `PRUEBAS_PORT`), dentro de un
*environment* llamado `pruebas`.

## Qué falta para que sea "como producción"

- El backend del negocio (Django) y su hoja de Google: hoy viven en el equipo de casa. Para pruebas se puede apuntar
  `API_BASE` a un túnel, o correr Django en otro contenedor (pendiente).
- Copias de seguridad del volumen `bot_auth` (la sesión de WhatsApp): `docker run --rm -v bot_auth:/a -v $PWD:/b busybox tar czf /b/auth.tgz -C /a .`
- Monitoreo: el `healthcheck` de Docker ya reinicia ante fallos; falta una alerta (UptimeRobot o el panel de Lion Platform
  apuntando a `/status` con el token).
- Probar la construcción en ARM (`CAX11`) si se prefiere ese servidor: `better-sqlite3` y `canvas` traen binarios para
  `arm64`, pero no se verificó.

## Riesgos conocidos

- Chrome en contenedor pide `--no-sandbox` (el bot ya lo pasa); por eso el contenedor corre sin privilegios y sin puertos
  públicos.
- Una IP de datacenter puede ser mirada con más sospecha por WhatsApp que una residencial: por eso es **pruebas**; la
  decisión de mover producción se toma con datos de varias semanas.
