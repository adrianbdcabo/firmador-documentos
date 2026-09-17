@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Abriendo la web en el navegador: http://127.0.0.1:8080
echo Para cerrarla, cierra esta ventana.
start "" http://127.0.0.1:8080
npx --yes http-server . -p 8080 -c-1
