# Auditoría de seguridad y pruebas — 10 oct 2026

Alcance: bots de WhatsApp (`bot-wasap`), servidor de estado/control de cada bot, panel de administración
(`admin-panel`), dependencias y la conversación con el cliente final. Todas las pruebas con **IA simulada**
(cero tokens). Los ataques se probaron contra instancias locales propias; nada contra clientes ni números reales.

## Resumen

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | El panel se publica a internet por un túnel de Cloudflare y aceptaba intentos de login ilimitados (12 seguidos sin freno) | Alta | **Corregido** (PR #35) |
| 2 | Servidor de estado de cada bot en todas las interfaces, token predecible commiteado en un repo público (`/send` envía WhatsApp como el negocio) | Alta | **Enlace corregido** (127.0.0.1); **rotar token pendiente** |
| 3 | Login: usuario `constructor`/`__proto__` → 500; respuesta más rápida con usuario inexistente; sesión no regenerada | Media | **Corregido** |
| 4 | Panel sin cabeceras de seguridad (clickjacking, MIME sniffing, CSP), `X-Powered-By` visible | Media | **Corregido** |
| 5 | 16 dependencias con vulnerabilidades altas (`npm audit --omit=dev`) | Alta | 6 corregidas; **10 quedan** (requieren versión mayor) |
| 6 | Los procesos PM2 en marcha no tienen `LION_STATUS_PORT`/`LION_STATUS_TOKEN`: el servidor de estado no está levantado, el kill switch desde el CRM no puede llegar a los bots arrancados desde `empanadas` | Media (operativo) | Pendiente: reiniciar con `ecosystem.config.js` |
| 7 | `bot-wasap/logs/<negocio>-conversations.log` guarda teléfono + texto de los clientes finales en claro, sin rotación (heladería: unas 76.000 líneas desde agosto, mezcladas con tráfico de pruebas) | Media (privacidad) | **Decisión de Johan** (ver abajo) |
| 8 | Perfiles del cliente recurrente caducados seguían en disco | Baja (privacidad) | **Corregido** en PR #34 |
| 9 | `db.sqlite3` versionado en un repo público (hoy solo esquema de Django: 0 usuarios) | Baja | Pendiente: quitarlo del índice con `git rm --cached` |
| 10 | Sin límite de mensajes por chat: un cliente puede hacer que el bot conteste cientos de veces (tope global `AI_DAILY_MAX` acota el costo, pero un chat podría agotarlo) | Baja–Media | Pendiente; el freno de mensajes idénticos ya existe |
| 11 | Bot de Ricuras del Pacífico (Pescadería) detenido en PM2: es el relevo del `/resume` del kill switch | Operativo | Informado |

## Lo que se probó y salió bien

- **Autenticación**: todas las rutas del panel y de la API sin sesión responden 302/401; `POST /api/.../pause` y `/send` sin sesión, 401.
- **Servidor de estado**: sin token configurado todo lo protegido responde 401 (cierra por defecto); token vacío, con una letra de más/menos, 5.000 caracteres, sin `Bearer` o con otro esquema: 401. Sin token, `/pause`, `/send`, `/chats/mute`, `/messages` no cambian nada.
- **Recorrido de rutas**: `..%2f..%2f.env` y `%2e%2e/server.js` contra el panel: 404.
- **Entradas hostiles al bot** (29 casos, IA simulada): 20.000 caracteres, nulos, RTL override, 2.000 emojis, plantillas `{{7*7}}` y `${process.env…}`, `<script>`, SQL, rutas `../`, `__proto__`, JSON de "sistema", inyección de prompt en español e inglés, "DAN", comandos de administración (`silenciar`, `reactivar`, `/pause`), `pm2 stop`, cantidades `99999999999999999999`, `-5`, `1e9`, "precio $0", comprobante falso, URLs internas (`169.254.169.254`, `file://`), saltos de línea y espacios. Resultado: ninguna excepción, ninguna fuga de claves ni de trazas, respuestas acotadas, y las peticiones sobre información interna reciben la negativa fija.
- **Secretos en el repo**: búsqueda por patrones (Google, OpenAI, GitHub, Slack, claves privadas, JWT, asignaciones `token=`/`password=`) sin coincidencias reales; solo valores falsos de pruebas.
- **UI del panel** (navegador, cuenta de prueba): inicia sesión, muestra las tarjetas de cada negocio, estado, chats en espera y conversaciones, sin errores de consola bajo la política CSP; el bloqueo por intentos muestra "Demasiados intentos fallidos. Espera 15 min".
- **Conversación (UI del cliente)**: simulador con IA simulada 136/137 (1 pendiente a propósito) y 1.686 verificaciones; sin IA (el "piso" del bot) 100/101.

## Decisiones que son de Johan

1. **Rotar los tokens** `dev-lion-status-token-*` de `ecosystem.config.js`: cambiar a la vez el bot y el backend de Lion Platform, y sacarlos del archivo (a `.env.<negocio>`).
2. **Registro de conversaciones**: o bien se acota (p. ej. conservar 30 días y rotar), o se mantiene porque alimenta "Conversaciones recientes" del panel. La regla del backend (ADR-014) dice que los mensajes de los clientes finales no se persisten; el bot hoy sí los deja en este archivo.
3. **Túnel de Cloudflare**: pasar a un túnel con nombre y Cloudflare Access (o al menos un dominio fijo) en vez de la URL temporal.

## Cómo repetir las pruebas

```bash
# bot: suite completa y simulador (IA simulada)
cd bot-wasap && node scripts/run-tests.js && node tests_sim/run.js --ai=sim
# panel
cd admin-panel && for t in test_*.js; do node "$t"; done
# dependencias
cd bot-wasap && npm audit --omit=dev
```
