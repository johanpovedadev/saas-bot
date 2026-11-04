# Mapa de Leo Financiero (para agentes de IA y desarrolladores)

Léelo antes de tocar Leo. Está hecho para que no tengas que recorrer el repo: aquí dice qué archivo hace qué.
Cómo subir, desplegar y usar Hermes: [`AGENTE_ARRANQUE.md`](AGENTE_ARRANQUE.md).

## Qué es

Bot de finanzas personales por Telegram (`BUSINESS_KEY=finance`, PM2: `bot-finance-telegram`). El usuario registra
gastos por chat, Leo lee las compras del correo, manda un informe cada noche (9 p. m. Bogotá) y uno semanal (sábados).
Tono: voseo ("llevás", "decime"), cálido, **nunca culpa ni miedo**, nunca montos en lo que se comparte.

## Dónde está cada cosa

| Archivo | Qué hace |
|---|---|
| `handlers/flows/finance.flow.js` | El flujo del chat (~2.100 líneas). `handle()` es la entrada: comandos sin IA primero, luego la IA. `saveAndConfirm()` guarda un gasto/ingreso. `generateNightReport()` es el informe de la noche. `startNightReporter()` corre cada 15 min. **No lo leas entero: busca la función con grep.** |
| `services/financeStore.js` | Guarda y carga la cuenta (`loadFinance(jid)` / `saveFinance(jid, fin)`) en SQLite, cifrada. Un campo nuevo de `fin` hay que agregarlo en `rowToFinance` **y** en `financeToRow` (montos con `encryptAmount`, objetos con `encrypt(JSON)`). |
| `services/financeAi.js` | IA (Gemini) y `fallbackInterpret()` (parser sin IA). En pruebas la IA va simulada (`NODE_ENV=test`, sin `GEMINI_API_KEY`). |
| `services/financeAiProvider.js` | Proveedor de IA (#143): OpenRouter (`OPENROUTER_API_KEY` en `.env.finance`, modelo `FINANCE_AI_MODEL`) con respaldo en Gemini (`GEMINI_API_KEY`; 2 fallas seguidas → Gemini 30 min). Costo por llamada en `logs/ai-usage-finance.jsonl` (sin textos); `/costo_ia` lo resume. En pruebas, transportes falsos con `_setTransports()`. |
| `services/financeAiTools.js` | La IA solo elige herramientas (#143): `registrar_gasto`, `varios_gastos`, `corregir_ultimo`, `consultar`, `meta`, `charla`... → intenciones de `applyIntent`. `groundAmount()` (el monto tiene que salir del texto), `groundDescription()`, `maskSensitive()` (tarjetas, cédulas, claves) y `groundChat()` (sin cifras inventadas). |
| `services/financeAiTrial.js` | 15 días de IA gratis (#143): nuevos; hasta `LEO_TRIAL_PROMO_UNTIL` también todo antiguo sin plan que nunca la tuvo; y antiguos que vuelven tras 7 días, una vez. `grantTrialIfDue()` de `finance.flow.js` la da con cualquier mensaje, audio o foto (también en `isPremiumBlocked`). Las pruebas que no son de esto fijan `LEO_TRIAL_PROMO_UNTIL='2000-01-01'`. `fin.aiTrialUntil`, `fin.aiTrialReturnUsed`, `fin.aiTrial` (uso, tope 300, avisos). `canUseAi()` la cuenta como un plan. Aviso a 3 días del final y mensaje al terminar, sin precios. |
| `services/financePresenter.js` | Presentador (#144): toda respuesta pasa por `present()` dentro del `say` de `finance.flow.js` (máx. 3 líneas + "➕ Ver más", una pregunta, sin "escribí el número", saludo una vez por día). Pantallas largas a propósito (informes, resumen, salud...) usan `sayFull`. |
| `services/financeEntry.js` | `isClearEntry()` (guardar de una) y `extractDetails()`: medio de pago (Rappi→tarjeta, Nequi/PSE→banco) y día ("ayer") del mensaje, para no preguntarlos. |
| `services/financeFrequent.js` | "Lo de siempre" (#144): los 3 gastos más repetidos en 30 días (3+ veces, monto parecido) como botones bajo "¿Qué compraste?" y después del menú (`leo:siempre:<monto>:<slug>`). Prueba: `test_finance_lo_de_siempre.js`. |
| `services/financeInsights.js` | Resumen agrupado: `buildSpendingReport(fin, today, days)` y `formatSpendingReport(report, fin)`. |
| `services/financeWeekly.js` | Informe semanal: `buildWeeklyMessage(fin, today)`; horas en Bogotá (`isNightReportTime`). |
| `services/financeGoals.js` | Metas con fecha: `projectGoal(fin, today)`, `formatProjection()`, `weeklyGoalLine()`, `dailyGoalLine()`, `parseMonthlySaving()`. |
| `services/financeStreak.js` | Racha, protector 🛡️ y niveles del león: `bump(fin, now)`, `statusLine(fin)`, `levelFor(fin)`. |
| `services/financeMedals.js` | Medallas: lista `MEDALS` (cada una con `check(fin)`), `awardNew(fin)`, `formatMedalList(fin)`. |
| `services/financeCard.js` | Imágenes (canvas): `generateCard()` para medallas, `generateShareCard()` para "compartir". |
| `services/financeCharts.js` | Gráficas (canvas, #139): dona por categoría, barras de 7 días y barra de la meta. `*Data()` arma los datos, `render*()` da el PNG, `buildChartLabels()` todo texto dibujado (sin montos en modo privado). |
| `services/financeCardStatement.js` | Extracto de la tarjeta: `owed()`, `formatOwed()`, `parsePayment()`, `applyPayment()`. |
| `services/financeEmailImport.js` + `financeEmailParsers.js` | Leen correos de RappiCard, Binance, RappiPay, BBVA. |
| `services/financeEmailInbox.js` | Bandeja `data/correos_entrantes`: correos o ajustes `{ movimientos, saldo, tarjeta }`. |
| `services/financeReview.js` + `financeLearning.js` | "¿En qué fue este gasto?" (`1 comida`) y lo que Leo aprende. |
| `services/financeReceipts.js` | Productos del recibo y "¿dónde está más barato?". |
| `utils/financeMoney.js` | `formatMoney(n, fin)` → "$1.234.567". **Úsalo siempre para mostrar plata.** |
| `utils/financePrivacy.js` | Modo privado (#139): `money(n, fin, { kind })` con `kind` = `saldo` / `ahorro` / `meta` / `gasto`. **Para saldo, ahorro o meta usá este, no `formatMoney`**: con el modo prendido sale `$•••••`. |
| `utils/financeAmount.js` | `parseAmountText("2 millones")` → 2000000. `normalizeSpokenAmounts()` (#144): "15 lucas", "luca y media", "un palo", "medio palo", "2 barras", "15k", "30000.000" → cifras; lo llaman `financeAi.interpret` (con nombre puesto) e `interpretEntries`. También montos en letras ("quince mil", `wordNumbersToDigits`), para los audios. Pruebas: `test_finance_lenguaje_natural.js`, `test_finance_audios_fotos.js`. |
| `utils/financeDate.js` | `todayInBogota()` → "YYYY-MM-DD". **Usa esta fecha, no la del servidor.** `parseRelativeDay()`: "ayer", "antier", "el lunes" (el último lunes). |
| `utils/financeDisclaimer.js` | Aviso "Leo no es asesor financiero" (solo en informes y consejos). |

## Datos de la cuenta (`fin`)

`name`, `balance` (saldo), `transactions` (cada una: `type` expense/income, `amount`, `date` YYYY-MM-DD, `description`,
`category`, `medium` tarjeta/banco/efectivo/envio, `necesidad`), `goalName`, `goalTarget`, `goalMonthly`, `streak`,
`bestStreak`, `streakFreezes`, `streakLevel`, `medals`, `cardStatement`.

## Cómo agregar algo nuevo (patrón)

1. Lógica en un **servicio nuevo o existente** (`services/financeX.js`), con funciones puras que reciben `fin` y `today`.
2. En `finance.flow.js` solo se llama: un comando sin IA va en `handle()` junto a los de `MEDALS_COMMAND`; una línea del
   informe va en `generateNightReport()` o en `buildWeeklyMessage()`.
3. Prueba nueva `test_finance_<tema>.js` en `bot-wasap/` (copia la estructura de `test_finance_metas_con_fecha.js`:
   base temporal, ID de prueba `5730000097xx@telegram`, IA simulada, `console.log('OK: ...')`).

## Pruebas (rápidas)

```bash
cd bot-wasap
node test_finance_<tema>.js                      # la tuya
node scripts/run-tests.js --only=test_finance    # todas las de Leo, ~2 min
node tests_sim/run-leo.js --verbose              # simulador: casos reales donde la gente se trabó
```

**Simulador de Leo** (`tests_sim/run-leo.js`, `leoWorld.js`, `scenarios_leo/`): conversaciones completas con el flujo
real, con IA simulada (ingenua a propósito: toma el primer número como plata) y sin IA. Cada conversación mala que
reporte un usuario se agrega a `scenarios_leo/` como escenario. `test_finance_simulador_leo.js` lo corre dentro de
`--only=test_finance` y falla si Leo se traba. No toca el simulador de Mundo Helados (solo usa `runner.js`).

No corras la suite completa (`node scripts/run-tests.js` tarda ~25 min): Hermes corre `--changed`, que detecta si
solo cambiaste Leo.

## Reglas

- Nunca montos en imágenes ni textos para compartir: solo días y porcentajes.
- Nada de culpa: una meta lejana se dice con cómo acercarla; un mal día no se menciona.
- Fechas en Bogotá (`todayInBogota`), plata con `formatMoney`.
- No hagas commit, push ni merge: Hermes se encarga.
