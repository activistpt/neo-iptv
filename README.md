# NEO//IPTV

Player IPTV desktop (Electron) com grelha de canais ao vivo, filmes e séries a partir de listas M3U/Xtream. Funciona em **Windows** e **Linux**.

![tech](https://img.shields.io/badge/Electron-43-blue) ![tech](https://img.shields.io/badge/Node-%3E%3D18-green)

## Funcionalidades

- 📺 **Canais ao vivo** com motor híbrido: TS push (1 ligação contínua) ou HLS, com troca automática e memória por painel
- 🔁 **Fallback de variantes**: se "RTP 1 FHD" não abrir, salta sozinho para HD → SD do mesmo canal (evita variantes HEVC/4K que o browser não decodifica)
- ⏳ **Retries persistentes com pacing** — atravessa as janelas de indisponibilidade dos painéis sem martelar os limites de ligações da conta
- 🔒 **Aviso de limite de ligações** quando o painel responde 403 (conta usada noutro dispositivo)
- 🗗 **Mini-janela redimensionável e arrastável** — vê o canal enquanto navegas na lista; clicar noutro canal troca sem cortar o vídeo
- 🎬 Filmes e séries com categorias, temporadas e episódios
- 🔎 Pesquisa instantânea, PiP, ecrã inteiro, proxy interno com cache de protocolo (HTTPS morto → HTTP direto)

## Estrutura

```
├── main.js               # processo Electron (janela + servidor interno)
├── server.js             # servidor HTTP local (:8096) com proxy de streams
├── web/                  # frontend (index.html + hls.js + mpegts.js)
├── run-linux.sh          # lançador para Linux
└── sources.example.json  # exemplo de configuração de listas
```

As fontes (listas) são guardadas na app (`sources.json`, criado automaticamente ao adicionar a primeira lista em **+ FONTE**) — ou copia `sources.example.json`.

## Correr no Windows

```
run-windows.bat
```
(ou abrir `NeoIPTV.exe` de um pacote compilado)

## Correr em Linux

Requisitos: Node.js ≥ 18 e npm.

```bash
git clone https://github.com/TEU-UTILIZADOR/neo-iptv.git
cd neo-iptv
./run-linux.sh
```

O script instala `node_modules` e, se faltarem, as bibliotecas gráficas do Electron (`libgtk-3`, `libnss3`, …) em Debian/Ubuntu.

## Compilar pacotes

```bash
npm install
# Windows:
npm run pack:win
# Linux:
npm run pack:linux
```

O resultado fica em `dist/NeoIPTV-win32-x64/` ou `dist/NeoIPTV-linux-x64/`.

## Porta

A app serve a UI em `http://127.0.0.1:8096` (porta fixa para manter as fontes guardadas entre sessões). Para abrir fora da janela Electron: `http://127.0.0.1:8096/index.html` no browser.

## Licença
https://buymeacoffee.com/ptlegion
Powered by: Ø̴Ʉ̴Ŧ̴Ş̴ł̴Đ̴Ɇ̴Ɍ̴
MIT
