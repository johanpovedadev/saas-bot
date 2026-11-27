# Recepcionista v2 — un bot para cualquier negocio, con una ficha

**Fecha:** 27 nov 2026 · **Pedido de Johan:** "la versión 2 estilo Meta, más fácil para un negocio nuevo".

## En fácil

Antes, cada negocio necesitaba su propio programa: la heladería tiene ~1.500 líneas solo para ella. La Recepcionista v2
es **una sola recepcionista para todos**: llega a un negocio, lee su **ficha** (qué vende y a qué precio, horario,
domicilios, pagos, preguntas frecuentes, tono) y atiende el WhatsApp. Responde, anota encargos y le avisa al dueño para
que él cierre. No tiene carrito ni pasos fijos: no hay formulario donde trabarse.

**Negocio nuevo = ficha nueva.** Sale de una foto de la lista de precios. Sin escribir código.

## Los candados

| Candado | Qué hace |
|---|---|
| Datos solo de la ficha | Si la IA escribe un precio que no está en la ficha, se descarta y se pide otra respuesta. |
| No sabe → no inventa | "Déjeme confirmarlo con el negocio", y al dueño le llega la pregunta para agregarla a la ficha. |
| Paso al dueño | Si el cliente lo pide, se nota molesto, o **no se le pudo resolver 2 veces seguidas**. |
| Encargo | Con productos + nombre + forma de entrega, avisa al dueño con el valor según la ficha. El dueño confirma; al cliente no se le promete total. |
| IA caída | El cliente recibe "en un momento le responden" y el dueño un aviso. Nunca queda sin respuesta. |
| Dueño atendiendo | Mientras el dueño tiene la conversación, la recepcionista no se mete. |

## Cómo se monta un negocio

1. `config/fichas/<negocio>.json` — copiar `ejemplo-panaderia.json` y cambiar los datos.
2. `config/businesses/<negocio>.json` — con `"flow_module": "recepcionista.flow.js"` y los números del dueño (ver `demo-recepcionista.json`).
3. En su `.env`: `BUSINESS_KEY=<negocio>` y `RECEPCIONISTA_AI_AGENT=1`.

Si la ficha se edita, se relee sola (no hay que reiniciar).

## Términos (para aprender)

| Término | Qué es | Truco para recordarlo |
|---|---|---|
| **Agente** | Una IA que *decide* qué hacer (responder, anotar, pasar al dueño), no solo que contesta | *agente* = el que *actúa* |
| **Base de conocimiento** (*knowledge base*) | La ficha que la IA lee para responder | la "biblioteca" del bot |
| **Configuración en vez de código** | Cambiar cómo funciona algo llenando datos, sin programar | llenar un formulario, no construir la casa |
| **JSON** | Formato de datos con llaves y valores: `{"precio": 2500}` | un formulario con casillas |
| **Prompt** | Las instrucciones que se le dan a la IA | el "brief" de la recepcionista |
| **Grounding** | Anclar lo que dice la IA a datos verdaderos (la ficha) | *ground* = tierra: con los pies en la tierra |
| **Plugin** | Pieza que se "enchufa" para agregar algo (lo que usan heladería y pescadería) | *plug* = enchufe |
| **Multi-tenant** | Un sistema atendiendo muchos negocios, cada uno con lo suyo | *tenant* = inquilino |

## Archivos

- `handlers/flows/recepcionista.agent.js` — la recepcionista.
- `handlers/flows/recepcionista.flow.js` — la puerta (audios y fotos transcritos entran por aquí).
- `services/businessCard.js` — lee, valida y describe la ficha.
- `handlers/agent/agentRegistry.js` — `RECEPCIONISTA_AI_AGENT=1` la enciende en cualquier negocio.
- `test_recepcionista_v2.js` — 35 pruebas con IA simulada.
