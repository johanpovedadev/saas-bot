# Arranque rápido para agentes (Claude, OpenCode/Hermes)

**Objetivo:** que un agente que entra al proyecto esté trabajando en 2 minutos, sin recorrer el repo ni correr
pruebas de 25 minutos. Si algo de aquí quedó viejo, corrígelo en el mismo PR donde lo notaste.

---

## 1. En palabras simples

- **Johan pide y prueba. Los agentes hacen el resto** (código, pruebas, PR, merge, release).
- El repo tiene muchos bots; **Leo Financiero** (bot de finanzas por Telegram) es el que más se mueve.
- Una tarea normal: **issue en GitHub → rama → cambio pequeño + su prueba → PR a `develop` → merge**.
- Lo que más demora a un agente (y cómo evitarlo):

| Lo que demora | Haz esto en cambio |
|---|---|
| Leer `finance.flow.js` entero (~2.100 líneas) | `grep -n "nombreFuncion"` y lee solo ese pedazo |
| Correr la suite completa (~25 min) | `node scripts/run-tests.js --only=test_finance` (~2 min) o solo tu prueba |
| Buscar qué archivo hace qué | Lee `docs/LEO_MAPA.md` (una tabla) |
| Adivinar el patrón de una prueba | Copia `test_finance_metas_con_fecha.js` |
| `npm ci` cada vez | Solo si falta `node_modules` |

---

## 2. Orden de lectura (y nada más)

1. Este archivo.
2. Si es de Leo: `bot-wasap/docs/LEO_MAPA.md`.
3. El issue: trae archivos, funciones, la prueba que hay que crear y "cómo probar".
4. Solo los archivos que nombra el issue.

No hace falta leer `ARQUITECTURA_SISTEMA.md`, `PROJECT_CONTEXT.md` ni los docs de otros bots para una tarea de Leo.

---

## 3. Hacer un cambio de Leo (receta)

```bash
cd bot-wasap
git checkout develop && git pull --ff-only
git checkout -b feature/<tema>          # o fix/<tema>
# 1) lógica en services/financeX.js (funciones puras: reciben fin y today)
# 2) en finance.flow.js solo se llama (comando en handle(), línea en generateNightReport()/buildWeeklyMessage())
# 3) prueba nueva: test_finance_<tema>.js (copia la estructura de test_finance_metas_con_fecha.js)
node test_finance_<tema>.js                        # la tuya, segundos
node scripts/run-tests.js --only=test_finance      # todas las de Leo, ~2 min
```

Reglas de Leo que no se rompen: voseo, **nunca culpa ni miedo**, **nunca montos en lo que se comparte**,
fechas con `todayInBogota()`, plata con `formatMoney()`, la IA siempre simulada en pruebas.

Conocido: `test_finance_respuesta_numero_no_es_gasto.js` a veces falla por el `data/admin.db` compartido.
Si falla solo esa, córrela sola otra vez antes de buscar el error.

---

## 4. Subir (solo Claude; OpenCode/Hermes no hace commit ni push)

- Commits pequeños: `feat(leo): ...`, `fix(leo): ...`, `test(leo): ...`, `docs: ...`.
- PR a `develop` con `gh api` (REST). **GraphQL está bloqueado**, así que `gh pr create` falla:

```bash
gh api repos/johanpovedadev/saas-bot/pulls -f head=<rama> -f base=develop -f title="..." -f body="..."
gh api -X PUT repos/johanpovedadev/saas-bot/pulls/<n>/merge -f merge_method=merge
```

- Release: rama `release/x.y.z` con `CHANGELOG.md` + versión en `package.json` → PR a `develop` → PR `develop`→`main`
  → cerrar el issue con un comentario.
- Crear releases o empujar tags desde aquí da 403: los tags los empuja Johan (`git push origin --tags`).

---

## 5. Poner el cambio en el PC de Johan (producción)

El PC tiene el repo en la carpeta conectada `empanadas` y los arranques en `LionTelegram`.

```bash
cd $HOME/mnt/empanadas && git pull --ff-only origin main
```

Después hay que reiniciar con un doble clic en `LionTelegram` (desde aquí no se puede correr `pm2`):

| Archivo | Qué reinicia |
|---|---|
| `arrancar_hermes.bat` | **Leo** (`bot-finance-telegram`). Ojo: el nombre engaña. |
| `reiniciar_hermes_cola.bat` | **Hermes**, la cola que pone a OpenCode a resolver issues. |

Cómo saber que quedó: `reinicio.log` / `reinicio_hermes.log` en `LionTelegram` (Leo debe decir "Telegram conectado";
Hermes debe salir `online` en la tabla de PM2).

**No tocar el bot de mascotas.** Producción, plata, datos y secretos los decide Johan.

---

## 6. Hermes + OpenCode (issues que se hacen solos)

- Hermes (repo `johanpovedadev/hermes-telegram-bot`) toma los issues con la etiqueta **`hermes:listo`**,
  crea un worktree en `~/.jarvis/worktrees`, corre OpenCode y abre el PR.
- Las pruebas que corre las define `projects.yaml` (en `LionTelegram`): `node scripts/run-tests.js --changed`
  → si solo cambiaste archivos de Leo, corre solo las de Leo.
- Tiempos máximos: agente 45 min, pruebas 20 min. El modelo es gratis (`deepseek` en OpenCode): por eso el issue
  tiene que ser **un escalón pequeño** con archivos, funciones y prueba ya dichos.
- Cómo se ve qué pasó: `~/.jarvis/hermes_jobs.db` (duración, estado de cada trabajo).
- **Cómo escribir un issue para OpenCode:** título corto, "Lee `bot-wasap/docs/LEO_MAPA.md`", archivo y función
  exactos, ejemplo de entrada → salida esperada, nombre de la prueba y el comando para correrla. Ejemplos: #113–#116.

---

## 7. Datos de Johan en Leo (solo si la tarea lo pide)

- **Agregar movimientos, saldo o extracto:** soltar un `.json` en `data/correos_entrantes` (Leo lo lee cada 15 min).
  Formato: `{ "movimientos": [...], "saldo": 123, "tarjeta": { cuenta, pagoTotal, pagoMinimo, fechaPago, corte, cupo } }`.
  Detalle en `services/financeEmailInbox.js`.
- **Leer la base:** está cifrada. Se copia `finance.db*` a una carpeta temporal, se abre con la clave de
  `.env.finance` y `services/financeCrypto`, y **se borra la copia al terminar**. Nunca pegar la clave ni montos en un PR.

---

## 8. Al terminar

- Decirle a Johan, en fácil: qué cambió, qué pruebas corriste y cómo probarlo en Telegram ("CÓMO PROBAR:").
- Si aprendiste algo que te habría ahorrado tiempo, agrégalo aquí.
