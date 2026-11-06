@echo off
REM Reinicia solo el bot de Mundo Helados (bot-heladeria) en PM2. Django (django-heladeria) no se toca.
REM Doble clic. Deja el resultado en reiniciar_heladeria.log, en esta misma carpeta.
set LOG=%~dp0reiniciar_heladeria.log
echo ==== %date% %time% ==== > "%LOG%"
call pm2 restart bot-heladeria --update-env >> "%LOG%" 2>&1
timeout /t 20 /nobreak >nul
call pm2 ls >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
