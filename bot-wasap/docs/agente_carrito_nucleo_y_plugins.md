# Agente de IA para negocios con carrito: núcleo genérico + plugin por tenant

Estado al 30 sep 2026. Piloto: heladería (Mundo Helados), **apagado por defecto**
(`HELADERIA_AI_AGENT`). Contexto del piloto: `docs/brief_agente_heladeria_29sep2026.md`.

## Dónde vive cada cosa

| Capa | Archivo | Qué tiene |
|---|---|---|
| Cliente de IA | `services/cartAgentAi.js` | Una llamada a Gemini por turno con function calling obligatorio, temperatura 0, timeout y 1 reintento. No sabe nada del negocio. (`services/heladeriaAgentAi.js` es un alias del mismo objeto.) |
| Grounding | `handlers/agent/grounding.js` | Funciones puras: resolver nombres contra el catálogo, cantidad dicha por el cliente, confirmación explícita, datos del cliente escritos por él, cifras de respuestas libres contra la fuente de verdad. |
| Núcleo | `handlers/agent/cartAgent.core.js` | Bucle del turno, activación por flag/canario, 20 herramientas genéricas, candados por efecto, escalamiento a humano, cierre del turno. |
| Plugin heladería | `handlers/flows/heladeria.agent.js` | 9 herramientas propias (sabores, toppings, unidades, encargo), motor de casillas, grounding de su dominio, prompt y estado. |

## Qué hereda gratis un negocio nuevo (núcleo)

- **Nunca rompe producción:** con el flag apagado `handler.js` ni carga el módulo; si la IA no
  responde, `processMessage` devuelve `false` sin tocar nada y responde el flujo de reglas del tenant.
- **Datos sensibles y spam** se filtran antes de que el texto llegue a la IA.
- **Candados por efecto** (falla cerrado): toda herramienta declara `effects`; si toca `money`,
  `customer_data` u `order_final` debe traer `ground(args, T)` o el agente no arranca.
- **Datos del cliente:** nombre, teléfono, dirección y método de pago solo se guardan si salen de
  lo que el cliente escribió.
- **Plata:** el precio de lo que entra al carrito se recalcula desde el catálogo por código.
- **Enviar el pedido:** solo con el resumen final ya en pantalla y confirmación explícita.
- **Respuestas libres sin cifras inventadas:** cada número (litros, porciones, tiempos, precios)
  tiene que existir en el catálogo/FAQs del tenant.
- **Escalamiento:** `notifyAdminsAboutCustomerIssue` (link wa.me), `WAITING_HUMAN`, registro para el
  panel; 4 aclaraciones seguidas también escalan.
- **El cliente nunca queda sin respuesta** (cierre del turno).
- **Input determinista:** el `userContent` es función solo del pedido, el historial y el mensaje
  (sin reloj). Ver `test_cart_agent_determinismo.js`.

## Cómo se arma el plugin del próximo negocio

`core.createCartAgent(plugin)` con (ver el JSDoc de `createCartAgent` para el detalle):

1. **Activación:** `{ businessKey, flagEnv, jidsEnv }`, ej. `RESTAURANTE_AI_AGENT`.
2. **Catálogo:** `products`, `orderable`, `priceable`, `clarifiable` (qué listas del catálogo aplican).
3. **Fases:** `agentPhases`, `repeatAllowedPhases`, `postAddPhase`, `isBuildingPhase`, `fastPathApplies`.
4. **Prompt:** `buildSystemInstruction(ctx)` (reglas del rubro + catálogo) y `describeState(session)`
   (usar `core.describeDelivery` y `core.describePendingOptions`; **nada de reloj ni aleatoriedad**).
5. **Herramientas propias:** `[{ declaration, exec, order, effects, ground }]`. Un negocio de
   productos simples puede empezar solo con `agregar_producto`; uno con opciones (tamaño, término,
   adiciones) agrega las suyas.
6. **Hooks** (16 obligatorios + `answerSources` opcional) y **textos** (8): lo que el núcleo necesita saber del flujo guiado del tenant
   (hay ítem en armado, cómo re-mostrar su paso, cómo agregar un ítem simple...).
7. Tests: copiar `test_cart_agent_core_generico.js` (plugin de prueba mínimo) como punto de partida.

## Pendiente de decisión de Johan

- **Temperatura de las otras llamadas del turno:** `heladeriaAi.isAutomatedBroadcast` (decide si
  el bot responde) y `answerDoubt` corren con la temperatura por defecto de la API, no 0. No se
  tocó porque también las usa el flujo de reglas en producción. Candidato fuerte a la inconsistencia
  restante; medir con el replay antes de cambiarlo.
- **`answerDoubt` pide "variar el lenguaje":** su texto vuelve al historial y cambia el input del
  turno siguiente. Si se quiere replay reproducible, habría que fijar su temperatura o no pasarlo
  al historial del agente.
- **Sesión en memoria:** el estado del agente vive en la sesión del usuario (igual que el flujo de
  reglas). Si en el futuro se persisten sesiones, los campos `_agent*` deben persistirse con ella.
