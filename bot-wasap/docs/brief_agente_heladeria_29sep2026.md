# Brief: Agente de IA con herramientas para Mundo Helados (heladería)

Contexto para continuar este trabajo en otra sesión de Claude (incluida una en la nube).
Repo: `C:\Users\Administrador\Documents\empanadas\bot-wasap` (multitenant, WhatsApp, Node.js).
Tenant piloto: **heladería** (Mundo Helados, PM2 `bot-heladeria`), negocio real con clientes reales.

## Decisión de arquitectura (29 sep 2026)

El flujo de reglas escritas a mano (`handlers/flows/heladeria.flow.js`, cascada de clasificación
`classifyOrderInput`) venía fallando en lenguaje natural una vez por semana, siempre con el mismo
patrón: una frase humana perfectamente razonable que nadie anticipó al escribir la regla. Decisión:
reemplazar SOLO la capa de comprensión del cliente por un agente de IA con function calling, dejando
intacta toda la lógica de negocio ya probada (precios, carrito, checkout, Django/Sheets).

**No es "reescribir desde cero"** — es dar vuelta quién decide qué función llamar. El código de
negocio (`handleSabores`, `handleToppings`, `handleQuantity`, `handleUnitsMode`,
`tryRemoveOrderAddition`, `handleCartSummary`, `handleFinalizeOrder`, `answerDoubt`...) sigue siendo
el mismo, la IA solo elige cuál invocar.

## Qué existe hoy (construido, apagado por defecto, sin tocar producción)

- `services/heladeriaAgentAi.js` — llamada a Gemini (`gemini-3.1-flash-lite`, misma cuenta/API key de
  producción) con function calling obligatorio, timeout 15s + 1 reintento.
- `handlers/flows/heladeria.agent.js` — el agente, 29 herramientas (agregar_producto,
  elegir_sabores, elegir_toppings, quitar_topping, fijar_cantidad, ir_a_pagar, confirmar_pedido,
  fijar_direccion, escalar_a_humano, preguntar_aclaracion, etc.) que llaman al código YA EXISTENTE.
- Activación: flag `HELADERIA_AI_AGENT=1` (+ opcional `HELADERIA_AI_AGENT_JIDS=<numeros>` para
  limitarlo a números específicos mientras el resto sigue por reglas). **Hoy ninguna de las dos
  variables está definida en ningún `.env` ni en PM2** — el bot corre 100% por reglas.
- `handlers/handler.js`: +15 líneas, solo el gate del flag (si está apagado, ni siquiera carga el
  módulo del agente).
- Pruebas: `test_heladeria_agent_herramientas.js` (IA simulada, 36 checks, en CI),
  `test_heladeria_agent_casos_reales_ia.js` (IA real, fuera de CI).
- Arnés de replay: `scripts/heladeria-agent/{extract-corpus,replay,analyze}.js` — corre conversaciones
  reales del log contra ambos flujos y compara turno por turno.
- **No hay commit hecho todavía** — todo el trabajo de hoy vive sin comprometer en el working tree.

## Resultado de validar contra 74 conversaciones reales (584 mensajes, log real)

| Métrica | Reglas | Agente |
|---|---|---|
| "No entendí" | 58 | 8 |
| Escalados a humano | 17 | 6 |
| Llegan al resumen final | 3 | 7 |
| Pedidos confirmados | 2 | 6 |

De 58 conversaciones donde el resultado difiere: **31 mejor, 26 neutro, 1 peor** (un filtro de
spam del agente silenció un mensaje largo que las reglas sí escalaban).

Los 4 bugs reales corregidos hoy en el flujo de reglas (commits `86a6938`, `daea266`, `1882c00`,
`e8aabb0`, `b82bebb`, `8d1bf19`): el agente los resuelve 19/19 de forma estable en 5 corridas; las
reglas, 14/19. Además el agente resuelve solo-él: "Si" respondiendo la pregunta del propio bot,
"el otro" con 3 candidatos, "¿a cómo el cono?", un reclamo real que debía escalar.

**Fallas reales encontradas en el agente (no resueltas aún):**
1. Inconsistencia — el mismo mensaje no siempre produce la misma decisión entre corridas.
2. `answerDoubt` a veces inventa datos de producto (dijo que una caja de $50.000 era de 5 litros, y
   otra vez de 10 litros) — hay que forzar que esa herramienta solo devuelva datos reales del
   catálogo/API, nunca texto libre generado.
3. Huecos de cobertura: no puede editar cantidad/toppings de un ítem ya en el carrito; encargo,
   audio e imágenes siguen 100% por reglas.

## Costo/latencia medidos

70% de los turnos usan IA (vs 37% hoy), ~2.5x más tokens de entrada. Por turno de IA, el agente es
más rápido (p50 0.69s vs 1.2s de las reglas, que a veces encadenan 2 llamadas). Por turno total
(incluyendo los que no usan IA), 17ms (reglas) vs 640ms (agente).

## 2 bugs reales encontrados en el flujo de REGLAS actual (independiente del agente, urgente)

1. **"Todos de chocolate" / "Todos iguales" en el paso de toppings agrega los ~21 toppings del
   catálogo completo** en vez de interpretar la frase correctamente. En el replay dio $44.000 en vez
   de $13.000, y $84.000 en vez de $22.000 — cobro real de más a clientes reales. **Pendiente de
   corregir, no depende de la decisión sobre el agente.**
2. El sub-flujo de "encargo" puede repetir el mismo mensaje hasta 14 veces sin escalar a humano.

## Siguiente paso recomendado (antes de pilotear con clientes reales)

1. Corregir los 2 bugs de reglas de arriba (independiente del agente).
2. Sobre el prototipo del agente: (a) candados deterministas más estrictos alrededor de CUALQUIER
   acción que toque plata o datos del cliente — no solo los ya cubiertos; (b) forzar `answerDoubt`
   a solo citar datos reales del catálogo, nunca inventar; (c) bajar la temperatura de la llamada a
   Gemini para reducir la inconsistencia entre corridas.
3. Pilotear el agente solo con el número de Johan (`HELADERIA_AI_AGENT_JIDS`) 1-2 semanas antes de
   abrirlo a clientes reales.

## Sobre multitenant (pregunta abierta de Johan)

La arquitectura y las utilidades genéricas ya construidas (`utils/fuzzySearch.js`, el patrón de
"capabilities universales" en `handlers/handler.js`) sí son reusables por cualquier negocio nuevo con
carrito. Lo que SÍ hay que rehacer por negocio: el catálogo de herramientas específico de su flujo
(un restaurante no tiene sabores/toppings/unidades como heladería) y sus propios candados de
negocio. Es mucho menos esfuerzo que construir desde cero, pero no es instantáneo — el ahorro real
depende de seguir sacando a lo genérico todo lo que aplique a cualquier negocio con carrito, cada vez
que se construya el agente de un tenant nuevo.

## Pendiente de decisión de Johan (no tocar sin su confirmación)

- `config/businesses/heladeria.json`: `system_admin_jids` está vacío a propósito (nota en el propio
  archivo) porque Johan está probando el bot como cliente real y no quiere recibir sus propias
  alertas técnicas. Restaurar a `["573138777115@c.us"]` solo cuando él lo pida explícitamente (ya
  se intentó una vez hoy y se revirtió a pedido suyo — dejarlo vacío por ahora).
