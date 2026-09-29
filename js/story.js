// The Curator's lines, played as subtitles with a chirping "voice", and the index cards on the walls.
//
// A level's `story` maps event names to lines. Each event plays once per visit:
//   start, photo, negative, develop, dissolve, plate, door, fall, undo,
//   zone:<name> (entering a box listed in story.zones), and the boss's own events.
// Lines are strings, or { who, text } for someone other than the Curator.
// None of this affects the simulation, so tests and recorded solutions ignore it.
import { G } from './state.js';
import { SFX } from './audio.js';
import { P } from './player.js';

const $ = id => document.getElementById(id);
const queue = [];
let current = null, shown = 0, hold = 0, fired = new Set(), wait = 0;

export function storyReset() {
  queue.length = 0; current = null; fired = new Set();
  wait = 1.6; // let the title card go first
  $('subtitle').hidden = true;
}

export function storyEvent(name) {
  if (G.headless || !G.L) return;
  const lines = G.L.def.story?.[name];
  if (!lines || fired.has(name)) return;
  fired.add(name);
  for (const l of lines) queue.push(typeof l === 'string' ? { who: 'CURATOR', text: l } : { who: 'CURATOR', ...l });
}

// Is anything still being said? (The epilogue waits for silence before the credits.)
export function storyBusy() { return !!current || queue.length > 0; }

// Per rendered frame.
export function storyFrame(dt) {
  if (!G.L) return;
  for (const z of G.L.def.story?.zones || []) {
    const [a, b] = [z.min, z.max];
    if (P.pos.x > a[0] && P.pos.x < b[0] && P.pos.y > a[1] - 0.5 && P.pos.y < b[1] && P.pos.z > a[2] && P.pos.z < b[2]) storyEvent(`zone:${z.name}`);
  }
  const box = $('subtitle');
  if (wait > 0) { wait -= dt; return; }
  if (!current) {
    if (!queue.length) { box.hidden = true; return; }
    current = queue.shift(); shown = 0; hold = 0;
    $('sub-who').textContent = current.who;
  }
  const before = Math.floor(shown);
  shown = Math.min(current.text.length, shown + dt * 42);
  const now = Math.floor(shown);
  if (current.who === 'CURATOR') for (let i = before; i < now; i++) if (i % 2 === 0 && /\w/.test(current.text[i])) SFX.voice(0.95 + ((i * 7) % 5) * 0.03);
  $('sub-text').textContent = current.text.slice(0, now);
  box.hidden = false;
  box.classList.toggle('other', current.who !== 'CURATOR');
  if (now >= current.text.length) {
    hold += dt;
    if (hold > 1.4 + current.text.length * 0.03) { current = null; wait = 0.25; }
  }
}
