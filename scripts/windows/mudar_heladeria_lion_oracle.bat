@echo off
REM Muda Mundo Helados (Django + bot) y Lion Platform (API + web + base) al servidor de Oracle con Docker.
REM Johan, 17 nov 2026: "comprimido y con todos los datos, como Leo, para no actualizar secretos".
REM Doble clic. Todo sale de ESTE PC: codigo, claves (.env, service_account.json), db.sqlite3,
REM sesion de WhatsApp de la heladeria, copia de la base del CRM (Docker) y el CRM compilado.
REM Si algo falla, vuelve a prender todo en el PC. Log en mudar_heladeria_lion_oracle.log (esta carpeta).
setlocal EnableDelayedExpansion
set LOG=%~dp0mudar_heladeria_lion_oracle.log
for %%I in ("%~dp0..\..") do set SAAS=%%~fI
for %%I in ("%SAAS%\..") do set DOCS=%%~fI
set API=%DOCS%\lion-platform-api
set WEB=%DOCS%\lion-platform-web
set STAGE=%TEMP%\stack_oracle
echo ==== %date% %time% ==== > "%LOG%"

if not exist "%API%\.env.oracle" ( echo FALTA %API%\.env.oracle con ORACLE_IP >> "%LOG%" & goto fin )
for /f "usebackq tokens=1,* delims==" %%a in ("%API%\.env.oracle") do set "%%a=%%b"
set HOST=!ORACLE_IP:.=-!.sslip.io
if not exist "%API%\.env.koyeb" ( echo FALTA %API%\.env.koyeb >> "%LOG%" & goto fin )
if not exist "%SAAS%\deploy\oracle\stack\docker-compose.yml" ( echo FALTA deploy\oracle\stack >> "%LOG%" & goto fin )
set KEY=%SAAS%\.oracle\oracle_lion
if not exist "%KEY%" ( echo FALTA la llave %KEY% >> "%LOG%" & goto fin )
if exist "%TEMP%\oracle_lion_key" ( icacls "%TEMP%\oracle_lion_key" /grant "%USERNAME%:F" >nul & del /q "%TEMP%\oracle_lion_key" )
copy /y "%KEY%" "%TEMP%\oracle_lion_key" >nul
set KEY=%TEMP%\oracle_lion_key
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul
set SSH=-i "%KEY%" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes -o ServerAliveInterval=30
set SRV=ubuntu@!ORACLE_IP!

echo 1. Probando la conexion con !ORACLE_IP! ... >> "%LOG%"
ssh %SSH% !SRV! "echo conectado" >> "%LOG%" 2>&1 || ( echo NO HAY CONEXION con el servidor: no se toco nada >> "%LOG%" & goto fin )

echo 2. Compilando la API y la web del CRM ^(antes de apagar nada^)... >> "%LOG%"
cd /d "%API%"
call mvnw.cmd -q -DskipTests package >> "%LOG%" 2>&1 || ( echo FALLO LA COMPILACION DE LA API >> "%LOG%" & goto fin )
set JAR=
for %%j in (target\lion-platform-api-*.jar) do echo %%j | findstr /I "original" >nul || set JAR=%%j
if "!JAR!"=="" ( echo NO ENCONTRE el .jar >> "%LOG%" & goto fin )
cd /d "%WEB%"
call npm ci --no-audit --no-fund >> "%LOG%" 2>&1 || ( echo FALLO npm ci de la web >> "%LOG%" & goto fin )
call npm run build:publico >> "%LOG%" 2>&1 || ( echo FALLO LA COMPILACION DE LA WEB >> "%LOG%" & goto fin )

echo 3. Apagando en el PC la heladeria y el CRM ^(para copiar datos quietos^)... >> "%LOG%"
call pm2 stop bot-heladeria django-heladeria lion-platform-api >> "%LOG%" 2>&1

echo 4. Copia de la base del CRM ^(Docker del PC^)... >> "%LOG%"
docker info >nul 2>&1
if errorlevel 1 (
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  for /l %%i in (1,1,36) do ( docker info >nul 2>&1 && goto dockerok & timeout /t 5 /nobreak >nul )
  echo DOCKER NO PRENDIO >> "%LOG%" & goto volver
)
:dockerok
set PGC=
for /f "delims=" %%c in ('docker ps -a --filter "publish=5433" --format "{{.Names}}"') do set PGC=%%c
if "!PGC!"=="" ( echo NO ENCONTRE el Postgres del CRM ^(puerto 5433^) >> "%LOG%" & goto volver )
docker start !PGC! >> "%LOG%" 2>&1
for /l %%i in (1,1,12) do ( docker exec !PGC! pg_isready -U postgres >nul 2>&1 && goto pglisto & timeout /t 5 /nobreak >nul )
:pglisto
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\lion-api" "%STAGE%\web"
docker exec !PGC! pg_dump -U postgres --no-owner --no-acl lionplatform > "%STAGE%\lion.sql" 2>> "%LOG%" || ( echo FALLO pg_dump >> "%LOG%" & goto volver )
for %%F in ("%STAGE%\lion.sql") do echo Copia de la base: %%~zF bytes >> "%LOG%"

echo 5. Empacando... >> "%LOG%"
xcopy /e /i /q /y "%SAAS%\deploy\oracle\stack" "%STAGE%" >nul
copy /y "%API%\!JAR!" "%STAGE%\lion-api\app.jar" >nul
copy /y "%API%\.env.koyeb" "%STAGE%\lion-api\lion-api.env" >nul
xcopy /e /i /q /y "%WEB%\dist" "%STAGE%\web" >nul
tar -czf "%TEMP%\stack_oracle.tgz" -C "%STAGE%" . >> "%LOG%" 2>&1 || ( echo FALLO tar del stack >> "%LOG%" & goto volver )
cd /d "%SAAS%"
tar -czf "%TEMP%\saas_oracle.tgz" --exclude node_modules --exclude .git --exclude .claude --exclude .oracle ^
  --exclude .wwebjs_cache --exclude .wwebjs_auth --exclude "auth_readonly_ssv*" --exclude logs --exclude "*.log" ^
  --exclude "_respaldos*" --exclude _to_delete --exclude tmp --exclude Cache --exclude "Code Cache" --exclude GPUCache ^
  --exclude bot-wasap/auth/dev --exclude bot-wasap/auth/empanadas --exclude bot-wasap/auth/finance ^
  --exclude bot-wasap/auth/funeraria --exclude bot-wasap/auth/mascotas --exclude bot-wasap/auth/pescaderia ^
  --exclude bot-wasap/auth/pilates --exclude bot-wasap/auth/pilates_clientas --exclude bot-wasap/auth/service_store_vip_readonly ^
  . >> "%LOG%" 2>&1 || ( echo FALLO tar de los bots >> "%LOG%" & goto volver )
for %%F in ("%TEMP%\stack_oracle.tgz" "%TEMP%\saas_oracle.tgz") do echo %%~nxF: %%~zF bytes >> "%LOG%"

echo 6. Subiendo... >> "%LOG%"
scp %SSH% "%TEMP%\stack_oracle.tgz" "%TEMP%\saas_oracle.tgz" "%SAAS%\deploy\oracle\stack\instalar_stack.sh" !SRV!:~/ >> "%LOG%" 2>&1 || ( echo FALLO scp >> "%LOG%" & goto volver )

echo 7. Instalando con Docker en el servidor ^(la primera vez tarda 15-25 min^)... >> "%LOG%"
ssh %SSH% !SRV! "bash ~/instalar_stack.sh" >> "%LOG%" 2>&1
findstr /C:"LISTO_STACK" "%LOG%" >nul || ( echo FALLO la instalacion en el servidor >> "%LOG%" & goto volver )

echo 8. Todo corre en Oracle: lo quito del PC y apunto los informes al CRM en la nube >> "%LOG%"
call pm2 delete bot-heladeria django-heladeria lion-platform-api lion-platform-web lion-crm-publico lion-crm-tunel >> "%LOG%" 2>&1
call pm2 save --force >> "%LOG%" 2>&1
set AGV=%DOCS%\AGentVents\.env
if exist "!AGV!" powershell -NoProfile -Command "$p='!AGV!'; $u='LION_PLATFORM_BASE_URL=https://!HOST!/api/v1'; $l=Get-Content $p | Where-Object {$_ -notmatch '^LION_PLATFORM_BASE_URL='}; ($l + $u) | Set-Content $p" >> "%LOG%" 2>&1
rmdir /s /q "%STAGE%" & del /q "%TEMP%\stack_oracle.tgz" "%TEMP%\saas_oracle.tgz"
echo LISTO: CRM en https://!HOST! >> "%LOG%"
goto fin

:volver
echo Vuelvo a prender la heladeria y el CRM en el PC >> "%LOG%"
call pm2 restart lion-platform-api django-heladeria bot-heladeria >> "%LOG%" 2>&1
:fin
echo FIN >> "%LOG%"
