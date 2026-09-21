'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let server = null;
let win = null;
let quitting = false;

// Log de diagnostico: se a app morrer, fica registado aqui.
const logFile = path.join(__dirname, 'debug.log');
function logErr(...args) {
  try {
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + args.join(' ') + '\n');
  } catch (e) {}
}

process.on('uncaughtException', (e) => {
  logErr('uncaughtException:', e && (e.stack || e.message));
});
process.on('unhandledRejection', (e) => {
  logErr('unhandledRejection:', e && (e.stack || e.message || String(e)));
});

function createWindow(port) {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 460,
    minHeight: 620,
    title: 'NEO//IPTV',
    backgroundColor: '#07070f',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('http://127.0.0.1:' + port + '/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function cleanup() {
  if (quitting) return;
  quitting = true;
  if (server) { try { server.close(); } catch (e) {} }
  app.quit();
}

app.whenReady().then(() => {
  try {
    const { createServer } = require('./server.js');
    server = createServer(path.join(__dirname, 'web'));
  } catch (e) {
    logErr('erro ao criar servidor:', e && (e.stack || e.message));
    app.quit();
    return;
  }
  // Porta fixa: manter a mesma origem entre sessoes para o localStorage
  // (fontes guardadas) continuar valido.
  const FIXED_PORT = 8096;
  let listening = false;
  let timer = null;
  const tryListen = () => {
    if (listening || quitting) return;
    try {
      server.listen(FIXED_PORT, '127.0.0.1');
    } catch (e) {
      // listen() pode lancar se ja estiver ativo; ignorar e tentar de novo
      logErr('listen():', e && e.message);
    }
  };
  server.on('listening', () => {
    listening = true;
    if (timer) { clearInterval(timer); timer = null; }
    createWindow(server.address().port);
  });
  server.on('error', (e) => {
    // porta ocupada -> tenta de novo em ciclo ate conseguir
    logErr('server error:', e && e.message);
  });
  timer = setInterval(tryListen, 1500);
  tryListen();
  app.on('activate', () => {
    if (!win && listening && server.address()) {
      createWindow(server.address().port);
    }
  });
});

app.on('window-all-closed', () => {
  cleanup();
});
