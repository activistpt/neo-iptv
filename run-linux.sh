#!/usr/bin/env bash
# NeoIPTV — correr em Linux sem instalacao global
# Uso:  ./run-linux.sh        (instala dependencias se faltarem e arranca)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nao encontrado. Instala primeiro (ex.: sudo apt install nodejs npm)" >&2
  exit 1
fi

if [ ! -d node_modules/electron ]; then
  echo "A instalar dependencias (electron)..."
  npm install --no-audit --no-fund
fi

# Bibliotecas GUI do Electron em distros minimalistas (Debian/Ubuntu server, WSL2, etc.)
if command -v apt-get >/dev/null 2>&1 && ! ldconfig -p 2>/dev/null | grep -q libgtk-3.so; then
  echo "A instalar bibliotecas graficas do Electron (libgtk-3, libnss3, ...)..."
  echo "(pode pedir a tua password para o sudo)"
  sudo apt-get update -y
  sudo apt-get install -y --no-install-recommends \
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libasound2 \
    libgbm1 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxrandr2 libxfixes3 libcups2 libpango-1.0-0 libcairo2 \
    xdg-utils libsecret-1-0
fi

exec npx electron . "$@"
