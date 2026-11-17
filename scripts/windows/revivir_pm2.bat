@echo off
REM Vuelve a prender todo lo que PM2 tenia andando (Leo, heladeria, Lion Platform, informes...) despues de que el PC se reinicio.
REM Doble clic. Deja la lista final en revivir_pm2.log (esta carpeta).
set LOG=%~dp0revivir_pm2.log
echo ==== %date% %time% ==== > "%LOG%"
call pm2 ping >> "%LOG%" 2>&1
call pm2 resurrect >> "%LOG%" 2>&1
timeout /t 20 /nobreak >nul
call pm2 ls >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
