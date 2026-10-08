Trabajas en el repo `bot-wasap` (multitenant, WhatsApp, Node.js) de Johan, dentro del negocio
**heladería** (Mundo Helados, real, clientes reales comprando ahora). Antes de hacer nada, lee
completo `docs/brief_agente_heladeria_29sep2026.md` en este mismo repo — tiene el contexto de lo
construido y validado el 29 sep 2026: un agente de IA con function calling que reemplaza la capa de
comprensión del cliente en heladería, construido como código paralelo y APAGADO por defecto (flag
`HELADERIA_AI_AGENT`), validado contra 74 conversaciones reales con resultados claramente mejores
que el flujo de reglas actual, pero con fallas reales identificadas.

**Actualización sobre ese brief (30 sep 2026, validación de arquitectura hecha después):** Johan
pidió explícitamente que el esqueleto del agente sirva para CUALQUIER negocio con carrito, no solo
heladería. Se revisó el código real y el veredicto fue: **quedó a medias, no genérico todavía.**
`services/heladeriaAgentAi.js` (el cliente que llama a Gemini con function calling) SÍ es 100%
genérico — recibe `{systemInstruction, tools, userContent}` como parámetros, no conoce el dominio.
Pero `handlers/flows/heladeria.agent.js` (1.766 líneas, el 95% del trabajo real: grounding,
confirmación, escalamiento, el bucle del turno) está construido con funciones que conocen el dominio
de heladería por dentro (`groundSabores`, `groundToppings`, `saborIsGrounded`, `toppingIsGrounded`,
`modoIsGrounded`, `slotsOf(heladoFlow)`) — no sirve para un restaurante o panadería sin reescribirlo.

No reinventes lo que ya está construido — tu trabajo es **extraerlo en dos capas y luego
endurecerlo**, no rehacerlo desde cero.

## Tu tarea, en este orden

### 1. Primero, corrige los 2 bugs reales del flujo de REGLAS actual (urgente, independiente de todo lo demás)

Afectan a clientes reales HOY:

- **"Todos de chocolate" / "Todos iguales" en el paso de toppings agrega los ~21 toppings del
  catálogo completo** en vez de interpretar la frase correctamente (debería significar "el mismo
  sabor/topping para todas las unidades", no "todos los toppings que existen"). Confirmado con
  cifras reales en el replay de hoy ($44.000 cobrado en vez de $13.000, $84.000 en vez de $22.000).
  Está en `handlers/flows/heladeria.flow.js`, en el manejo de toppings/personalización por unidad.
- El sub-flujo de "encargo" puede repetir el mismo mensaje hasta 14 veces sin escalar a humano —
  revisa el conteo de `errorCount` dentro de ese sub-flujo, probablemente no lo está subiendo.

Basa el fix en evidencia real de `logs/heladeria-conversations.log` (no inventes el caso), escribe
un test siguiendo la convención `test_heladeria_<algo>.js` ya usada (`check(cond, msg)`, ✅/❌, cita
el mensaje real en el comentario), corre la suite completa (`node scripts/run-tests.js`) antes de
comprometer. Gitflow normal en `feature/whatsapp-cloud-api-calendar-reviews` (PR #25), commits
separados y descriptivos, terminando cada mensaje con:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

### 2. Extrae el núcleo genérico del agente (esqueleto multitenant) — ESTA ES LA TAREA CENTRAL

Separa `handlers/flows/heladeria.agent.js` en dos capas:

**(a) Núcleo genérico** (nuevo, ej. `handlers/modules/cartAgent.core.js` o donde tenga más sentido
según lo que encuentres al leer el archivo completo) — todo lo que NO depende del dominio de
heladería: el bucle del turno (llamar a `heladeriaAgentAi.decideTurn` — que ya es genérico, renómbralo
si aplica a algo menos atado a "heladeria"), el patrón de "grounding" (validar cualquier argumento de
una herramienta contra datos reales del catálogo/carrito ANTES de ejecutar, nunca confiar en texto
libre de la IA), la exigencia de confirmación explícita antes de cerrar un pedido, el escalamiento a
humano con link al chat (ya existe en `notifyAdminsAboutCustomerIssue`, reúsalo), y el manejo de
"no se pudo decidir → cae a las reglas de ese tenant" (nunca dejar al cliente sin respuesta).

**(b) Plugin específico de heladería** (lo que queda de `heladeria.agent.js` después de sacar lo de
arriba) — solo sus herramientas propias (las 29 de hoy) y el mapeo de sus conceptos de dominio a los
conceptos genéricos del núcleo (ej. "sabor" = variante, "topping" = modificador, si el núcleo define
esos conceptos genéricos; usa el criterio que tenga más sentido al ver el código real, no fuerces una
nomenclatura si no calza).

El criterio para decidir qué va en cada capa: si una función funcionaría igual de bien para un
restaurante o una panadería sin cambiar una línea, va al núcleo. Si necesita saber qué es un "sabor"
o un "topping", va al plugin.

### 3. Ahora sí, endurece — pero DENTRO del núcleo genérico, no en el plugin de heladería

Esto es importante: si el blindaje queda en el núcleo, cualquier negocio nuevo lo hereda gratis. Si
queda en el plugin de heladería, hay que repetirlo por cada negocio nuevo - evita eso.

1. **Candados deterministas amplios, en el núcleo**: CUALQUIER herramienta que toque plata, datos del
   cliente, o el estado final del pedido debe validar contra datos reales antes de ejecutar, por
   defecto para cualquier tenant - no caso por caso según lo que se probó hoy con heladería.
2. **La herramienta de "responder pregunta" (equivalente a `answerDoubt`) no debe poder inventar
   datos.** Evidencia real: a veces inventó volúmenes de producto que no existen en el catálogo (dijo
   que una caja de $50.000 era de 5 litros, otra vez de 10). Esto también debería vivir como una regla
   del núcleo (fuente de verdad = catálogo real de CUALQUIER tenant, nunca texto libre de la IA), no
   solo parcheado para heladería.
3. **Sobre la inconsistencia (mismo mensaje, decisión distinta entre corridas): NO es un problema de
   temperatura — ya está en 0** en `services/heladeriaAgentAi.js`
   (`generationConfig: { temperature: 0 }`, línea ~69). Investiga la causa real antes de tocar nada:
   candidatos probables son variación en el orden/contenido de `describeHistory`/`describeState`
   entre corridas, no-determinismo del lado de la API de Gemini incluso en temp=0 (documentado que
   puede pasar), o algún timestamp/dato no determinista colándose en el `userContent` que cambia el
   input real de un run a otro aunque el mensaje del cliente sea el mismo. Diagnostica con evidencia
   (compara el `userContent` exacto enviado a la IA entre dos corridas del mismo caso) antes de
   proponer un fix.

### 4. Vuelve a correr el arnés de replay (`scripts/heladeria-agent/`) contra el mismo corpus de hoy

Corre el replay completo (74 sesiones / 584 mensajes reales) con el agente YA reestructurado en
núcleo + plugin, y compara contra los números de hoy (tabla completa en el brief). El plugin de
heladería debe seguir comportándose igual o mejor que hoy — la extracción no puede ser una
regresión. Reporta la comparación métrica por métrica.

## Límites explícitos (igual que siempre)

- El bot en producción (`bot-heladeria`, PM2) sigue corriendo exactamente igual que hoy - el flag
  `HELADERIA_AI_AGENT` sigue apagado por defecto.
- No toques `config/businesses/*.json` - `heladeria.json` tiene `system_admin_jids` vacío A
  PROPÓSITO ahora mismo (nota dentro del propio archivo, Johan probando como cliente real); no lo
  cambies aunque `test_admin_roles_split.js` falle por eso, es esperado.
- No toques la tabla `prospects` del CRM ni nada de outreach.
- No toques otros negocios (pescadería, mascotas, pilates...) salvo que sea código realmente
  genérico que no cambie su comportamiento actual (pruébalo si tocas algo compartido).
- No construyas todavía el plugin de un SEGUNDO negocio (restaurante, panadería...) - eso es el
  paso después de este, una vez el núcleo esté probado con heladería. Solo deja el núcleo
  genuinamente listo para que ese siguiente plugin sea rápido de escribir.
- Si algo es ambiguo (decisión de producto/arquitectura, no un bug objetivo), no lo adivines -
  documéntalo en tu reporte final para que Johan decida.

## Al terminar

Repórtale a Johan (esto es lo único que se lee): qué corregiste de los 2 bugs de reglas (con
evidencia real citada), cómo quedó dividido el código (qué archivos, qué vive en el núcleo genérico
vs el plugin de heladería, con una lista clara de funciones en cada lado), qué endureciste y por qué
esa regla generaliza a cualquier tenant, qué encontraste sobre la causa real de la inconsistencia
(no asumas que era la temperatura), el resultado del replay comparado con los números de hoy, los
commits hechos (hash + mensaje), y tu opinión honesta de ingeniero sobre qué tan listo queda el
núcleo para que el PRÓXIMO negocio (no heladería) construya su plugin rápido sobre él. Si dejaste
algo pendiente por ambigüedad, dilo explícitamente.
