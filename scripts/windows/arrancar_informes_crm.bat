@echo off
setlocal EnableDelayedExpansion
REM Informes del CRM (AGentVents -> Telegram). Doble clic.
REM   agentvents-seguimientos  lunes a sabado 7:45 a. m.  seguimientos vencidos, estancados, pagos atrasados
REM   agentvents-ventas        lunes 8:10 a. m.           diagnostico de ventas del embudo
REM   agentvents-marketing     lunes 8:20 a. m.           prospectos nuevos por canal
REM Leen Lion Platform (localhost:8081): tiene que estar arriba (lion-platform-api en PM2).
REM No escuchan en ningun puerto. Al arrancar corren una vez (llegan 3 mensajes a Telegram) y luego a su hora.
REM Resultado en arrancar_informes_crm.log (esta carpeta). Para apagarlos: pm2 stop agentvents-seguimientos ...
set "ROOT=%~dp0..\.."
set "AGV=%USERPROFILE%\Documents\AGentVents"
set "LOG=%~dp0arrancar_informes_crm.log"
echo ==== %date% %time% ==== > "%LOG%"

REM 1) AGentVents tiene que estar en main (regla: nada corre en PM2 desde una rama de trabajo)
for /f "usebackq delims=" %%b in (`git -C "%AGV%" branch --show-current`) do set "BRANCH=%%b"
if /I not "!BRANCH!"=="main" (
  echo AGentVents esta en la rama "!BRANCH!", no en main. No arranco nada. >> "%LOG%"
  echo AGentVents no esta en main. Mira "%LOG%"
  pause
  exit /b 1
)
git -C "%AGV%" pull --ff-only origin main >> "%LOG%" 2>&1

REM 2) Lion Platform responde?
curl -s -m 5 -o nul -w "Lion Platform: HTTP %%{http_code}\n" http://localhost:8081/api/v1/auth/login >> "%LOG%" 2>&1

REM 3) Arrancar por el arranque seguro del ecosistema (valida puertos y que esten en ecosystem.config.js)
pushd "%ROOT%"
call npm run start:safe -- agentvents-seguimientos agentvents-ventas agentvents-marketing >> "%LOG%" 2>&1
popd
call pm2 save >> "%LOG%" 2>&1
timeout /t 20 /nobreak >nul
call pm2 logs agentvents-seguimientos --lines 15 --nostream >> "%LOG%" 2>&1
call pm2 logs agentvents-ventas --lines 15 --nostream >> "%LOG%" 2>&1
call pm2 logs agentvents-marketing --lines 15 --nostream >> "%LOG%" 2>&1
echo Listo. Mira Telegram y "%LOG%"
