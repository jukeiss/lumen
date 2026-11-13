// Lumen desktop: starts the local Lumen server on a free port, then opens it in a window.
// Notes are stored as plain .md files in ~/Documents/Lumen.
'use strict';
const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function waitReady(url, tries = 100) {
  return new Promise((resolve, reject) => {
    const tick = left => http.get(url, res => { res.resume(); resolve(); })
      .on('error', () => (left <= 0 ? reject(new Error('server did not start')) : setTimeout(() => tick(left - 1), 100)));
    tick(tries);
  });
}

app.whenReady().then(async () => {
  const vault = path.join(app.getPath('documents'), 'Lumen');
  fs.mkdirSync(vault, { recursive: true });
  const port = await freePort();
  // server.js reads the vault folder from argv[2] and the port from PORT, then starts listening.
  process.argv[2] = vault;
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  require(path.join(__dirname, 'app', 'server.js'));
  const url = `http://127.0.0.1:${port}/`;
  await waitReady(url);

  const win = new BrowserWindow({
    width: 1200, height: 800, title: 'Lumen',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
  win.loadURL(url);
});

app.on('window-all-closed', () => app.quit());
