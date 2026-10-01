# Auditoría de aislamiento multitenant — 1 oct 2026

Origen: con varios bots corriendo al mismo tiempo en el mismo equipo, los mensajes se cruzaban
entre bots (se terminó separándolos en carpetas distintas). Objetivo: que 10 o 20 bots puedan
correr juntos, cada uno con todo lo suyo aparte, compartiendo solo el código base.

## Cómo corre hoy cada bot

Un proceso PM2 por negocio, **todos con el mismo `cwd` (`bot-wasap/`)**, distinguidos solo por
`BUSINESS_KEY`. Eso está bien siempre que **todo** lo que el proceso toca (sesión de WhatsApp,
archivos en disco, puertos, backend, variables de entorno) esté separado por negocio. La auditoría
revisó cada uno de esos puntos.

## Hallazgos

| # | Gravedad | Hallazgo | Estado |
|---|---|---|---|
| 1 | Crítica | 9 archivos JSON en `data/` son **uno para todos los bots** (silenciados, esperando humano, horarios, `bot_owners.json`...). Escritura no atómica + leer-modificar-escribir sin candado: con 6 bots a la vez se **perdió el 97% de las escrituras** y 4 negocios quedaron **sin ningún dato**. Una lectura a medias borraba los datos de TODOS. Si se borra `bot_owners.json`, los bots dejan de reconocerse entre sí y vuelve el eco entre bots ("flujos revueltos"). | **Corregido** (`utils/sharedJsonFile.js`) |
| 2 | Alta | `data/users.db` con clave solo `jid`: un negocio saludaba con el nombre que el cliente le dio a OTRO negocio y se saltaba pedirlo. | **Corregido** (tabla `tenant_users`, clave jid+negocio) |
| 3 | Alta | Un bot sin `BUSINESS_KEY` arrancaba como **mascotas** y abría su sesión de WhatsApp: dos procesos contestando el mismo número. | **Corregido** (no arranca) |
| 4 | Alta | Nada impedía dos procesos del **mismo** negocio (el arranque incluso borra los candados de Chrome de esa sesión). | **Corregido** (candado de instancia `auth/<negocio>/bot-instance.lock`) |
| 5 | Alta | El servidor de estado (con `/send`, `/leads`, `/messages`, `/pause`) caía por defecto en el **8096 de heladería**: `bot-dev` (sin puerto) podía quedarse con él y responder en nombre de heladería. | **Corregido** (sin puerto propio no se levanta) |
| 6 | Alta | `dev.json` apunta al Django de **mascotas** y usa **la misma hoja de Google** de mascotas. `empanadas.json` -> Django de heladería, `funeraria.json` -> Django de pescadería. `pilates*` sin `api_base` caen al 8001 (mascotas). | **Pendiente (Johan)**: no se tocó `config/businesses/*.json` |
| 7 | Alta (seguridad) | `LION_STATUS_TOKEN` en texto plano en `ecosystem.config.js` (commiteado) y predecible; el servidor escucha en todas las interfaces. Con el token, cualquiera en la red usa `/send` de ese bot. | **Pendiente (Johan)**: mover a `.env.<negocio>` con valor aleatorio |
| 8 | Media | `.env` compartido: cualquier variable de UN negocio que viva ahí (hoja, token, `WHATSAPP_CLOUD_API_PHONE_NUMBER_ID`, `GOOGLE_CALENDAR_ID`, `ADMIN_JID`...) la heredan en silencio los negocios sin `.env.<negocio>` (ya pasó con pescadería). | **Detectado por el script de auditoría** |
| 9 | Media | Si el número admin de un negocio es el número de OTRO bot, los avisos le llegan a ese bot como cliente (eco). La protección (`isRegisteredBotNumber`) depende de `bot_owners.json` (hallazgo 1). | Protección ahora estable; **el script lo detecta** |
| 10 | Baja | `tmp/failed_order_*.json` sin negocio en el nombre. | **Corregido** |

Lo que SÍ estaba bien: sesión de WhatsApp por negocio (`auth/<negocio>`), QR por negocio, logs por
negocio, Chrome con perfil propio, Django cargando primero su `.env.<negocio>`, y el estado de las
conversaciones en memoria (un proceso por negocio).

## Pruebas automáticas

- `test_aislamiento_multitenant_procesos.js` (en CI): procesos REALES en paralelo, misma carpeta de
  datos, como en el equipo:
  - 6 bots escriben a la vez en los stores compartidos: 0 escrituras perdidas, 0 archivos corruptos,
    ningún dato bajo la llave de otro negocio.
  - heladería, pescadería y mascotas atienden al MISMO cliente al mismo tiempo: cada uno responde
    solo con su negocio, solo a ese cliente, y el nombre dado a uno no lo conoce el otro.
  - un segundo proceso del mismo negocio no arranca; uno de otro negocio sí.
  - `index.js` sin `BUSINESS_KEY` no arranca; sin `LION_STATUS_PORT` no hay servidor de estado.
- Evidencia antes/después (6 procesos × 200 escrituras): código viejo **1.165 de 1.200 perdidas**;
  código nuevo **0**.

## Cómo validarlo en el equipo (antes de dar por cerrado)

1. `cd bot-wasap && node scripts/audit-tenant-isolation.js` — revisa la configuración REAL (PM2,
   `.env`, `.env.<negocio>`, `config/businesses`, `bot_owners.json`, `data/`). Debe salir sin ❌.
2. `node test_aislamiento_multitenant_procesos.js` — debe pasar completo en Windows.
3. Reiniciar los bots **uno por uno** con PM2 (`pm2 restart bot-<negocio>`) y revisar en el log que
   cada uno muestre SU nombre, SU Auth (`auth\<negocio>`), SU Sheet y SU API Base.
4. Prueba en vivo: desde un mismo celular escribir "hola" a 3 bots a la vez. Cada uno debe contestar
   con su negocio. Luego `pm2 start bot-<negocio>` sobre uno que ya corre: el segundo proceso debe
   negarse a arrancar con "Ya hay un bot de ... corriendo".
5. Revisar que ningún número admin de `config/businesses/*.json` sea el número de otro bot.

## Propuesta: dos líneas de producto (para decidir)

- **Lite (económica)** — lo que corre hoy en Mundo Helados: flujo de reglas con IA puntual
  (`<negocio>.flow.js` + `<negocio>Ai.js`). Agente apagado. Costo de IA bajo.
- **Agente (premium)** — `handlers/agent/cartAgent.core.js` + un plugin por negocio
  (`<negocio>.agent.js`), encendido con `<NEGOCIO>_AI_AGENT=1`. Más IA por turno, más caro.

Ya conviven en el mismo código sin mezclarse: el agente solo se carga si el flag del negocio está
encendido, y si la IA falla el negocio cae a su flujo Lite. Para un rubro nuevo (ej. citas) se crea su
módulo propio (`citas.flow.js` para Lite y/o `citas.agent.js` para Agente) sin tocar los demás.
Decisiones pendientes: si las dos líneas viven en el mismo repo con un flag por negocio (recomendado:
un solo código, menos mantenimiento) o en repos/ramas separadas; y cómo se factura el consumo de IA
del Agente (por negocio, con su propia `GEMINI_API_KEY` en `.env.<negocio>`, recomendado).
