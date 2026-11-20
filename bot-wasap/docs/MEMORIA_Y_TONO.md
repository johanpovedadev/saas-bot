# Tono, memoria y paso a la dueña (bots con agente de IA)

Desde el 20 nov 2026. Origen: la IA de Meta en Service Store VIP "se adapta a cómo le hablan" y con Isa (Mundo Helados)
sonaba como si la conociera, porque aprende del historial del chat. Esto lo hace igual, sin guardar conversaciones.

| Pieza | Archivo | Qué hace | Costo |
|---|---|---|---|
| Tono | `services/conversationStyle.js` | Detecta afán / formal / en confianza / normal (sin IA) y ajusta cortesía y trato. En confianza devuelve el saludo del cliente ("Holiiii" → "¡Holiiii! 😋"). Nunca toca precios ni datos | 0 |
| Una pregunta | `cartAgent.core` → `responder_breve` | Los textos libres de la IA llevan UNA sola pregunta | 0 |
| Ficha del cliente | `services/customerMemory.js` (`customer_memory`) | Cuántas veces escribió, última vez, cómo habla, cómo terminó la última conversación + lo que pidió (perfil). La IA la lee como "CLIENTE:". **No guarda mensajes** | ~200 B por cliente, 1 lectura SQLite |
| Cómo responde la dueña | `services/customerMemory.js` (`owner_examples`) | Lo que la dueña escribe a mano en un chat escalado o silenciado (`index.js`, `message_create`). Sin números ni datos sensibles; máx. 15; la IA ve 4 | ~3 KB por negocio |
| Paso a la dueña | `services/escalationPolicy.js` | Solo si el cliente la pide o se nota frustrado / a punto de irse. Lo demás: el bot sigue y la pregunta va al informe | 0 |

- Se registra **después** de responder: no demora la respuesta.
- "Borra mis datos" borra perfil, historial y ficha.
- Un negocio apaga cada pieza en su plugin: `styleAdaptation: false`, `customerMemory: false`, `escalationPolicy: false`.
- Bots de reglas (sin agente): siguen escalando al 2.º error seguido. Con agente: la IA decide y 4 errores seguidos quedan como red de seguridad.
- Datos sensibles (tarjeta, clave) escalan siempre: es seguridad.

Pruebas (IA simulada): `test_conversacion_estilo.js`, `test_memoria_y_escalamiento.js`.
