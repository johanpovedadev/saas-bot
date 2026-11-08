@echo off
REM Apaga el bot de Mascotas (bot-mascotas-prod) y guarda el estado en PM2 para que NO vuelva a prender solo.
REM Orden de Johan (8 nov 2026): apagado hasta nueva orden. Resultado en detener_mascotas.log (esta carpeta).
set LOG=%~dp0detener_mascotas.log
echo ==== %date% %time% ==== > "%LOG%"
call pm2 stop bot-mascotas-prod >> "%LOG%" 2>&1
call pm2 save >> "%LOG%" 2>&1
call pm2 ls >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
