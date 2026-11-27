# Servidor de Oracle (gratis) para los bots

**En fácil:** un computador en la nube, gratis y prendido siempre, donde viven los bots de
WhatsApp, Leo y los informes de la mañana. Así el PC ya no tiene que quedar encendido.

**En técnico:** VM Ampere A1 (ARM) *Always Free* de Oracle Cloud, Ubuntu, Node 20 + PM2, Python
con venv para el Django de cada negocio y Chromium del sistema para `whatsapp-web.js`
(el Chrome que descarga puppeteer no existe para ARM; se pasa con `CHROME_PATH`).

## Qué se muda y qué no

| Se muda | Se queda / apagado |
|---|---|
| `django-heladeria`, `bot-heladeria` | mascotas (apagado desde el 7 nov), pescadería |
| `bot-finance`, `bot-finance-telegram` (Leo) | `bot-dev` |
| `bot-pilates`, `bot-pilates-clientas` | túnel y copia pública del CRM (ya no hacen falta) |
| informes de AGentVents (seguimientos, ventas, marketing) | importador de chats (lee archivos del PC) |

La lista vive en `ecosystem.oracle.config.js` (`MUDAR`). Toma todo lo demás del
`ecosystem.config.js` del PC, así que no hay dos configuraciones que mantener.

## Pasos (una sola vez)

1. **Crear la VM** en la consola de Oracle: *Compute → Instances → Create*, imagen Ubuntu,
   forma **VM.Standard.A1.Flex** con 2 OCPU y 12 GB (todo el cupo gratis). Guardar la llave SSH.
2. **Preparar el servidor**: entrar por SSH y correr
   `curl -fsSL https://raw.githubusercontent.com/johanpovedadev/saas-bot/main/deploy/oracle/setup.sh | bash`
3. **Pasar los datos** (no van en git): en el PC, detener los bots que se mudan, doble clic en
   `scripts\windows\empacar_para_oracle.bat` y subir `para_oracle.tgz` del Escritorio:
   `scp -i llave.key para_oracle.tgz ubuntu@<ip>:~` y en el servidor
   `cd ~ && tar -xzf para_oracle.tgz && rsync -a empanadas/ saas-bot/ && rsync -a AGentVents/ agentvents/`.
4. **Ajustar el `.env` de AGentVents** con la URL de Lion Platform en la nube
   (`LION_PLATFORM_BASE_URL=https://<api>/api/v1`).
5. **Arrancar de a uno**: `pm2 start ~/saas-bot/deploy/oracle/ecosystem.oracle.config.js --only bot-finance-telegram`,
   probar, y luego todo con `pm2 start ~/saas-bot/deploy/oracle/ecosystem.oracle.config.js && pm2 save`.
6. **Apagar en el PC** lo que ya corre en Oracle (`pm2 delete <nombre>` y `pm2 save`). Nunca
   el mismo bot en los dos lados: WhatsApp cierra una de las dos sesiones.

## Ojo

- Las sesiones de WhatsApp se copian, pero WhatsApp puede pedir **escanear el QR otra vez** al
  verlas desde otro equipo. Hay que tener a mano el celular de cada negocio.
- Oracle puede recuperar VMs gratis que pasen días casi sin uso; con los bots atendiendo no
  debería pasar.
- Antes de arrancar algo, revisar que el puerto esté libre (regla del ecosistema):
  `ss -ltnp | grep <puerto>`.

## Actualización automática (desde el 27 nov 2026)

**En fácil:** cada 10 minutos el servidor mira si hay un cambio nuevo aprobado en GitHub (rama `develop`). Si lo hay, se
lo baja, revisa que no tenga errores, lo pone, reinicia el bot y mira que haya quedado vivo. Si no arranca, vuelve solo
a la versión anterior. Siempre avisa por Telegram (Jarvis). Ya no hace falta el PC ni el doble clic al `.bat`.

| Qué | Dónde en el servidor | Cómo se reinicia |
|---|---|---|
| Bot de la heladería (y Django si cambió Python) | `~/lion-stack/saas-bot` | `docker compose restart heladeria-bot` |
| Leo | `~/saas-bot` | `pm2 restart bot-finance-telegram` |
| AGentVents | `~/agentvents` | su instalador (`instalar_agentvents.sh`), conservando `.env` y `data/` |

**Nunca toca:** `.env`, `bot-wasap/data/` (sesión de WhatsApp, bases), `node_modules`.
**No se sube solo:** código con errores de escritura, o un cambio de dependencias (`package-lock.json`): avisa para instalarlo a mano.

**Términos:** *temporizador de systemd* (*systemd timer*) = el despertador de Linux que lo corre cada 10 minutos (es como *cron*, pero viene siempre instalado) · *SHA* = la huella de cada versión en
GitHub · *tarball* = el código de una versión en un solo archivo · *rollback* = volver a la versión anterior ·
*flock* = candado para que nunca corran dos a la vez.

- Instalar (una vez): `curl -fsSL https://raw.githubusercontent.com/johanpovedadev/saas-bot/develop/deploy/oracle/instalar_auto_actualizar.sh | bash`
- Registro: `~/lion-stack/auto/auto.log` · Huellas aplicadas: `~/lion-stack/auto/estado/`
- Ver cuándo corre: `systemctl list-timers auto-actualizar.timer` · Apagarlo: `sudo systemctl disable --now auto-actualizar.timer`
- Prueba sin internet ni servidor: `node bot-wasap/test_auto_actualizar.js`
