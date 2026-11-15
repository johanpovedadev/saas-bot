@echo off
setlocal EnableDelayedExpansion
REM Escucha de WhatsApp con whatsapp-web.js nuevo, SOLO para el escucha (14 nov 2026). Doble clic.
REM El escucha mostraba un QR, se quedaba pegado y el celular daba error al vincular. Mundo Helados usa la misma
REM libreria y funciona, asi que no se toca la de bot-wasap: se instala una copia aparte en bot-wasap\escucha_lib.
REM   1) Instala whatsapp-web.js en bot-wasap\escucha_lib (sin descargar Chromium: usa tu Chrome)
REM   2) Le dice al escucha que use esa copia (LION_READONLY_WWEBJS_DIR en bot-wasap\.env.escucha)
REM   3) Detiene el escucha, cierra SOLO su Chrome, aparta la sesion a medias (la renombra, no la borra)
REM   4) Arranca con arrancar_escucha_whatsapp.bat -> QR nuevo en la ventana de Chrome del escucha
REM Para volver a la libreria de siempre: borra la linea LION_READONLY_WWEBJS_DIR de .env.escucha y reinicia.
REM Resultado en escucha_libreria_nueva.log (esta carpeta).
set "VERSION=1.34.8"
set "BOT=%~dp0..\..\bot-wasap"
set "LIB=%BOT%\escucha_lib"
set "ENVF=%BOT%\.env.escucha"
set "LOG=%~dp0escucha_libreria_nueva.log"
echo ==== %date% %time% ==== > "%LOG%"

if not exist "%LIB%" mkdir "%LIB%"
if not exist "%LIB%\package.json" (
  > "%LIB%\package.json" echo {"name":"escucha-lib","private":true,"description":"Copia aparte de whatsapp-web.js para el escucha de WhatsApp"}
)
set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"
pushd "%LIB%"
call npm install whatsapp-web.js@%VERSION% --no-audit --no-fund >> "%LOG%" 2>&1
popd
if not exist "%LIB%\node_modules\whatsapp-web.js\package.json" (
  echo NO SE PUDO INSTALAR whatsapp-web.js %VERSION%. No toco el escucha. >> "%LOG%"
  echo No se pudo instalar la libreria. Mira "%LOG%"
  pause
  exit /b 1
)
findstr /b "\"version\"" "%LIB%\node_modules\whatsapp-web.js\package.json" >> "%LOG%" 2>&1
findstr /c:"\"version\": \"%VERSION%\"" "%LIB%\node_modules\whatsapp-web.js\package.json" >> "%LOG%" 2>&1

findstr /b "LION_READONLY_WWEBJS_DIR=" "%ENVF%" >nul 2>&1
if errorlevel 1 (
  >> "%ENVF%" echo LION_READONLY_WWEBJS_DIR=escucha_lib
  echo Escucha configurado para usar escucha_lib >> "%LOG%"
)

call pm2 stop lion-escucha-whatsapp >> "%LOG%" 2>&1
timeout /t 5 /nobreak >nul
powershell -NoProfile -Command "$ps = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'auth_readonly_ssv\\session' }; 'Chrome del escucha abiertos: ' + @($ps).Count; $ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >> "%LOG%" 2>&1
timeout /t 5 /nobreak >nul
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set "STAMP=%%t"
pushd "%BOT%"
if exist auth_readonly_ssv ren auth_readonly_ssv auth_readonly_ssv_intento_!STAMP! >> "%LOG%" 2>&1
if exist auth_readonly_ssv echo NO SE PUDO APARTAR LA SESION (sigue bloqueada) >> "%LOG%"
popd

call "%~dp0arrancar_escucha_whatsapp.bat" >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
