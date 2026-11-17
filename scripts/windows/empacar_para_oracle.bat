@echo off
REM Empaca en un solo archivo lo que los bots necesitan y NO esta en git: claves (.env), bases de datos
REM y sesiones de WhatsApp. Deja para_oracle.tgz en el Escritorio para subirlo al servidor de Oracle.
REM ANTES de correrlo: detener los bots que se mudan (pm2 stop bot-heladeria bot-finance bot-finance-telegram ...)
REM para que las bases no se copien a medio escribir. Doble clic. Log en empacar_para_oracle.log (esta carpeta).
setlocal
set LOG=%~dp0empacar_para_oracle.log
for %%I in ("%~dp0..\..") do set SAAS=%%~fI
for %%I in ("%SAAS%\..") do set DOCS=%%~fI
set OUT=%USERPROFILE%\Desktop\para_oracle.tgz
echo ==== %date% %time% ==== > "%LOG%"

cd /d "%DOCS%"
REM Rutas relativas a Documents. tar viene con Windows 10/11.
tar -czf "%OUT%" ^
  empanadas/.env ^
  empanadas/db.sqlite3 ^
  empanadas/bot-wasap/.env ^
  empanadas/bot-wasap/data ^
  empanadas/bot-wasap/auth/heladeria ^
  empanadas/bot-wasap/auth/finance ^
  empanadas/bot-wasap/auth/pilates ^
  empanadas/bot-wasap/auth/pilates_clientas ^
  AGentVents/.env >> "%LOG%" 2>&1
if errorlevel 1 ( echo FALLO tar: revisa que existan las rutas de arriba >> "%LOG%" & goto fin )
for %%F in ("%OUT%") do echo LISTO: %%~fF (%%~zF bytes) >> "%LOG%"
:fin
echo FIN >> "%LOG%"
