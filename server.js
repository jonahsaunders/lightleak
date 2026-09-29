'use strict';
// Lightleak's local server: serves the game as static files.
//   node server.js         play at http://127.0.0.1:5178
//   node server.js --dev   also lets the in-game editor save levels straight into levels/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const LEVELS = path.join(ROOT, 'levels');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
const PUBLIC = ['index.html', 'js/', 'vendor/', 'levels/', 'desktop/icon.png'];

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function handler(dev) {
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';

    if (url.pathname === '/api/dev') return send(res, 200, JSON.stringify({ dev }), TYPES['.json']);

    // Editor saves: PUT /api/levels/<id> with the level JSON. Only in --dev, only from this computer.
    const m = url.pathname.match(/^\/api\/levels\/([a-z0-9-]{1,40})$/);
    if (m && req.method === 'PUT') {
      if (!dev) return send(res, 403, 'Saving levels needs the dev server (npm run dev).');
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        try {
          const level = JSON.parse(body);
          fs.writeFileSync(path.join(LEVELS, `${m[1]}.json`), JSON.stringify(level, null, 2) + '\n');
          const indexFile = path.join(LEVELS, 'index.json');
          const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
          if (!index.chapters.some(c => c.levels.includes(m[1]))) {
            let custom = index.chapters.find(c => c.custom);
            if (!custom) index.chapters.push(custom = { name: 'Custom', custom: true, levels: [] });
            custom.levels.push(m[1]);
            fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
          }
          send(res, 200, 'saved');
        } catch (e) { send(res, 400, String(e.message || e)); }
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (!PUBLIC.some(p => rel === p || (p.endsWith('/') && rel.startsWith(p)))) return send(res, 404, 'Not found');
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  };
}

function start({ port = 5178, host = '127.0.0.1', dev = false } = {}) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler(dev));
    srv.once('error', reject);
    srv.listen(port, host, () => resolve({ port: srv.address().port, close: () => srv.close() }));
  });
}

module.exports = { start };

if (require.main === module) {
  const dev = process.argv.includes('--dev');
  const port = Number(process.env.PORT) || 5178;
  start({ port, dev }).then(s => console.log(`Lightleak at http://127.0.0.1:${s.port}/${dev ? '  (dev: the editor can save levels)' : ''}`));
}
