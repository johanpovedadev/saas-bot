@echo off
setlocal EnableDelayedExpansion
REM Escucha de WhatsApp (SOLO LECTURA) para el CRM Lion Platform. Doble clic.
REM Corre bot-wasap\lion-readonly-bot.js: nunca envia mensajes (/send responde 403 en el codigo).
REM Lion Platform ya tiene este bot registrado (migracion V12, tenant Service Store VIP).
REM Primera vez: se abre Chrome con un QR -> en el celular: WhatsApp > Dispositivos vinculados > Vincular.
REM Resultado en arrancar_escucha_whatsapp.log (esta carpeta). Para apagarlo: detener_escucha_whatsapp.bat
set "BOT=%~dp0..\..\bot-wasap"
set "LOG=%~dp0arrancar_escucha_whatsapp.log"
set "ENVF=%BOT%\.env.escucha"
set "NAME=lion-escucha-whatsapp"
set "PORT=8099"
echo ==== %date% %time% ==== > "%LOG%"

REM 1) Si ya estaba en PM2, se detiene primero para revisar el puerto limpio
call pm2 describe %NAME% >nul 2>&1
if !errorlevel!==0 (
  call pm2 stop %NAME% >> "%LOG%" 2>&1
  timeout /t 3 /nobreak >nul
)

REM 2) Regla del ecosistema: el puerto tiene que estar libre
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if !errorlevel!==0 (
  echo El puerto %PORT% esta ocupado por otro programa. No arranco nada. >> "%LOG%"
  netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >> "%LOG%"
  echo El puerto %PORT% esta ocupado. Mira "%LOG%"
  pause
  exit /b 1
)

REM 3) Token propio (no el de ejemplo del repo). Se crea una sola vez en bot-wasap\.env.escucha (git lo ignora)
if not exist "%ENVF%" (
  powershell -NoProfile -Command "$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);'LION_READONLY_STATUS_TOKEN='+([Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('='))" > "%ENVF%"
  echo Token nuevo creado en bot-wasap\.env.escucha >> "%LOG%"
)
REM 3b) Clave para guardar el historial cifrado (#186). Se agrega una sola vez; si se pierde, lo guardado ya no se puede leer
findstr /B /C:"LION_READONLY_ENCRYPTION_KEY=" "%ENVF%" >nul 2>&1
if !errorlevel! neq 0 (
  powershell -NoProfile -Command "$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);'LION_READONLY_ENCRYPTION_KEY='+[Convert]::ToBase64String($b)" >> "%ENVF%"
  echo Clave de cifrado del historial creada en bot-wasap\.env.escucha >> "%LOG%"
)
for /f "usebackq tokens=1,* delims==" %%a in ("%ENVF%") do set "%%a=%%b"
set "LION_READONLY_STATUS_PORT=%PORT%"

REM 4) Lion Platform: el bot de solo lectura apunta a este puerto y a este token (el token no se escribe en el log)
docker exec lion-platform-pg psql -U postgres -d lionplatform -c "UPDATE bots SET control_plane_url='http://localhost:%PORT%', control_plane_token='!LION_READONLY_STATUS_TOKEN!' WHERE name='Service Store VIP Bot (solo lectura)';" >> "%LOG%" 2>&1

REM 5) Arrancar. Pocos reintentos y espaciados: reconectar en bucle es de lo que mas castiga WhatsApp
call pm2 describe %NAME% >nul 2>&1
if !errorlevel!==0 (
  call pm2 restart %NAME% --update-env >> "%LOG%" 2>&1
) else (
  call pm2 start "%BOT%\lion-readonly-bot.js" --name %NAME% --cwd "%BOT%" --max-restarts 3 --restart-delay 60000 >> "%LOG%" 2>&1
)
call pm2 save >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
echo Listo. Si aparece un QR en Chrome, escanealo: WhatsApp ^> Dispositivos vinculados ^> Vincular.
timeout /t 15
