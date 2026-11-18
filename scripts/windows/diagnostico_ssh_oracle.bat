@echo off
REM Diagnostico: por que el PC no entra por SSH al servidor de Oracle. Doble clic. Log en diagnostico_ssh_oracle.log
setlocal EnableDelayedExpansion
set LOG=%~dp0diagnostico_ssh_oracle.log
for %%I in ("%~dp0..\..") do set SAAS=%%~fI
for %%I in ("%SAAS%\..") do set DOCS=%%~fI
for /f "usebackq tokens=1,* delims==" %%a in ("%DOCS%\lion-platform-api\.env.oracle") do set "%%a=%%b"
echo ==== %date% %time% ==== > "%LOG%"
echo Cerrando ssh colgados de intentos anteriores... >> "%LOG%"
taskkill /im ssh.exe /f >> "%LOG%" 2>&1
echo --- Puerto 22 --- >> "%LOG%"
powershell -NoProfile -Command "Test-NetConnection !ORACLE_IP! -Port 22 | Select-Object TcpTestSucceeded,RemoteAddress,InterfaceAlias | Format-List" >> "%LOG%" 2>&1
set KEY=%TEMP%\oracle_diag_key
if exist "%KEY%" ( icacls "%KEY%" /grant "%USERNAME%:F" >nul & del /q "%KEY%" )
copy /y "%SAAS%\.oracle\oracle_lion" "%KEY%" >nul
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul
echo --- ssh -vvv (maximo 45 s) --- >> "%LOG%"
powershell -NoProfile -Command "$p=Start-Process ssh -ArgumentList '-vvv','-i','%KEY%','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=15','-o','BatchMode=yes','ubuntu@!ORACLE_IP!','echo CONECTADO; uptime; free -m' -NoNewWindow -PassThru -RedirectStandardOutput '%TEMP%\diag_out.txt' -RedirectStandardError '%TEMP%\diag_err.txt'; if(-not $p.WaitForExit(45000)){ $p.Kill(); 'SE COLGO: lo corte a los 45 s' }; 'codigo=' + $p.ExitCode" >> "%LOG%" 2>&1
type "%TEMP%\diag_out.txt" >> "%LOG%" 2>&1
type "%TEMP%\diag_err.txt" >> "%LOG%" 2>&1
echo FIN >> "%LOG%"
