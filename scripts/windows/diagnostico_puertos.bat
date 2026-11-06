@echo off
REM Revisa quien escucha en los puertos de los bots (8096 heladeria, 8097 pescaderia, 8099) y de Lion Platform API (8081),
REM y si responden /health por localhost, 127.0.0.1 e IPv6. Resultado en diagnostico_puertos.log, en esta carpeta.
set L=%~dp0diagnostico_puertos.log
echo ==== %date% %time% > "%L%"
for %%p in (8096 8097 8099 8081) do (
  echo --- puerto %%p >> "%L%"
  netstat -ano | findstr ":%%p " >> "%L%"
  curl -s -m 5 -o NUL -w "localhost %%{http_code} %%{errormsg}\n" http://localhost:%%p/health >> "%L%" 2>&1
  curl -s -m 5 -o NUL -w "127.0.0.1 %%{http_code} %%{errormsg}\n" http://127.0.0.1:%%p/health >> "%L%" 2>&1
  curl -s -m 5 -o NUL -w "ipv6 %%{http_code} %%{errormsg}\n" "http://[::1]:%%p/health" >> "%L%" 2>&1
)
echo FIN >> "%L%"
