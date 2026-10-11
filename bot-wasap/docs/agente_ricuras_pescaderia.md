# Ricuras del Pacífico (pescadería) — agente de IA y puesta al día con Mundo Helados

Estado al 10 oct 2026. **Preparado, sin encender**: el bot de Ricuras sigue detenido en PM2 y el agente viene apagado
(`PESCADERIA_AI_AGENT`). Nada de esto toca producción hasta que Johan arranque el bot.

## Qué se hizo

| Pieza | Dónde | Qué cambia para Ricuras |
|---|---|---|
| Agente de IA | `handlers/flows/pescaderia.agent.js` (+ `.presenter.js`) | Plugin del núcleo genérico (`handlers/agent/cartAgent.core.js`). Entiende "2 mojarras fritas y una cazuela, lo recojo" sin menús. Las reglas quedan de respaldo. |
| Activación por negocio | `handlers/agent/agentRegistry.js` | Un solo lugar dice qué negocio tiene qué agente; `handler.js` ya no está atado a heladería. |
| Audio y fotos | `pescaderia.flow.js` → `handleMedia` | Igual que Mundo Helados: el audio se transcribe y sigue como texto; de una foto solo importa el **comprobante**, que se reenvía a la dueña (el bot no valida pagos). |
| Avisos a la dueña | `pescaderia.flow.js` → `handOffToHuman` | "Pidió una persona", "datos sensibles" y "fuera de tema" llegan con nombre, número, qué dijo y link al chat (antes: alerta técnica solo a Johan). |
| Seguridad | `escalateIfSensitive` | Tarjeta, cédula o clave pasan a una persona y no se guardan. Mensajes masivos no se responden. |
| Preguntas del cliente | `getInfoCatalog`, `restaurantAi.answerDoubt` | Precio, qué trae un plato, formas de pago: del menú y la configuración reales, sin cifras inventadas. |
| Cliente recurrente | `recurringCustomer` (PR #34) | Funciona igual: "¿lo de siempre?" con su pedido, dirección y pago. |
| Informe de la dueña | `OWNER_REPORT=1` | El mismo informe de las 22:00 (cuando se encienda). |

## Lo que el simulador encontró (y se corrigió)

El simulador de conversaciones ahora corre también Ricuras, con el catálogo real de la hoja (38 platos) cargado por el
cargador REAL del bot. Encontró cosas que ya estaban rotas para Ricuras:

1. **Precios multiplicados por mil.** El backend entrega `"30000.000"`; el menú mostraba **$30.000.000** por un plato de
   $30.000 y el agente habría armado el carrito con ese valor. Ahora `utils/price.js` lee `"30000.000"`, `"30.000"` y
   `"12000"` bien.
2. **"Nequi" no se entendía.** Con Efectivo y Nequi como únicos medios de pago, el cliente que contestaba "nequi" recibía
   "No entendí". Ahora Nequi, Daviplata, Bancolombia, PSE y QR son transferencia.
3. **El nombre del cliente se leía como un pedido.** Al darlo, recibía la bienvenida y enseguida "No entendí bien lo que
   necesitas".
4. **Dos unidades eran dos líneas** ("1x Mojarra Frita" dos veces) en el resumen y en el aviso a la dueña.
5. **El perfil de "lo de siempre" no se guardaba** con el carrito de reglas (solo con el de heladería).
6. **Textos de heladería en un restaurante**: un helado (🍨) en "Seguir comprando" y el ejemplo "Empanada de pollo".
7. **La base de pedidos** (`data/pescaderia.db`) no se podía aislar en pruebas; ahora acepta `RESTAURANT_STORE_PATH`.

## Cómo encenderlo (cuando Johan lo decida)

1. Integrar este PR (y el #34 de clientes recurrentes) a `develop`.
2. En `.env.pescaderia`: `PESCADERIA_AI_AGENT=1` (y `OWNER_REPORT=1` si se quiere el informe de las 22:00).
3. Arrancar con el ecosystem para que el servidor de estado quede en su puerto y con su token:
   `npx pm2 startOrReload ecosystem.config.js --only bot-pescaderia --update-env`.
4. Primero con el número de Johan solamente: `PESCADERIA_AI_AGENT_JIDS=<número>`.

Apagarlo: `PESCADERIA_AI_AGENT=0` (o quitar la línea) y reiniciar; vuelve al flujo de reglas de siempre.

## Pendiente de decisión del dueño de Ricuras

- **Datos de pago**: la hoja "Configuración" solo tiene un campo ("Teléfono"). Sin `Cuenta Nequi/Daviplata` el bot no
  inventa una cuenta: avisa a la dueña con el motivo y ella la envía. Cargarlos evita ese paso.
- **Horario y dirección**: no están en las preguntas frecuentes; el bot usa el horario por defecto (09:00–20:00 entre
  semana, 10:00–21:00 fines de semana). Hay que confirmarlo y cargar la dirección real.
- **`NumeroEntrada`** (Pargo Rojo = 1): la hoja marca que ese plato pide un complemento, pero el cargador del bot hoy no
  copia esa columna y por eso nunca lo pregunta. El agente ya sabe preguntarlo ("¿con qué complemento lo quieres?");
  falta que el dueño confirme que quiere ese paso para activarlo (una línea en `services/bot_core.js`).
- **Preguntas frecuentes**: no hay ninguna cargada. Con 5 o 6 (domicilio, tiempos, si traen sopa) el bot responde sin
  escalar.
- **Valor del domicilio**: hoy "Por confirmar" (lo cotiza una persona). Si es fijo, se configura.

## Pruebas

```bash
cd bot-wasap
node tests_sim/run.js --tenant=pescaderia --ai=sim     # reglas con IA simulada
node tests_sim/run.js --tenant=pescaderia --ai=off     # el "piso" del bot, sin IA
node tests_sim/run-agent.js --tenant=pescaderia        # agente (decisor simulado)
node test_simuladores_de_conversacion.js               # los seis, como en la CI
node test_precio_y_pago_de_restaurante.js              # precio, Nequi e ítems iguales
```

Todo con IA **simulada** (cero tokens). El comportamiento con Gemini real solo se ve probando en vivo.
