@echo off
rem NeoIPTV — arrancar em Windows (requer Node.js instalado)
cd /d "%~dp0"
if not exist node_modules\electron (
  echo A instalar dependencias (electron^)...
  call npm install --no-audit --no-fund
)
start "" /b cmd /c "npx electron ."
