// The playtest review screen: how every level is going, a top-down heatmap of where people went and
// what they did, and a replay of any attempt.
import { G } from './state.js';
import { loadSessions, importSessions, clearLocalSessions, levelHash } from './sessions.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtTime = ticks => { const s = Math.round(ticks / 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const count = (s, ...types) => s.events.filter(e => types.includes(e.type)).length;

let sessions = [], selected = null, api = null;

export function initReview(watch) {
  api = { watch };
  $('rv-close').onclick = closeReview;
  $('rv-export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(sessions)], { type: 'application/json' }));
    a.download = `lightleak-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('rv-import').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { importSessions(JSON.parse(await f.text())); } catch (err) { alert(`That file isn't a sessions export: ${err.message}`); }
    e.target.value = '';
    openReview();
  };
  $('rv-clear').onclick = () => { if (confirm('Forget the sessions stored in this browser?')) { clearLocalSessions(); openReview(); } };
}

export async function openReview(level) {
  $('review').hidden = false;
  sessions = (await loadSessions()).filter(s => s && s.level && G.defs[s.level]);
  if (level) selected = level;
  renderTable();
  renderLevel();
}
export function closeReview() { $('review').hidden = true; }

// Long gaps with no progress: where someone was stuck, and for how long.
function stalls(s) {
  const out = [], marks = [0, ...s.events.filter(e => ['photo', 'negative', 'develop', 'dissolve', 'plate'].includes(e.type)).map(e => e.t), s.ticks];
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i] - marks[i - 1];
    if (gap > 45 * 60) {
      const mid = Math.floor((marks[i] + marks[i - 1]) / 2 / 30);
      const p = s.track[Math.min(mid, s.track.length - 1)];
      if (p) out.push({ x: p[0], z: p[1], secs: Math.round(gap / 60) });
    }
  }
  return out;
}

function renderTable() {
  const rows = G.order.map((id, i) => {
    const list = sessions.filter(s => s.level === id);
    const done = list.filter(s => s.outcome === 'finished');
    const st = list.flatMap(stalls);
    return `<tr data-id="${id}" class="${id === selected ? 'sel' : ''}">
      <td>${String(i + 1).padStart(2, '0')} ${esc(G.defs[id].name)}</td><td>${list.length}</td>
      <td>${list.length ? Math.round(done.length / list.length * 100) + '%' : '–'}</td>
      <td>${done.length ? fmtTime(median(done.map(s => s.ticks))) : '–'}</td>
      <td>${list.reduce((n, s) => n + count(s, 'undo'), 0)}</td>
      <td>${list.reduce((n, s) => n + count(s, 'fall', 'overexposed'), 0)}</td>
      <td>${list.filter(s => s.outcome === 'restart').length}</td>
      <td class="${st.length ? 'warn' : ''}">${st.length}</td></tr>`;
  }).join('');
  $('rv-table').innerHTML = `<tr><th>Room</th><th>Tries</th><th>Finished</th><th>Median time</th><th>Undos</th><th>Falls</th><th>Restarts</th><th>Stuck</th></tr>${rows}`;
  $('rv-table').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { selected = tr.dataset.id; renderTable(); renderLevel(); });
  $('rv-total').textContent = `${sessions.length} recorded attempt${sessions.length === 1 ? '' : 's'}`;
}

function renderLevel() {
  const canvas = $('rv-map'), g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  $('rv-sessions').innerHTML = '';
  if (!selected) { $('rv-title').textContent = 'Pick a room'; return; }
  const def = G.defs[selected], r = def.room;
  $('rv-title').textContent = def.name;
  // fit the room (and its corridor) into the canvas, top-down, north up
  const pad = 20, x0 = r.x0 - 1, x1 = r.x1 + 1, z0 = r.z0 - 6, z1 = r.z1 + 1;
  const s = Math.min((canvas.width - pad * 2) / (x1 - x0), (canvas.height - pad * 2) / (z1 - z0));
  const ox = pad + ((canvas.width - pad * 2) - (x1 - x0) * s) / 2, oz = pad;
  const X = x => ox + (x - x0) * s, Z = z => oz + (z - z0) * s;
  g.fillStyle = '#1d1916'; g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
  const d = r.door, dw = d.w || 2;
  g.fillRect(X(d.x - dw / 2 - 0.5), Z(r.z0 - 4.5), (dw + 1) * s, 4.5 * s);
  for (const b of def.blocks || []) {
    const col = b.mat === 'glass' ? '#7fa3a044' : b.mat === 'emulsion' ? '#8a1f12cc' : '#5a5046cc';
    g.fillStyle = col; g.fillRect(X(b.min[0]), Z(b.min[2]), (b.max[0] - b.min[0]) * s, (b.max[2] - b.min[2]) * s);
  }
  g.strokeStyle = '#8fc27a'; g.lineWidth = 2;
  for (const p of def.plates || []) g.strokeRect(X(p.pos[0] - p.size[0] / 2), Z(p.pos[2] - p.size[1] / 2), p.size[0] * s, p.size[1] * s);
  g.fillStyle = '#9a6b3c';
  for (const p of def.props || []) g.fillRect(X(p.pos[0] - p.size[0] / 2), Z(p.pos[2] - p.size[2] / 2), p.size[0] * s, p.size[2] * s);

  const list = sessions.filter(x => x.level === selected);
  // heat: where people spent their time
  const cell = 0.5, heat = new Map();
  for (const x of list) for (const [px, pz] of x.track) { const k = `${Math.floor(px / cell)},${Math.floor(pz / cell)}`; heat.set(k, (heat.get(k) || 0) + 1); }
  const top = Math.max(1, ...heat.values());
  for (const [k, v] of heat) {
    const [cx, cz] = k.split(',').map(Number);
    g.fillStyle = `rgba(240,106,79,${0.08 + 0.6 * v / top})`;
    g.fillRect(X(cx * cell), Z(cz * cell), cell * s + 1, cell * s + 1);
  }
  // trails
  g.lineWidth = 1;
  for (const x of list) {
    g.strokeStyle = x.outcome === 'finished' ? '#efe6d244' : '#e0574a55';
    g.beginPath();
    x.track.forEach(([px, pz], i) => (i ? g.lineTo(X(px), Z(pz)) : g.moveTo(X(px), Z(pz))));
    g.stroke();
  }
  // events and stalls
  const mark = { photo: ['#efe6d2', '●'], negative: ['#d98a4f', '●'], develop: ['#8fc27a', '■'], dissolve: ['#f06a4f', '■'], undo: ['#e6c44a', '↺'], fall: ['#e0574a', '✕'], overexposed: ['#fff', '✕'], restart: ['#e0574a', 'R'] };
  g.font = '12px ui-monospace, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const x of list) for (const e of x.events) { const m = mark[e.type]; if (m) { g.fillStyle = m[0]; g.fillText(m[1], X(e.x), Z(e.z)); } }
  for (const st of list.flatMap(stalls)) {
    g.strokeStyle = '#e6c44a'; g.lineWidth = 2; g.beginPath(); g.arc(X(st.x), Z(st.z), 10, 0, 7); g.stroke();
    g.fillStyle = '#e6c44a'; g.fillText(`${st.secs}s`, X(st.x), Z(st.z) - 16);
  }

  const hash = levelHash(def);
  $('rv-sessions').innerHTML = list.slice().reverse().map(x => `<div class="rv-row">
      <span class="${x.outcome === 'finished' ? 'ok' : 'bad'}">${esc(x.outcome)}</span>
      <span>${new Date(x.started).toLocaleString()}</span><span>${fmtTime(x.ticks)}</span>
      <span>${count(x, 'photo', 'negative')} shots · ${count(x, 'develop', 'dissolve')} developed · ${count(x, 'undo')} undos</span>
      <button class="btn ghost" data-watch="${x.id}">Watch${x.hash !== hash ? ' (level changed)' : ''}</button></div>`).join('') || '<div style="color:var(--dim)">No attempts recorded for this room yet.</div>';
  $('rv-sessions').querySelectorAll('[data-watch]').forEach(b => b.onclick = () => {
    const x = sessions.find(y => y.id === b.dataset.watch);
    closeReview();
    api.watch({ ...G.defs[x.level], solution: { demo: x.demo } }, () => openReview(x.level));
  });
}
