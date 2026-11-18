@echo off
REM Muda Leo Financiero (bot-finance-telegram) del PC al servidor de Oracle. Doble clic.
REM Johan, 17 nov 2026: "subas por ahora Leo Finanzas". Los demas bots siguen en el PC por ahora.
REM 1) Detiene Leo en el PC (Telegram no deja dos copias del mismo bot leyendo a la vez).
REM 2) Empaca el codigo TAL COMO ESTA EN ESTE PC (git archive del commit actual), las claves
REM    (.env, .env.finance), la carpeta bot-wasap\data (bases de Leo) y deploy\oracle, y lo sube.
REM 3) En el servidor: prepara Node/PM2 si falta, instala dependencias para Linux (node_modules
REM    no se copia: lo de Windows no sirve alla) y arranca SOLO Leo con PM2.
REM 4) Si todo salio bien, borra Leo de PM2 en el PC. Si algo falla, vuelve a prender Leo en el PC.
REM Necesita ..\..\..\lion-platform-api\.env.oracle (ORACLE_IP) y la llave .oracle\oracle_lion.
REM Log en mudar_leo_oracle.log (esta carpeta).
setlocal EnableDelayedExpansion
set LOG=%~dp0mudar_leo_oracle.log
for %%I in ("%~dp0..\..") do set SAAS=%%~fI
for %%I in ("%SAAS%\..") do set DOCS=%%~fI
set KEY=%SAAS%\.oracle\oracle_lion
set PKG=%TEMP%\leo_oracle.tgz
echo ==== %date% %time% ==== > "%LOG%"

if not exist "%DOCS%\lion-platform-api\.env.oracle" ( echo FALTA lion-platform-api\.env.oracle con ORACLE_IP >> "%LOG%" & goto fin )
for /f "usebackq tokens=1,* delims==" %%a in ("%DOCS%\lion-platform-api\.env.oracle") do set "%%a=%%b"
if not exist "%KEY%" ( echo FALTA la llave %KEY% >> "%LOG%" & goto fin )
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul
REM OpenSSH de Windows rechaza llaves cuyo dueno no es este usuario o que otros pueden leer:
REM se usa una copia propia en %TEMP% con permisos solo para este usuario.
if exist "%TEMP%\oracle_lion_key" ( icacls "%TEMP%\oracle_lion_key" /grant "%USERNAME%:F" >nul & del /q "%TEMP%\oracle_lion_key" )
copy /y "%KEY%" "%TEMP%\oracle_lion_key" >nul
set KEY=%TEMP%\oracle_lion_key
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul
set SSH=-i "%KEY%" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes
set SRV=ubuntu@!ORACLE_IP!

echo 1. Probando la conexion con !ORACLE_IP! ... >> "%LOG%"
ssh -n %SSH% !SRV! "echo conectado" >> "%LOG%" 2>&1 || ( echo NO HAY CONEXION con el servidor: Leo sigue en el PC >> "%LOG%" & goto fin )

echo 2. Deteniendo Leo en el PC... >> "%LOG%"
call pm2 stop bot-finance-telegram >> "%LOG%" 2>&1

echo 3. Empacando el codigo de este PC, claves y datos de Leo... >> "%LOG%"
cd /d "%SAAS%"
for /f %%h in ('git rev-parse --short HEAD') do echo Commit del PC: %%h >> "%LOG%"
git archive --format=tar -o "%TEMP%\leo_code.tar" HEAD >> "%LOG%" 2>&1 || ( echo FALLO git archive >> "%LOG%" & goto volver )
if not exist "deploy\oracle\ecosystem.oracle.config.js" ( echo FALTA deploy\oracle\ecosystem.oracle.config.js >> "%LOG%" & goto volver )
tar -czf "%PKG%" .env .env.finance bot-wasap\data deploy\oracle >> "%LOG%" 2>&1 || ( echo FALLO tar >> "%LOG%" & goto volver )

echo 4. Subiendo... >> "%LOG%"
scp %SSH% "%TEMP%\leo_code.tar" "%PKG%" !SRV!:~/ >> "%LOG%" 2>&1 || ( echo FALLO scp >> "%LOG%" & goto volver )

echo 5. Preparando el servidor y arrancando Leo... >> "%LOG%"
ssh -n %SSH% !SRV! "set -e; command -v pm2 >/dev/null || curl -fsSL https://raw.githubusercontent.com/johanpovedadev/saas-bot/main/deploy/oracle/setup.sh | bash; rm -rf ~/saas-bot.nuevo; mkdir ~/saas-bot.nuevo; tar -xf ~/leo_code.tar -C ~/saas-bot.nuevo; tar -xzf ~/leo_oracle.tgz -C ~/saas-bot.nuevo; cd ~/saas-bot.nuevo/bot-wasap; PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund; cd ~; pm2 delete bot-finance-telegram >/dev/null 2>&1 || true; rm -rf ~/saas-bot.anterior; if [ -d ~/saas-bot ]; then mv ~/saas-bot ~/saas-bot.anterior; fi; mv ~/saas-bot.nuevo ~/saas-bot; rm -f ~/leo_code.tar ~/leo_oracle.tgz; cd ~/saas-bot; pm2 start deploy/oracle/ecosystem.oracle.config.js --only bot-finance-telegram; pm2 save; sleep 20; pm2 ls; pm2 logs bot-finance-telegram --lines 15 --nostream" >> "%LOG%" 2>&1 || ( echo FALLO en el servidor >> "%LOG%" & goto volver )
ssh -n %SSH% !SRV! "pm2 jlist | grep -q '\"name\":\"bot-finance-telegram\".*\"status\":\"online\"'" || ( echo Leo NO quedo online en el servidor >> "%LOG%" & goto volver )

echo 6. Leo corre en Oracle: lo quito del PC >> "%LOG%"
call pm2 delete bot-finance-telegram >> "%LOG%" 2>&1
call pm2 save >> "%LOG%" 2>&1
del /q "%PKG%" "%TEMP%\leo_code.tar"
echo LISTO: Leo Financiero corre en el servidor de Oracle >> "%LOG%"
goto fin

:volver
echo Vuelvo a prender Leo en el PC para que no quede caido >> "%LOG%"
cd /d "%SAAS%"
call pm2 start ecosystem.config.js --only bot-finance-telegram >> "%LOG%" 2>&1
:fin
echo FIN >> "%LOG%"
