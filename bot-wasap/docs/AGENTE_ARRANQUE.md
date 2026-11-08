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
- **Novedades de Leo (#129):** cada release con un cambio que el usuario **ve** agrega una entrada en `NEWS` de
  `services/financeNews.js` (`id` = la versión, `date` = el día del release, la más nueva arriba). Cada ítem: texto en
  voseo, corto, **sin montos**, con un `probar` concreto (_"escribí *metas*"_). Sale una vez al final del informe de la
  noche (y en el reenganche de quien no volvió). Cambios internos (pruebas, docs, refactors) no van.
- Crear releases o empujar tags desde aquí da 403: los tags los empuja Johan (`git push origin --tags`).

---

## 5. Poner el cambio en el PC de Johan (producción)

El PC tiene el repo en la carpeta conectada `empanadas`. **Cada script va en su propio proyecto**: `LionTelegram` es
solo de Hermes (no dejar ahí cosas de otros proyectos).

```bash
cd $HOME/mnt/empanadas && git pull --ff-only origin main
```

Después hay que reiniciar con un doble clic (desde aquí no se puede correr `pm2`):

| Archivo | Qué reinicia |
|---|---|
| `empanadas\scripts\windows\reiniciar_leo.bat` | **Leo** (`bot-finance-telegram`). |
| `empanadas\scripts\windows\reiniciar_heladeria.bat` | **Mundo Helados** (solo `bot-heladeria`; Django no se toca). Cliente en producción: solo si Johan lo pide. |
| `empanadas\scripts\windows\diagnostico_puertos.bat` | No reinicia: revisa quién escucha en los puertos de los bots. |
| `LionTelegram\reiniciar_hermes_cola.bat` | **Hermes**, la cola que pone a OpenCode a resolver issues (repo de Hermes). |
| `lion-platform-api\scripts\windows\arrancar_lion_platform.bat` | **Lion Platform** (Docker + Postgres 5433 + API 8081 + web 5173). |
| `empanadas\scripts\windows\arrancar_escucha_whatsapp.bat` | **Escucha de WhatsApp** (`lion-escucha-whatsapp`, `lion-readonly-bot.js`, puerto 8099): solo lee el WhatsApp de Johan y le pasa los prospectos al CRM. **Nunca envía.** Crea su token en `bot-wasap\.env.escucha` y se lo pone al bot "Service Store VIP Bot (solo lectura)" de Lion Platform. Máx. 3 reintentos espaciados (reconectar en bucle es lo que WhatsApp castiga). Apagar: `detener_escucha_whatsapp.bat`. |

Cómo saber que quedó: el `.log` que cada script deja a su lado (Leo debe decir "Telegram conectado" en el log de PM2;
Hermes y los demás deben salir `online` en la tabla de PM2).

**No tocar el bot de mascotas.** Producción, plata, datos y secretos los decide Johan.

### Qué está arriba hoy (Johan, 2 nov 2026)

De los negocios de clientes, **solo Mundo Helados está en producción**. Los demás están abajo **a propósito**:
no los arranques, no los "arregles" ni gastes tiempo en sus pruebas o errores, salvo que el issue lo pida.

| Servicio (PM2) | Estado | Nota |
|---|---|---|
| `bot-heladeria` + `django-heladeria` | 🟢 arriba | **Mundo Helados**, el único cliente en producción. Cuidado máximo. |
| `bot-finance-telegram` | 🟢 arriba | Leo Financiero (lo usa Johan). |
| `hermes` | 🟢 arriba | Cola de issues para OpenCode. |
| `admin-panel`, `cloudflare-tunnel` | 🟢 arriba | Soporte de lo de arriba. |
| `lion-escucha-whatsapp` | 🟡 a prueba (8 nov 2026) | Escucha de solo lectura del WhatsApp de Johan → prospectos en Lion Platform. Johan aceptó el riesgo de bloqueo para probar. No agregarle envíos, fotos de perfil ni nada que llame a WhatsApp por cada mensaje (en sept. 2026 eso hizo perder la sesión). |
| `bot-mascotas-prod` | 🔴 apagar (Johan, 8 nov 2026) | Apagado **hasta nueva orden** con `detener_mascotas.bat`. No volver a prenderlo. |
| `bot-pescaderia` + `django-pescaderia` | 🔴 abajo | A propósito. |
| `bot-pilates`, `bot-pilates-clientas` | 🔴 abajo | A propósito. |

Si una prueba de pescadería o pilates falla en la suite completa, no bloquea un cambio de Leo ni de helados:
anótalo en el PR y sigue. Cuando esto cambie, actualiza esta tabla.

---

## 6. Hermes + OpenCode (issues que se hacen solos)

- Hermes (repo `johanpovedadev/hermes-telegram-bot`) toma los issues con la etiqueta **`hermes:listo`**,
  crea un worktree en `~/.jarvis/worktrees`, corre OpenCode y abre el PR.
- Las pruebas que corre las define `projects.yaml` (en `LionTelegram`): `node scripts/run-tests.js --changed`
  → si solo cambiaste archivos de Leo, corre solo las de Leo.
- Tiempos máximos: agente 45 min, pruebas 20 min. El modelo es gratis (`deepseek` en OpenCode): por eso el issue
  tiene que ser **un escalón pequeño** con archivos, funciones y prueba ya dichos.
- Cómo se ve qué pasó: `~/.jarvis/hermes_jobs.db` (duración, estado de cada trabajo).
- **¿Pusiste `hermes:listo` y no arranca nada?** Mirá `~/.jarvis/hermes_cola.json`. Si dice `"pausada": true`
  (se pausa sola tras 2 fallas seguidas o 5 issues en el día), Johan manda **`/reanudar`** a Hermes por Telegram.
  Editar el archivo no sirve: Hermes guarda el estado en memoria y lo vuelve a escribir. La cola revisa cada 10 min.
  En `hermes_jobs.db` la tabla se llama `trabajos`.
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
