// Playtest recording: every attempt at a level is kept, so you can see where people struggle.
//
// A session stores the level's input stream (it replays exactly: the simulation is deterministic),
// a position trail, and what happened when. With `npm run dev` sessions are saved as files in
// sessions/; otherwise in this browser, with export and import for passing them around.
import { G } from './state.js';
import { P } from './player.js';

const KEY = 'lightleak.sessions';
const LIMIT = 60;
let cur = null, last = null, dev = false;

export function setDev(d) { dev = d; }

// A fingerprint of the level's layout, so replays can warn if the level has changed since.
export function levelHash(def) {
  const { solution, mustFail, mustPass, story, hint, ...layout } = def;
  // Revision 2 includes buffered jumps; old recordings need an explicit changed warning.
  const s = JSON.stringify({ simulation: 2, layout });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function beginSession(def) {
  endSession('left');
  cur = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    level: def.id, hash: levelHash(def), started: new Date().toISOString(),
    ticks: 0, outcome: null, demo: [], events: [], track: [],
  };
  last = null;
}

// Called with each tick's input, before the tick runs.
export function recordInput(input) {
  if (!cur) return;
  const e = { t: cur.ticks };
  const now = { f: input.f, r: input.r, j: input.jump ? 1 : 0, y: input.yaw, p: input.pitch, a: input.aim ? 1 : 0 };
  let changed = input.actions.length > 0;
  for (const k in now) if (!last || last[k] !== now[k]) { e[k] = now[k]; changed = true; }
  if (input.actions.length) e.x = input.actions.slice();
  last = now;
  if (changed) cur.demo.push(e);
  if (cur.ticks % 30 === 0) cur.track.push([+P.pos.x.toFixed(2), +P.pos.z.toFixed(2), +P.pos.y.toFixed(2)]);
  cur.ticks++;
}

export function sessionEvent(type) {
  if (!cur) return;
  cur.events.push({ t: cur.ticks, type, x: +P.pos.x.toFixed(2), z: +P.pos.z.toFixed(2), y: +P.pos.y.toFixed(2) });
}

// outcome: finished | restart | left
export function endSession(outcome) {
  if (!cur) return;
  const s = cur; cur = null;
  if (s.ticks < 60) return; // under a second: not worth keeping
  s.outcome = outcome;
  save(s);
}

function save(s) {
  if (dev) {
    fetch(`api/sessions/${s.id}`, { method: 'PUT', body: JSON.stringify(s) })
      .then(r => { if (!r.ok) saveLocal(s); }).catch(() => saveLocal(s));
    return;
  }
  saveLocal(s);
}
function saveLocal(s) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    all.push(s);
    while (all.length > LIMIT) all.shift();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) { /* storage full or blocked: drop it */ }
}

export async function loadSessions() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { /* none */ }
  if (!dev) return local;
  try {
    const files = await fetch('api/sessions', { cache: 'no-store' }).then(r => r.json());
    return [...files, ...local];
  } catch (e) { return local; }
}

export function importSessions(list) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    const have = new Set(all.map(s => s.id));
    for (const s of list) if (s && s.id && !have.has(s.id)) all.push(s);
    localStorage.setItem(KEY, JSON.stringify(all.slice(-200)));
    return true;
  } catch (e) { return false; }
}
export function clearLocalSessions() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

