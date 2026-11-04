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
| `utils/financeAmount.js` | `parseAmountText("2 millones")` → 2000000. |
| `utils/financeDate.js` | `todayInBogota()` → "YYYY-MM-DD". **Usa esta fecha, no la del servidor.** |
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
```

No corras la suite completa (`node scripts/run-tests.js` tarda ~25 min): Hermes corre `--changed`, que detecta si
solo cambiaste Leo.

## Reglas

- Nunca montos en imágenes ni textos para compartir: solo días y porcentajes.
- Nada de culpa: una meta lejana se dice con cómo acercarla; un mal día no se menciona.
- Fechas en Bogotá (`todayInBogota`), plata con `formatMoney`.
- No hagas commit, push ni merge: Hermes se encarga.
