# Red de seguridad de la conversación y revisión diaria

**Regla del proyecto (Johan, 14–17 oct 2026):** el objetivo del bot es cerrar el pedido, y ningún chat con un pedido abierto se puede perder en silencio. Si el bot falla, el cliente tiene que terminar atendido por una persona.

Origen: Mundo Helados perdió cerca de 5 clientes. El último fue una Banana Split x2 el 12 de octubre: el bot repetía la pregunta de toppings y nadie se enteró. Al final la dueña apagó el bot.

## Qué hace

| Situación | Qué pasa | ¿El bot sigue contestando? |
|---|---|---|
| El bot repite **la misma pregunta** en 2 turnos seguidos, el cliente estaba **respondiendo** (no preguntando) y el pedido no avanzó | Agrega: "💡 mándame un *audio* o escribe *persona*" | Sí |
| Lo mismo por **3ª vez** | El chat pasa a una persona (`WAITING_HUMAN`) y le llega a Isa "🙋 El bot se enredó…", con la pregunta que repetía | No (hasta "reactivar mia") |
| **4 mensajes** con pedido abierto sin avanzar (p. ej. el cliente pregunta muchas cosas) | Aviso a Isa "👀 Un cliente no avanza" (una sola vez) | Sí |
| El cliente deja de contestar **3 min** | El bot le escribe "👋 ¿Seguimos con tu pedido?" + la pregunta que tenía pendiente | Sí |
| **5 min** sin contestar | Aviso a Isa "⏰ Un cliente no terminó su pedido": qué lleva, en qué paso iba y link al chat. Fuera del horario no se le escribe (queda en la revisión) | Sí |
| El bot se **reinicia** con un pedido a medias | A los 5 min, aviso a Isa: "el bot se reinició… escríbele" | — |
| Solo preguntó el precio ("¿Quieres pedir X? Sí/No") y no contestó | Recibe el seguimiento de los 3 min; a Isa **no** se le avisa (es una consulta) | Sí |

"Pedido abierto" significa que hay productos en el carrito, un producto a medio armar, productos en cola o una oferta de precio pendiente. Los chats de admins, los silenciados y los que ya atiende una persona nunca entran.

## Configuración (por negocio, en `.env.<negocio>`)

```
SAFETY_NET=1                     # enciende la red (apagada por defecto: los demás negocios no cambian)
SAFETY_NET_JIDS=573138777115     # canario: solo ese número (vacío = todos los clientes)
# Opcionales:
# SAFETY_NUDGE_MS=180000         # 3 min
# SAFETY_ALERT_MS=300000         # 5 min
# SAFETY_NO_PROGRESS_TURNS=4
```

Quién recibe los avisos: `safety_net_admin_jids` en `config/businesses/<negocio>.json`. En heladería es **Isa** (573136939663). Si un negocio no lo configura, los avisos van a `business_admin_jids` (la dueña), nunca al admin de sistema.

## Revisión diaria (para Johan, apagada por ahora)

Por pedido de Johan (17 oct 2026), por ahora **no le llega nada de Mundo Helados**. La revisión queda lista, pero solo arranca con `DAILY_REVIEW=1`:

```
DAILY_REVIEW=1
DAILY_REVIEW_HOUR=21                   # hora de Bogotá
HERMES_BOT_TOKEN=...                   # bot de Telegram (Jarvis León)
DAILY_REVIEW_TELEGRAM_CHAT_ID=...      # por defecto ADMIN_TELEGRAM_ID
```

A mano, sin enviar: `node scripts/daily-review.js heladeria`. Para mandarla: agregar `--send`.

Contenido de la revisión:
- chats, pedidos, total y porcentaje de cierre;
- el embudo del seguimiento (cuántos volvieron y cuántos pedidos se salvaron);
- los avisos enviados, los bucles y los bloqueos del código a la IA;
- las ofertas de precio aceptadas y rechazadas;
- la lista de chats para revisar, del caso más grave al menos grave, con su link.

No guarda lo que escribieron los clientes (ADR-014).

## Archivos

- `services/safetyNet.js`: detectores, seguimiento y reloj.
- `services/followUpStore.js`: chats esperando respuesta, guardados en disco para que sobrevivan un reinicio.
- `services/safetyEventsStore.js`: eventos para la revisión (7 días, por negocio).
- `services/dailyReview.js` y `scripts/daily-review.js`: la revisión diaria.
- Enganche: `handlers/handler.js#processIncomingMessage` (antes y después de cada mensaje) e `index.js` (arranque del reloj).
- Pruebas: `test_red_seguridad.js` (unitarias, integración por el handler real, bordes, reloj real y quién recibe los avisos).

## Cómo probarlo en el número de siempre

1. En `.env.heladeria`: `SAFETY_NET=1` y `SAFETY_NET_JIDS=573138777115`. Luego `pm2 restart bot-heladeria`.
2. Desde ese número, pide un producto y no contestes. A los 3 min te llega "¿Seguimos con tu pedido?". A los 5 min, a Isa le llega "⏰ Un cliente no terminó su pedido".
3. Contesta con algo que el bot no tome ("ummm", "pues") dos veces. La primera vez te ofrece audio o persona; la segunda pasa a una persona y le avisa a Isa. Para que el bot retome: Isa escribe "reactivar mia 573138777115" (Johan no es admin de heladería).
4. Para abrirlo a todos los clientes, borra `SAFETY_NET_JIDS`.
