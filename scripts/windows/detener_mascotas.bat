@echo off
setlocal EnableDelayedExpansion
REM Apaga TODO Mascotas (Te Aseguramos) hasta nueva orden. Orden de Johan: 8 nov y 10 nov 2026.
REM   1) bot-mascotas-prod en PM2 (y pm2 save para que no prenda solo)
REM   2) La tarea programada de Windows "empanadas-bot-mascotas" (arrancaba al iniciar sesion desde
REM      empanadas-prod\startup-bot-mascotas.bat): se DESHABILITA, no se borra. Para volver: schtasks /change /tn "\empanadas-bot-mascotas" /enable
REM   3) El Django de mascotas (run_wsgi.py en el puerto 8001), que corria fuera de PM2
REM Resultado en detener_mascotas.log (esta carpeta).
set "LOG=%~dp0detener_mascotas.log"
echo ==== %date% %time% ==== > "%LOG%"
call pm2 stop bot-mascotas-prod >> "%LOG%" 2>&1
call pm2 stop django-mascotas >> "%LOG%" 2>&1
call pm2 save >> "%LOG%" 2>&1
schtasks /change /tn "\empanadas-bot-mascotas" /disable >> "%LOG%" 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8001 .*LISTENING"') do (
  powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%%p'; if ($p.CommandLine -match 'run_wsgi') { Stop-Process -Id %%p -Force; 'Detenido Django de mascotas (PID %%p)' } else { 'El 8001 lo usa otro programa, no lo toco: ' + $p.Name }" >> "%LOG%" 2>&1
)
timeout /t 2 /nobreak >nul
echo ---- puerto 8001 despues >> "%LOG%"
netstat -ano | findstr /R /C:":8001 .*LISTENING" >> "%LOG%" 2>&1
schtasks /query /tn "\empanadas-bot-mascotas" /fo LIST >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
