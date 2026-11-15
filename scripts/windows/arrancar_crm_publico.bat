@echo off
setlocal
REM CRM desde cualquier lado. Doble clic.
REM   lion-crm-publico  sirve lion-platform-web\publico\dist en el puerto 4173 y reenvia /api a localhost:8081
REM   lion-crm-tunel    tunel rapido de Cloudflare hacia el 4173; la direccion llega por Telegram
REM El build (publico\dist) lo deja Claude; esa carpeta no va en git.
REM Resultado en arrancar_crm_publico.log (esta carpeta). Para apagarlo: pm2 stop lion-crm-tunel lion-crm-publico
set "ROOT=%~dp0..\.."
set "LOG=%~dp0arrancar_crm_publico.log"
echo ==== %date% %time% ==== > "%LOG%"
if not exist "%USERPROFILE%\Documents\lion-platform-web\publico\dist\index.html" (
  echo Falta el build en lion-platform-web\publico\dist. No arranco nada. >> "%LOG%"
  echo Falta el build del CRM. Mira "%LOG%"
  pause
  exit /b 1
)
pushd "%ROOT%"
call npm run start:safe -- lion-crm-publico lion-crm-tunel >> "%LOG%" 2>&1
popd
call pm2 save >> "%LOG%" 2>&1
timeout /t 25 /nobreak >nul
curl -s -m 5 -o nul -w "CRM local: HTTP %%{http_code}\n" http://localhost:4173/ >> "%LOG%" 2>&1
type "%ROOT%\bot-wasap\data\tunel_crm_url.txt" >> "%LOG%" 2>&1
call pm2 logs lion-crm-tunel --lines 20 --nostream >> "%LOG%" 2>&1
echo Listo. La direccion del CRM te llega por Telegram. Detalle en "%LOG%"
