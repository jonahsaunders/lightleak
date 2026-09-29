'use strict';
// Lightleak desktop app: serves the game from inside the app and shows it in its own window.
//
//   npm run desktop   run from source
//   npm test          run every level's solution in a hidden window and print the results
//   npm run dist      build the Windows installer and portable .exe into dist/
const { app, BrowserWindow, shell } = require('electron');
const { start } = require('../server.js');

const TEST = process.argv.includes('--test');
let win = null, srv = null;

async function boot() {
  srv = await start({ port: 0 });
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: 'Lightleak', backgroundColor: '#120f0d', autoHideMenuBar: true, show: !TEST,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${srv.port}/`)) e.preventDefault(); });

  await win.loadURL(`http://127.0.0.1:${srv.port}/${TEST ? '?test' : ''}`);

  if (TEST) {
    const started = Date.now();
    let report = null;
    while (!report && Date.now() - started < 10 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 500));
      report = await win.webContents.executeJavaScript('window.__testReport ? JSON.stringify(window.__testReport) : null');
    }
    report = report ? JSON.parse(report) : { passed: 0, failed: 1, results: [{ id: '(runner)', ok: false, why: 'timed out' }] };
    for (const r of report.results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(16)} ${r.ok ? (r.note === 'no z-fighting' ? 'no z-fighting' : `${r.seconds.toFixed(1)}s of play`) : r.why}`);
    console.log(`\n${report.passed} passed, ${report.failed} failed`);
    app.exit(report.failed ? 1 : 0);
  }
}

app.whenReady().then(boot).catch(e => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (srv) srv.close(); });
