@echo off
REM Reinicia Leo Financiero (bot-finance-telegram) en PM2. Doble clic. Resultado en reiniciar_leo.log (esta carpeta).
REM Antes se llamaba arrancar_hermes.bat y estaba en la carpeta de Hermes (LionTelegram), que es otro proyecto.
set LOG=%~dp0reiniciar_leo.log
echo ==== %date% %time% ==== > "%LOG%"
call pm2 stop bot-finance-telegram >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul
call pm2 start bot-finance-telegram >> "%LOG%" 2>&1
call pm2 save >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
