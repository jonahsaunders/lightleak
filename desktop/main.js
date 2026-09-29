'use strict';
// Lightleak desktop app: serves the game from inside the app and shows it in its own window.
//
//   npm run desktop   run from source
//   npm test          run every level's solution in a hidden window and print the results
//   npm run dist      build the Windows installer and portable .exe into dist/
const { app, BrowserWindow, shell } = require('electron');
const { start } = require('../server.js');

const TEST = process.argv.includes('--test');
const SHOTS = process.argv.includes('--shots'); // stage and capture the README screenshots into docs/
let win = null, srv = null;

async function boot() {
  srv = await start({ port: 0 });
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: 'Lightleak', backgroundColor: '#120f0d', autoHideMenuBar: true, show: !TEST && !SHOTS,
    ...(SHOTS ? { width: 1280, height: 720, useContentSize: true } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: SHOTS },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${srv.port}/`)) e.preventDefault(); });

  await win.loadURL(`http://127.0.0.1:${srv.port}/${TEST ? '?test' : SHOTS ? '?shots' : ''}`);

  if (SHOTS) {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..'), out = path.join(root, 'docs', 'screenshots');
    fs.mkdirSync(out, { recursive: true });
    win.webContents.setFrameRate(30);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 60 && !(await win.webContents.executeJavaScript('!!window.__stage')); i++) await wait(500);
    // playtest data for the review screenshot: whatever is in sessions/
    const dir = path.join(root, 'sessions');
    const sessions = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
    const names = await win.webContents.executeJavaScript('window.__shotNames');
    // warm up: the first capture after load can be a stale frame
    await win.webContents.executeJavaScript(`window.__stage('daylight')`);
    await wait(2500);
    for (const name of names) {
      await win.webContents.executeJavaScript(`window.__stage(${JSON.stringify(name)}, ${name === 'review' ? JSON.stringify(sessions) : 'null'})`);
      await wait(2200);
      win.webContents.invalidate();
      await wait(300);
      const img = await win.webContents.capturePage();
      const file = name === 'banner' ? path.join(root, 'docs', 'banner.jpg') : path.join(out, `${name}.jpg`);
      fs.writeFileSync(file, img.toJPEG(88));
      console.log(`${name.padEnd(12)} ${img.getSize().width}×${img.getSize().height} → ${path.relative(root, file)}`);
    }
    app.exit(0);
  }

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
