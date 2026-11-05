# La IA de Leo Financiero: cómo está, cómo se configura y qué hacer cuando falla

> Para Johan y para cualquier agente que toque la IA de Leo. Si estás perdido, empezá por **"Cómo está hoy"** y
> **"Algo no funciona"**. El mapa de archivos de Leo está en [`LEO_MAPA.md`](LEO_MAPA.md).

## Cómo está hoy (5 nov 2026)

| Qué | Estado |
|---|---|
| IA de Leo | **Apagada para todos**: `FINANCE_AI_ENABLED=0` en `.env.finance` (#165). Johan: "por ahora dejémoslo sin IA, que paguen". |
| Qué sigue funcionando | Todo lo escrito: gastos, ingresos, resumen, metas, informes, tarjeta. Fotos y audios responden "Por ahora no estoy leyendo fotos ni audios". |
| 15 días gratis | No se regalan mientras la IA esté apagada; quedan para cuando se prenda. |
| Versión en producción | 1.9.2. El interruptor llega con la versión que incluya #165. |
| Cuando se prenda | Gemini directo (abajo) y, idealmente, con clave propia de Leo. |

**Para prenderla otra vez:** quitá `FINANCE_AI_ENABLED=0` de `.env.finance`, dejá una `GEMINI_API_KEY` válida y
reiniciá `bot-finance-telegram` con `--update-env`. Hasta tener clave propia, la opción es la de Mundo Helados, con el
cuidado que se explica abajo.

**Por qué Gemini directo y no OpenRouter (Johan, 5 nov):** es el mismo modelo y sale más barato. OpenRouter suma una
comisión al recargar saldo, y Google tiene plan gratis con límite diario. Además, con Gemini las fotos y los audios
funcionaban. Con OpenRouter fallaban, probablemente por el nombre del modelo allá (ver "Algo no funciona").

**Cuidado con la clave de Mundo Helados.** Mundo Helados está en producción. La cuota de Google es por clave (por
proyecto): si Leo la gasta, **el bot de helados se queda sin IA**. Por eso Leo lleva su propio tope diario,
`AI_DAILY_MAX`, en `.env.finance` (ver abajo). Es una medida para mientras tanto, no la solución.

## Cómo se configura (`.env.finance`)

`.env.finance` está en la raíz del proyecto, en la PC de Johan. **No está en el repo y nunca se sube.** Tiene
prioridad sobre el `.env` compartido. Ninguna clave se escribe en el código, en un issue ni en un PR.

| Variable | Para qué | Valor hoy |
|---|---|---|
| `FINANCE_AI_ENABLED` | Interruptor general. `0` apaga la IA de Leo **aunque haya claves** (también la de Gemini del `.env` compartido): nadie tiene IA, ni el administrador, y no se regalan los 15 días. Sin definir = prendida. | **`0`** (apagada). |
| `GEMINI_API_KEY` | Clave de Gemini (Google AI Studio). | La de Mundo Helados, temporal. |
| `OPENROUTER_API_KEY` | Si está, Leo usa OpenRouter primero y Gemini de respaldo. | **Comentada** (`# OPENROUTER_API_KEY=...`). |
| `FINANCE_AI_MODEL` | Modelo. Si empieza por `models/` es de Gemini; si no, de OpenRouter (ej. `google/...`). | Vacía o `models/gemini-3.1-flash-lite`. |
| `AI_DAILY_MAX` | Tope de llamadas a la IA por día **de este bot** (se cuenta aparte en `logs/ai-usage-finance.json`). Por defecto 5000. | Ponerla baja mientras use la clave de helados, ej. `AI_DAILY_MAX=300`. |
| `LEO_TRIAL_PROMO_UNTIL` | Último día de la promo de lanzamiento de los 15 días. | `2026-11-15` (por defecto). |
| `FINANCE_AI_USAGE_LOG` | Dónde se guarda cada llamada (tokens, costo, modelo, sin texto del usuario). | Por defecto `logs/ai-usage-finance.jsonl`. |

**Después de cambiar `.env.finance`:** `pm2 restart bot-finance-telegram --update-env`. Sin `--update-env`, PM2
sigue con el entorno viejo.

**Ojo con los nombres en PM2:** Leo en Telegram es **`bot-finance-telegram`** (`index-telegram.js`). `bot-finance` es
la versión de WhatsApp (`index.js`). Los dos leen el mismo `.env.finance`: si `bot-finance` también está prendido,
reinicialo igual. Cada proceso lleva su propio conteo para `AI_DAILY_MAX`, así que con los dos prendidos el tope
real es el doble.

**Para usar la clave de Mundo Helados:** abrí `.env.heladeria`, o el `.env` compartido si helados la toma de ahí.
Copiá el valor de `GEMINI_API_KEY` a `.env.finance`, agregá `AI_DAILY_MAX=300` y reiniciá
`bot-finance-telegram`. **No toques `.env.heladeria` ni reinicies helados.**

## Cómo funciona

1. **Proveedor** (`services/financeAiProvider.js`): `chat()` llama a OpenRouter si hay clave. Si falla, esa misma vez
   responde Gemini, y con 2 fallas seguidas se usa solo Gemini por 30 min. Sin clave de OpenRouter, va directo a
   Gemini. Cada llamada queda en el log de uso, con el jid cifrado (hash).
2. **Texto** (`services/financeAi.js` + `services/financeAiTools.js`): la IA no escribe la respuesta. Elige una
   herramienta: `registrar_gasto`, `varios_gastos`, `consultar`, `meta`, `charla`...
   - **Todo monto tiene que salir del texto** de la persona (anclaje). Si no cuadra, Leo pregunta el monto.
   - Antes de mandar el texto se tapan tarjetas, cuentas, cédulas y claves.
   - Si la IA falla, responde el lector sin IA (`fallbackInterpret`): por eso un gasto escrito se anota igual aunque
     la IA esté caída.
3. **Audio**: se transcribe con montos en cifras ("15 mil") y gastos separados por comas, y sigue el mismo camino
   que un texto. Montos dichos en letras ("quince mil") también se entienden.
4. **Foto de recibo**: la IA devuelve `{tienda, tipo, total, items}`.
   - Con total, se anota el gasto.
   - Sin total (tiquete de entrada al parqueadero), Leo pregunta "¿Cuánto pagaste?".
   - Si la IA no lee la foto, Leo dice que le escriban el gasto.
5. **Lenguaje de la gente**: "15 lucas", "luca y media", "un palo", "2 barras", "el lunes"
   (`utils/financeAmount.js`, `utils/financeDate.js`).

Fotos y audios **no tienen respaldo sin IA**: si la IA falla, solo se puede responder "escribime el gasto". Un
gasto escrito sí se anota sin IA. Por eso una IA caída se nota primero en las fotos.

## Quién tiene IA

En orden (`canUseAi()` en `handlers/flows/finance.flow.js`):

1. **El administrador** (`ADMIN_TELEGRAM_ID`): siempre, sin gastar cupo (#155, versión 1.9.1). Johan decidió
   dejarlo así (se cerró #159, que lo cambiaba a 15 días).
2. **Plan con IA** (Basic con cupo, Master, créditos de invitación): `financeAdmin.canConsumeAi()`. Planes y precios
   siguen pendientes (#94).
3. **15 días de IA gratis** (`services/financeAiTrial.js`), tope de 300 interacciones:
   - **Nuevos**: al crear la cuenta.
   - **Antiguos sin plan durante la promo** (hasta `LEO_TRIAL_PROMO_UNTIL`): con su primer mensaje, audio o foto,
     si nunca la tuvieron. Aviso una vez: "🎁 Por el lanzamiento te regalo 15 días…" (#156).
   - **Antiguos que vuelven** tras 7 días sin registrar: una sola vez ("¡Volviste!").
   - Aviso a 3 días del final y mensaje al terminar. Sin precios.

Sin nada de eso, Leo sigue gratis: texto sí, y fotos o audios responden "no está en tu plan" (`NO_AI_TEXT`).

## Cuánto cuesta: `/costo_ia`

Escribile `/costo_ia` a Leo desde la cuenta de administrador. Muestra:
- costo y llamadas de hoy y del mes, y el promedio por usuario;
- **🔧 Estado**: modelos en uso y el **último error de cada proveedor** con su causa real (desde 1.9.2).

Con Gemini directo el costo sale **US$0**, porque Gemini no devuelve el precio por llamada. Las llamadas sí se cuentan.
El costo real se ve en Google AI Studio.

## Algo no funciona

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Leo no lee ninguna foto ("No alcancé a leer esa foto") | La llamada a la IA falla. | `/costo_ia` → "Último error". |
| "Último error — OpenRouter: 400: … is not a valid model ID" | El nombre del modelo no existe en OpenRouter. El de #145 (`google/gemini-3.1-flash-lite`) nunca se verificó. | Comentar `OPENROUTER_API_KEY` (Gemini directo) o poner en `FINANCE_AI_MODEL` un nombre de la lista de openrouter.ai/models. |
| "Gemini: … API key not valid" / 403 | Clave de Gemini vencida o mal copiada. | Revisar `GEMINI_API_KEY` en `.env.finance` y reiniciar con `--update-env`. |
| "Gemini: 429" / "quota" | Se acabó la cuota del día de esa clave. **Con la clave de helados, helados también se queda sin IA.** | Bajar `AI_DAILY_MAX` y conseguir clave propia para Leo. |
| "tope diario de N llamadas (AI_DAILY_MAX)" | Leo llegó a su tope del día (protección contra bucles). | Normal si es alto el uso; sube mañana. Revisar que no haya un bucle. |
| Gastos escritos se anotan pero fotos y audios no | Normal cuando la IA está caída: el texto tiene respaldo sin IA, la foto no. | Ver las filas de arriba. |
| "Las fotos y los audios los leo con la IA, que no está en tu plan" | Ese usuario no tiene IA (ni plan ni 15 días). | Ver "Quién tiene IA". |
| El cambio en `.env.finance` no hizo nada | PM2 siguió con el entorno viejo, o se reinició el proceso equivocado. | `pm2 restart bot-finance-telegram --update-env`. |

Más detalle en los logs: `pm2 logs bot-finance-telegram --lines 300 | grep -i "financeAi"`.

## Pruebas: nunca con IA real

Las pruebas simulan la IA, sin red y con claves falsas (regla de `AGENTS.md`). Gastar tokens reales es decisión de
Johan, con `ALLOW_REAL_AI=1`.

```bash
cd bot-wasap
node scripts/run-tests.js --only=test_finance    # todas las de Leo
node tests_sim/run-leo.js --verbose              # simulador con los casos reales
node test_finance_ai_provider.js                 # proveedor y /costo_ia
node test_finance_audios_fotos.js                # audios, fotos, tiquete sin valor
```

## Decisiones (para no volver a discutirlas)

| Fecha | Decisión | Dónde |
|---|---|---|
| 4 nov | La IA elige herramientas y todo monto sale del texto de la persona. | #146 |
| 4 nov | 15 días de IA gratis: nuevos, antiguos en la promo y los que vuelven tras 7 días. | #147, #156 |
| 4 nov | El administrador siempre tiene IA. Se probó cambiarlo a 15 días (#159) y Johan lo dejó como estaba. | #155 |
| 5 nov | **Gemini directo** en vez de OpenRouter: mismo modelo, más barato, y las fotos funcionaban. | este documento |
| 5 nov | **9Router no** para Leo: es para herramientas de programación, y los datos de plata de los usuarios pasarían por un intermediario desconocido. | este documento |
| 5 nov | Mientras tanto, la **clave de Gemini de Mundo Helados**, con `AI_DAILY_MAX` bajo en Leo. | este documento |
| 5 nov | Ese mismo día: **Leo queda sin IA por ahora** (`FINANCE_AI_ENABLED=0`). La IA será para quien pague. | #165 |

## Versiones

| Versión | Qué trajo | PR |
|---|---|---|
| 1.9.0 | OpenRouter con respaldo Gemini, herramientas y anclaje, 15 días gratis, mensajes cortos, lo de siempre, lenguaje natural, audios y fotos como texto, simulador. | #145 a #152 |
| 1.9.1 | IA siempre para el administrador; los antiguos reciben los 15 días en la promo, aunque empiecen con un audio. | #155, #156 |
| 1.9.2 | Tiquete sin valor, respuesta corta si la IA no lee, errores visibles en `/costo_ia`, el menú ofrece el audio. | #160 |

## Pendiente

- **Clave de Gemini propia para Leo**, en un proyecto de Google aparte, para no gastar la cuota de Mundo Helados.
  Cuando esté, se cambia `GEMINI_API_KEY` en `.env.finance` y se reinicia `bot-finance-telegram`. No hace falta tocar
  código.
- Si se vuelve a OpenRouter: verificar el nombre exacto del modelo en openrouter.ai/models y que acepte imagen y
  audio.
- Planes y precios con IA (#94).
