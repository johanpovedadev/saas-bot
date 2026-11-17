@echo off
REM Muda Leo Financiero (bot-finance-telegram) del PC al servidor de Oracle. Doble clic.
REM Johan, 17 nov 2026: "subas por ahora Leo Finanzas". Los demas bots siguen en el PC por ahora.
REM 1) Detiene Leo en el PC (Telegram no deja dos copias del mismo bot leyendo a la vez).
REM 2) Empaca claves (.env, .env.finance) y la carpeta bot-wasap\data (bases de Leo) y las sube.
REM 3) En el servidor: prepara Node/PM2 si falta, actualiza saas-bot y arranca SOLO Leo con PM2.
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
set SSH=-i "%KEY%" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20
set SRV=ubuntu@!ORACLE_IP!

echo 1. Probando la conexion con !ORACLE_IP! ... >> "%LOG%"
ssh %SSH% !SRV! "echo conectado" >> "%LOG%" 2>&1 || ( echo NO HAY CONEXION con el servidor: Leo sigue en el PC >> "%LOG%" & goto fin )

echo 2. Deteniendo Leo en el PC... >> "%LOG%"
call pm2 stop bot-finance-telegram >> "%LOG%" 2>&1

echo 3. Empacando claves y datos de Leo... >> "%LOG%"
cd /d "%SAAS%"
tar -czf "%PKG%" .env .env.finance bot-wasap\data >> "%LOG%" 2>&1 || ( echo FALLO tar >> "%LOG%" & goto volver )

echo 4. Subiendo... >> "%LOG%"
scp %SSH% "%PKG%" !SRV!:~/leo_oracle.tgz >> "%LOG%" 2>&1 || ( echo FALLO scp >> "%LOG%" & goto volver )

echo 5. Preparando el servidor y arrancando Leo... >> "%LOG%"
ssh %SSH% !SRV! "set -e; command -v pm2 >/dev/null || curl -fsSL https://raw.githubusercontent.com/johanpovedadev/saas-bot/main/deploy/oracle/setup.sh | bash; cd ~/saas-bot && git pull --ff-only -q; tar -xzf ~/leo_oracle.tgz -C ~/saas-bot && rm ~/leo_oracle.tgz; pm2 delete bot-finance-telegram >/dev/null 2>&1 || true; pm2 start deploy/oracle/ecosystem.oracle.config.js --only bot-finance-telegram && pm2 save && sleep 20 && pm2 ls && pm2 logs bot-finance-telegram --lines 15 --nostream" >> "%LOG%" 2>&1 || ( echo FALLO en el servidor >> "%LOG%" & goto volver )
ssh %SSH% !SRV! "pm2 jlist | grep -q '\"name\":\"bot-finance-telegram\".*\"status\":\"online\"'" || ( echo Leo NO quedo online en el servidor >> "%LOG%" & goto volver )

echo 6. Leo corre en Oracle: lo quito del PC >> "%LOG%"
call pm2 delete bot-finance-telegram >> "%LOG%" 2>&1
call pm2 save >> "%LOG%" 2>&1
del /q "%PKG%"
echo LISTO: Leo Financiero corre en el servidor de Oracle >> "%LOG%"
goto fin

:volver
echo Vuelvo a prender Leo en el PC para que no quede caido >> "%LOG%"
call pm2 start bot-finance-telegram >> "%LOG%" 2>&1
:fin
echo FIN >> "%LOG%"
