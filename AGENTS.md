# Proyecto: Bot WhatsApp Multitenant

## 🚨 REGLAS OBLIGATORIAS DE SEGURIDAD (Validar SIEMPRE)

### 1. Aislamiento Multitenant Estricto

- CADA consulta, estado, flujo o función de base de datos DEBE estar asociada al `tenant_id` o `phone_number_id`.
- Queda PROHIBIDO usar variables globales en memoria (ej. `let estado = {}`) para guardar conversaciones.
- NUNCA modifiques una función de búsqueda de usuario sin incluir la cláusula del tenant.
- ANTES de modificar un archivo existente, debes analizar todas las dependencias e importaciones de ese archivo para no romper otros flujos.

### 2. Protocolo de Modificación de Código

- Aplica cambios de forma incremental (un módulo a la vez).
- NUNCA borres ni refactorices funciones existentes a menos que se te indique explícitamente.

### 3. Formato de Respuesta

- Explica brevemente qué archivos vas a editar y cuál es el impacto esperado antes de generar código.

## 🏗 Arquitectura

- Un solo código (`bot-wasap/`) para varios negocios (tenants).
- Cada tenant se distingue por `BUSINESS_KEY` (ej: `pescaderia`, `mascotas`, `finance`).
- Cada tenant corre como proceso PM2 separado — un crash de un bot no tumba a los demás.
- Un bug en archivos compartidos (`handlers/handler.js`, `config/env.loader.js`, `handlers/flowRegistry.js`) ROMPE a todos los tenants.

## 🧩 Requisitos: el pedido no debe romperse cuando el cliente se sale del flujo

**Origen (24 sep 2026):** casi un año de parches puntuales por tenant (heladería, pescadería) para el mismo síntoma: el cliente pide un producto, pregunta otra cosa a mitad de camino, pide algo más — y el bot "explota" (no entiende, pierde lo ya armado, o responde con un error genérico) en vez de seguir armando el pedido. Esto se repite en cada negocio porque cada uno tiene su propia máquina de pasos fija (`RESTAURANT_PHASES` en `pescaderia.flow.js`, equivalente en `heladeria.flow.js`) que espera la respuesta exacta al paso actual. La solución NO es otro parche por tenant — son los requisitos de abajo, pensados para valer en cualquier bot nuevo sin reescribirlos cada vez.

### Requisitos funcionales (RF)

- **RF-01 — Extracción de datos independiente del orden:** la IA debe poder reconocer cualquier dato del pedido (producto, cantidad, sabor/variante, complemento, dirección, medio de pago) en cualquier mensaje del cliente, sin importar en qué paso cree estar el bot.
- **RF-02 — El pedido es un conjunto de campos, no un paso fijo:** el pedido en construcción se representa como un objeto con campos independientes (ej. `{producto, cantidad, sabor, complemento, direccion, pago}`), no como "estás en el paso 3". Cada campo se llena apenas el cliente lo menciona, en cualquier orden.
- **RF-03 — Preguntar solo lo que falta:** en cada turno, el bot identifica qué campos obligatorios siguen vacíos y pregunta específicamente por esos — nunca un genérico "no entendí, sigamos" que reinicia la conversación.
- **RF-04 — Preguntas ajenas al pedido no lo interrumpen:** si el cliente pregunta algo a mitad de armar el pedido (horario, dirección del local, un precio suelto), el bot responde esa pregunta y sigue recordando lo que ya se había armado — el carrito nunca se pierde por una pregunta intermedia.
- **RF-05 — Contrato de salida estructurado obligatorio:** la IA siempre responde en JSON con esquema fijo (algo como `{respuesta_usuario, campos_extraidos, falta}`), nunca en texto libre sin validar. `heladeriaAi.js` ya hace esto parcialmente (`responseMimeType: 'application/json'`) — hay que generalizarlo y aplicarlo también donde falte (ej. `restaurantAi.js` en pescadería no lo tiene todavía).
- **RF-06 — Fallback determinista ante fallo de la IA:** si la IA no cumple el contrato (JSON inválido, campos inconsistentes) o la llamada falla, el bot NUNCA debe devolver un error crudo ni quedarse en silencio — cae a un mensaje de respaldo fijo y, si corresponde, escala a humano (mismo patrón ya documentado arriba en "Patrón fijo: escalar a humano con criterio de la IA").
- **RF-07 — Reutilizable por negocio vía datos, no código nuevo:** el conjunto de "campos obligatorios del pedido" y las instrucciones específicas del negocio deben poder definirse por configuración (JSON/env) por tenant, para que agregar un negocio nuevo no implique escribir un archivo de flujo de cientos de líneas desde cero.

### Requisitos no funcionales (RNF)

- **RNF-01 — Aislamiento entre tenants:** el motor que resuelve RF-01 a RF-07 vive en un módulo neutral y reutilizable, no en `handlers/handler.js` ni en `handlers/modules/*` tal como están hoy — así un cambio para un negocio no arrastra a los demás (ver regla de arriba: "un bug en archivos compartidos rompe a todos los tenants").
- **RNF-02 — Regresión cero sobre lo que ya funciona:** cualquier cambio a un flujo existente debe pasar los tests de ESE tenant antes de mezclarse (heladería ya tiene ~90 `test_heladeria_*.js`).
- **RNF-03 — El carrito nunca se pierde en sesión:** el estado del pedido en construcción sobrevive preguntas intermedias, mensajes que la IA no entendió, y no se resetea salvo que el cliente cancele explícitamente.
- **RNF-04 — Degradar con gracia, nunca "explotar":** ante cualquier error (parseo, timeout de IA, dato inesperado), el cliente siempre recibe una respuesta útil — nunca un error técnico ni silencio total.
- **RNF-05 — Trazabilidad:** cada turno donde la IA extrae o decide algo queda en el log estructurado (ya existe vía pino/`*-conversations.log`) — sin esto, diagnosticar un fallo real implica adivinar sobre semanas de logs, como pasó hoy.

**Cómo aplicar:** el plan es construirlo primero en un solo negocio (candidato: donde se esté reproduciendo el síntoma con un caso real confirmado), validarlo contra sus tests existentes, y solo después extraerlo a un módulo compartido para que el próximo negocio nazca con esto de fábrica. No migrar todos los tenants de una vez.

### 🤖 Decisión de arquitectura: ¿JSON estructurado o agente con function calling? (24 sep 2026)

Johan preguntó si esto debería ser "un agente" para que el pedido llegue de inicio a fin sin romperse. Aclaración importante: **RF-01 a RF-07 arriba YA son un agente**, en su forma más simple — la IA recibe el mensaje libre, extrae lo que reconoce, y el motor decide qué falta. Hay dos maneras de implementar eso:

1. **Salida JSON estructurada (lo que proponen los RF de arriba):** una sola llamada a la IA por turno, devuelve `{respuesta_usuario, campos_extraidos, falta}`. Rápido (una sola ida y vuelta), ya validado parcialmente en `heladeriaAi.js` (`responseMimeType: 'application/json'`). Suficiente para resolver el síntoma real de hoy: que el pedido no se rompa si el cliente habla desordenado.
2. **Agente con function calling real:** la IA tiene herramientas de verdad (`buscar_producto(nombre)`, `agregar_al_carrito(...)`, `registrar_pedido(...)`) y decide sola cuál llamar, pudiendo encadenar varias en un mismo turno (ej. buscar el precio y luego agregarlo al carrito sin que el backend se lo tenga que servir todo precalculado en el prompt). Es más potente — podría reemplazar buena parte de la lógica manual de desambiguación que hoy vive en `handlers/modules/selection.handler.js` (832 líneas) y `utils/fuzzySearch.js` — pero cada llamada a herramienta implica una ida y vuelta extra con la IA, así que un pedido con 3-4 pasos puede tardar varios segundos en vez de uno.

**Decisión:** empezar por la opción 1 (ya especificada arriba) porque resuelve el problema real de HOY sin el costo de latencia ni la complejidad extra de un loop de herramientas. La opción 2 queda como la evolución natural una vez que la 1 esté probada y estable — ahí sí tiene sentido migrar la búsqueda/desambiguación de productos a herramientas reales de la IA. No saltar directo a la opción 2 sin haber probado la 1 primero — sería repetir el patrón de "arreglarlo todo de una" que ya lleva casi un año sin funcionar.

## 📋 Antes de tocar código compartido

Si modificas `handlers/handler.js`, `config/env.loader.js`, `handlers/flowRegistry.js`, `services/sessionService.js` o cualquier archivo bajo `handlers/modules/`:

1. Corre el smoke test con al menos **dos tenants distintos**:
   ```bash
   node -e "process.env.BUSINESS_KEY='pescaderia'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
   node -e "process.env.BUSINESS_KEY='finance'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
   ```
2. Corre los tests existentes en `bot-wasap/`.
3. Si el cambio toca nombres de funciones/variables entre archivos, grep el nombre en todo el repo antes de asumir que existe.

## 🔧 Checklist para agregar un negocio/bot nuevo

1. Crea `config/businesses/<key>.json` o, si necesita lógica propia, `handlers/flows/<key>.flow.js` con `module.exports.config`.
2. Agrega el tenant a `ecosystem.config.js` con su propio `BUSINESS_KEY`.
3. Si necesita variables propias, créale `.env.<BUSINESS_KEY>` en la raíz del proyecto (tiene prioridad sobre `.env` compartido).
4. Corre el checklist de "Antes de tocar código compartido".

## 📐 Estándares de calidad (política tipo empresa, para portafolio de trabajo)

Johan está buscando trabajo de desarrollador y quiere que sus proyectos se vean y se trabajen como en una empresa real — esta es la rúbrica literal que le exigieron en una prueba técnica de contratación (Trycore), adaptada al alcance real de este repo.

- **Rama + Pull Request real para todo cambio de código**, incluso trabajando solo — nunca commit ni push directo a `main`. Rama descriptiva (`feature/<algo>`, `fix/<algo>`). Commits imperativos y descriptivos (`Add EVM calculation service`, `Fix CPI edge case when AC is zero`); nunca genéricos (`fix`, `cambios`, `wip`).
- **Alcance real en ESTE repo** (no aplicar todo el documento por igual): Gitflow completo con rama `develop`/`release/*` es excesivo para un bot de WhatsApp — con `feature/* → PR → main` alcanza. OpenAPI/Swagger tampoco aplica aquí (no expone una API REST propia) — eso sí aplica en `lion-platform-api`.
- **Cero code smells:** sin bloques de código comentados, sin variables sin usar, sin números/strings "mágicos", nombres descriptivos, lógica de negocio nunca en los controladores/handlers genéricos, responsabilidad única, abstraer lógica repetida más de 2 veces. Ya hay smells conocidos en este repo (`handlers/handler.js.backup`, `handler.js.backup2`) — limpiarlos cuando se toque esa zona, no dejarlos acumular.
- **Pruebas:** cobertura real sobre la lógica de negocio (objetivo 80%), cubriendo casos borde, no solo el camino feliz. Hoy los ~90 `test_*.js` de este repo se corren a mano (`node test_x.js`), sin framework de cobertura — falta meter Jest (o similar) antes de poder medir esto en serio; es un prerrequisito, no un detalle.
- **Excepción explícita:** NO agregar logging tipo `AI_PROCESS.md` (registro verbatim de cada prompt) a este repo — esa práctica era específica para probarle algo al proceso de contratación de Trycore, no aplica a proyectos comerciales propios de Johan.

## 🧠 Patrón fijo: escalar a humano con criterio de la IA, no con lista de palabras

- El JSON que devuelve `askGemini` (`services/bot_core.js`) SIEMPRE incluye `necesitaHumano` (boolean) y `razon` (string o null), en el MISMO objeto que ya devuelve `items`/`respuesta_texto`/`accion` — es texto agregado al mismo prompt, no una llamada nueva a la IA. La razón: usar un LLM para "razonar" en una llamada aparte gastaría el doble de tokens; pedirle el juicio en la misma respuesta que de todos modos ya se está pagando es casi gratis.
- **Prohibido volver a una lista fija de palabras clave** (tipo `FRUSTRATION_KEYWORDS` en `frustrationService.js`) para decidir si un cliente necesita un humano, en cualquier bot NUEVO que se construya sobre esta base. Esa lista existe hoy como capa de respaldo/gratis (filtro previo, cero tokens, para cuando ni siquiera se llegó a llamar a Gemini) — no como el juicio principal.
- Quien llame a `askGemini` DEBE revisar `necesitaHumano` en la respuesta parseada y, si es `true`, llamar a `waitingHumanStore.markWaiting(BUSINESS_KEY, jid, razon)` + notificar al admin (mismo mecanismo que ya usa `frustrationService.js`) — no duplicar esa lógica de notificación en cada bot nuevo.
- **Nota de estado (2026-09-10):** esto aplica al `askGemini` GENÉRICO de `bot_core.js`, que hoy está desconectado del flujo real (`handlers/handler.js` no lo importa ni lo llama — solo queda cableado en `handlers/modules/ai.handler.js` y `services/miaService.js`, ninguno de los dos se ejecuta). **Heladería NO usa ese `askGemini` genérico** — tiene su propia IA en `services/heladeriaAi.js`, llamada desde `handlers/flows/heladeria.flow.js`, que SÍ está viva y que YA escala con criterio real: `interpretOrderText()` detecta una `duda`, `answerDoubt()` la responde, y si `answerDoubt()` sale vacío o `isUnknownAnswer()` detecta que la IA no supo responder, escala con `handleHumanRequest()` — sin lista de keywords. Antes de tocar la IA de un tenant, revisa primero si tiene su propio archivo `<negocio>Ai.js` (heladeriaAi, financeAi, pilatesAi, restaurantAi) — cada uno puede tener su propio patrón de escalación ya construido y probado; no asumas que todos pasan por `bot_core.js`.

## 🐛 Bugs ya corregidos (no los reintroduzcas)

- `handlers/handler.js` bloque de audio/imagen: usaba `sessionService.getOrCreateUserSession(...)` y `flowsRegistry.getCurrentFlow(...)` — ambos incorrectos. Fix: usar funciones locales `initializeUserSession()` y `getCurrentFlow()` + comparar `process.env.BUSINESS_KEY === 'finance'`.
- `finance.flow.js` no trae `businessKey` en `module.exports`. Usa `BUSINESS_KEY` / `envConfig.business.type`.
- PM2 reutiliza el env con que fue creado. Si editas `ecosystem.config.js`: `pm2 delete <app>` → `pm2 start ecosystem.config.js --only <app>` → `pm2 save`.
- `bot-pescaderia` (restaurante Ricuras del Pacífico) mostraba el saludo de mascotas (🐾) y apuntaba a la hoja de mascotas porque no existía `.env.pescaderia` y el backend Django lee el `.env` compartido. Fix: crear `.env.<BUSINESS_KEY>` por tenant (saludo 🐟, nomenclatura plato/complementos/bebidas) y que el backend del tenant cargue SU hoja.
- **`config/businesses/<key>.json` — `business_admin_jids` / `system_admin_jids` / `orders_admin_jids` (incidente 24 sep 2026):** heladería y pescadería quedaron con los 3 roles colapsados en un solo número (todo le llegaba a Johan, Isa dejó de recibir su resumen diario) porque dos sesiones de Claude Code arreglaron el split EN RAMAS DE GIT DISTINTAS el mismo día — una puso los números reales en los JSON, la otra construyó el código que sabe leer `orders_admin_jids` — y ninguna rama se fusionó con la otra ni con `main`. `test_admin_roles_split.js` fija los 3 números reales de cada tenant; si cambias estos campos y el test falla, es porque rompiste el split, no porque el test esté desactualizado. **Antes de tocar estos 3 campos en cualquier `config/businesses/*.json`:** corré `node test_admin_roles_split.js`, y antes de dar por terminada una sesión que tocó estos archivos, corré `git log --all --oneline -- config/businesses/` para confirmar que no hay una rama hermana con el mismo cambio a medio camino sin fusionar.

## 📌 Recordatorio de aislamiento

- Un solo `.env` compartido en la raíz para todos los tenants. Variables globales salvo `.env.<BUSINESS_KEY>` específico.
- `sheet_id` / `api_base` son por-tenant desde `config/businesses/<key>.json`.
- Antes de editar `.env` compartido, pregúntate si debería ser por-tenant.

### 🗂 Cada flujo/negocio maneja un Google Sheet DISTINTO

- CADA tenant/flujo apunta a SU PROPIO Google Sheet (`sheet_id` en `config/businesses/<key>.json`). Los sheets NO se comparten entre negocios.
- El backend (Django `inventario/`) que sirve a un tenant DEBE cargar el env de ESE tenant: `GOOGLE_SHEET_ID`, `SHEET_NAME_PRODUCTS` (hoja de productos) y `SHEET_TAB_DOMICILIOS` (hoja de pedidos). Si el backend lee el `.env` compartido, servirá la hoja de OTRO negocio (ej: bot de restaurante mostrando inventario de mascotas).
- Para un negocio nuevo: crear `.env.<BUSINESS_KEY>` con su `GOOGLE_SHEET_ID` y nombres de hoja, y levantar su propio backend Django con ese env (no reusar el de otro tenant).
- El `business_name` y el saludo/menú del bot se resuelven desde `config/businesses/<key>.json` + `.env.<BUSINESS_KEY>`; si un bot muestra el saludo de otro negocio, es porque está cargando el env compartido sin archivo propio.

## 🖥 Comandos útiles

```bash
# Ver estado de bots
pm2 status

# Logs en tiempo real
pm2 logs bot-finance --lines 50
pm2 logs bot-mascotas-prod --lines 50

# Reiniciar
pm2 restart bot-finance
pm2 restart bot-mascotas-prod

# Guardar estado (después de cambios)
pm2 save

# Verificar auto-start configurado
pm2-startup status
```
