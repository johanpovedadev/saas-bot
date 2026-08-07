@echo off
title Seguros Bot - Iniciando...
cd /d "C:\Users\Administrador\Documents\empanadas"

echo ============================================
echo  Iniciando Django + Bot Seguros Mundial
echo ============================================

:: Iniciar Django con Waitress (multi-thread) en ventana nueva
start "Django Seguros" cmd /k "title Django Seguros && cd /d C:\Users\Administrador\Documents\empanadas && python run_wsgi.py"

:: Esperar a que Django arranque
timeout /t 8 /nobreak >nul

:: Iniciar Bot en ventana nueva
start "WhatsApp Bot" cmd /k "title WhatsApp Bot Seguros && cd /d C:\Users\Administrador\Documents\empanadas\bot-wasap && node index.js"

echo.
echo  Django corriendo en: http://localhost:8001
echo  Bot iniciado en ventana separada
echo  Escanea el QR desde WhatsApp para conectar
echo.
