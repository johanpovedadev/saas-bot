@echo off
REM Corre en el servidor de Oracle los comandos de ejecutar_en_oracle.sh (esta carpeta). Doble clic.
REM Salida en ejecutar_en_oracle.log. Sirve para revisar y arreglar el servidor sin teclear nada.
setlocal EnableDelayedExpansion
set LOG=%~dp0ejecutar_en_oracle.log
for %%I in ("%~dp0..\..") do set SAAS=%%~fI
for %%I in ("%SAAS%\..") do set DOCS=%%~fI
for /f "usebackq tokens=1,* delims==" %%a in ("%DOCS%\lion-platform-api\.env.oracle") do set "%%a=%%b"
echo ==== %date% %time% ==== > "%LOG%"
taskkill /im ssh.exe /f >nul 2>&1
set KEY=%TEMP%\oracle_exec_key
if exist "%KEY%" ( icacls "%KEY%" /grant "%USERNAME%:F" >nul & del /q "%KEY%" )
copy /y "%SAAS%\.oracle\oracle_lion" "%KEY%" >nul
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul
set SSH=-i "%KEY%" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes
scp %SSH% "%~dp0ejecutar_en_oracle.sh" ubuntu@!ORACLE_IP!:~/ejecutar_en_oracle.sh >> "%LOG%" 2>&1 || ( echo FALLO scp >> "%LOG%" & goto fin )
ssh -n %SSH% ubuntu@!ORACLE_IP! "tr -d '\r' < ~/ejecutar_en_oracle.sh > ~/.eo.sh && bash ~/.eo.sh" >> "%LOG%" 2>&1
:fin
echo FIN >> "%LOG%"
