@echo off
title WhatsApp Bot Seguros - QR
cd /d "C:\Users\Administrador\Documents\empanadas\bot-wasap"
echo === BOT - ESCANEA EL QR ===
echo.
node index.js
echo.
echo === BOT CERRADO ===
echo Codigo de salida: %ERRORLEVEL%
pause
