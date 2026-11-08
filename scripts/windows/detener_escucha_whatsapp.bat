@echo off
REM Apaga el escucha de WhatsApp (solo lectura) y lo deja apagado aunque se reinicie el PC. Doble clic.
REM Para desvincularlo del todo: en el celular, WhatsApp > Dispositivos vinculados > cerrar "lion-readonly".
set "LOG=%~dp0detener_escucha_whatsapp.log"
echo ==== %date% %time% ==== > "%LOG%"
call pm2 stop lion-escucha-whatsapp >> "%LOG%" 2>&1
call pm2 save >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
