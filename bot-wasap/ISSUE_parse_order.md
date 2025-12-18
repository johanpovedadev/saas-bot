# Implementar parser determinista para pedidos tipo "3 cajas de helado vainilla sin toppings"

**Descripción**

Añadir un parser rule‑based que convierta mensajes simples y estructurados en un objeto de pedido (cantidad, unidad, producto, rubro/tienda, toppings/exclusiones). Evitar uso de IA para estos casos y usar IA solo como fallback para frases ambiguas o complejas.

**Ejemplo de entrada**

> "Necesito 3 cajas de helado vainilla, sin toppings"

**Resultado esperado (JSON)**

```json
{
  "quantity": 3,
  "unit": "caja",
  "product_name": "vainilla",
  "product_type": "helado",
  "toppings": [],
  "notes": ""
}
```

## Criterios de aceptación

- Extrae cantidad y unidad (caja/cajas/docena/unidad/kg) correctamente en >90% de casos simples.
- Detecta negaciones/exclusiones ("sin", "no", "sin toppings") y devuelve `toppings: []`.
- Mapea `product_name` al catálogo de la `SHOP_ID` activa; si hay ambigüedad, solicita confirmación.
- No invoca IA cuando parser tiene match confiable (regla configurable por umbral de confianza).
- `addToCart()` acepta el objeto generado y crea el ítem en el carrito.
- Tests unitarios y E2E pasan (ver tests existentes).

## Alcance técnico (resumen)

- Normalizar texto (lowercase, quitar puntuación, normalizar acentos).
- Regex para cantidad/unidad: p. ej. `([0-9]+)\s*(caja|cajas|unidad|docena|kg|l)?`.
- Detectar negaciones (lista: "sin","no","sin toppings","sin extras").
- Lookup del producto contra catálogo por `SHOP_ID` (exact + fuzzy simple).
- Mantener catálogos por rubro/tienda (helados vs almuerzos); parser común, mapping por catálogo.
- Fallback: si confidence < umbral → invocar IA o pedir aclaración.
- UX: si falta dato preguntar con frase corta ("¿3 cajas de vainilla sin toppings, confirmo?").

## Archivos sugeridos a modificar

- `bot-wasap/services/parseOrderText.js` (nuevo utilitario + tests).
- `bot-wasap/handlers/handler.js` (usar parser antes de IA).
- `bot-wasap/services/bot_core.js` (ajustar `addToCart()` si hace falta).
- `bot-wasap/JSON/catalogo_<shop>.json` (asegurar campo `rubro` y nombres normalizados).
- Tests: `test_select_product_quantity.js`, `test_finalize_order.js`.

## Checklist

- [ ] Crear `parseOrderText(text)` con tests unitarios.
- [ ] Añadir/normalizar catálogos por `SHOP_ID`.
- [ ] Integrar parser en flujo de entrada (priorizar parser sobre IA).
- [ ] Actualizar `addToCart()` y flujo de confirmación.
- [ ] Mensajes de aclaración para ambigüedades.
- [ ] Añadir/actualizar tests E2E y validar localmente (bot + Django).
- [ ] Documentar en `docs/DEVELOPER_SETUP.md`.

**Labels sugeridos:** enhancement, parser, ecommerce, no-IA-fallback

---

*Nota:* No puedo usar tokens ni credenciales que pegues aquí. He creado este archivo para que lo pegues directamente en tu gestor de issues o lo subas con la CLI.
