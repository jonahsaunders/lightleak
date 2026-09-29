// Boot, the fixed-step loop, input, menus and level flow.
import RAPIER from '../vendor/rapier.mjs';
import { G, emit } from './state.js';
import { DT, CAMERA, PLAYER } from './config.js';
import { initMaterials } from './materials.js';
import { loadLevel, stepWorld, playerInExit, restore, pushUndo, snapshot } from './level.js';
import { P, stepPlayer, eyePosition } from './player.js';
import { takePhoto, develop, discard } from './photo.js';
import { initHUD, toast, flash, showTitle, updateRoll, updateAim, chapterOf } from './hud.js';
import { SFX, unlockAudio } from './audio.js';
import { runTests, Driver } from './driver.js';
import { Editor } from './editor.js';

const THREE = window.THREE;
const $ = id => document.getElementById(id);
const V3 = THREE.Vector3;

// ---------- renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0908);
scene.fog = new THREE.Fog(0x0b0908, 28, 70);
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 10, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);
Object.assign(G, { renderer, scene, camera });

function resize() {
  if (!innerWidth || !innerHeight) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- progress ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('lightleak.v2') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('lightleak.v2', JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const progress = Object.assign({ done: {} }, store.get());
const unlocked = id => { const i = G.order.indexOf(id); return i <= 0 || progress.done[G.order[i - 1]] || progress.done[id]; };
const nextUp = () => G.order.find(id => !progress.done[id]) || G.order[0];

// ---------- input ----------
const live = { keys: new Set(), yaw: 0, pitch: 0, aimHeld: false, actions: [] };
let locked = false;
let driver = null;      // when set, it supplies input instead of the keyboard and mouse
let recording = null;   // input recorded for a solution demo

const q4 = v => Math.round(v * 1e4) / 1e4;
function liveInput() {
  const k = live.keys;
  return {
    f: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
    r: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
    jump: k.has('Space'), yaw: q4(live.yaw), pitch: q4(live.pitch), aim: live.aimHeld,
    actions: live.actions.splice(0),
  };
}
function act(a) { if (G.mode === 'playing' && !driver) live.actions.push(a); }

addEventListener('keydown', e => {
  if (G.mode === 'editor') return;
  if (G.mode !== 'playing') return;
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  live.keys.add(e.code);
  if (e.repeat) return;
  const map = { KeyF: 'aimtoggle', KeyG: 'frame:cycle', KeyR: 'reset', KeyX: 'discard', KeyZ: 'undo', KeyT: 'film', KeyQ: 'rotate:-1', KeyE: 'rotate:1', Digit1: 'select:0', Digit2: 'select:1', Digit3: 'select:2' };
  if (map[e.code]) act(map[e.code]);
  if (e.code === 'F2' && editor) { e.preventDefault(); e.stopImmediatePropagation(); openEditor(); }
});
addEventListener('keyup', e => live.keys.delete(e.code));
addEventListener('blur', () => { live.keys.clear(); live.aimHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousedown', e => {
  if (G.mode !== 'playing' || !locked) return;
  if (e.button === 2) live.aimHeld = true;
  if (e.button === 0) act('click');
});
addEventListener('mouseup', e => { if (e.button === 2) live.aimHeld = false; });
addEventListener('mousemove', e => {
  if (!locked || G.mode !== 'playing') return;
  const s = 0.0022 * (camera.fov / CAMERA.fov) * sensitivity;
  live.yaw -= e.movementX * s;
  live.pitch = THREE.MathUtils.clamp(live.pitch - e.movementY * s, -1.5, 1.5);
});
// Wheel up widens the frame, down narrows it. Deltas are summed so a trackpad swipe moves one
// step per notch's worth of scrolling instead of racing to the end.
let wheelAcc = 0;
addEventListener('wheel', e => {
  if (G.mode !== 'playing' || !locked) return;
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
  if (Math.abs(wheelAcc) < 40) return;
  const d = wheelAcc > 0 ? 1 : -1;
  wheelAcc = 0;
  if (G.aim) act(`frame:${-d}`);
  else if (G.roll.length) act(`cycle:${d}`);
}, { passive: true });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && G.mode === 'playing' && !driver) pause();
});
function lock() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* stays unlocked */ } }

let sensitivity = 1;
try { sensitivity = Number(localStorage.getItem('lightleak.sens')) || 1; } catch (e) { /* default */ }

// ---------- the tick ----------
function syncCamera(alpha = 1) {
  eyePosition(camera.position, alpha);
  camera.rotation.set(P.pitch, P.yaw, 0);
  camera.updateMatrixWorld();
}

function handle(a) {
  const L = G.L;
  const [name, arg] = a.split(':');
  const n = Number(arg);
  if (name === 'click') { if (G.aim) takePhoto(); else if (G.selected >= 0) develop(); }
  else if (name === 'aimtoggle') { G.aimToggle = !G.aimToggle; if (G.aimToggle) G.selected = -1; emit('rollChanged'); }
  else if (name === 'select') { G.selected = n >= G.roll.length || G.selected === n ? -1 : n; G.aimToggle = false; emit('rollChanged'); }
  else if (name === 'cycle') { const k = G.roll.length; G.selected = G.selected < 0 ? (n > 0 ? 0 : k - 1) : (G.selected + n + k) % k; G.aimToggle = false; emit('rollChanged'); }
  else if (name === 'rotate') { const p = G.roll[G.selected]; if (p) { p.rot = (p.rot + n + 4) % 4; if (!G.headless) SFX.click(); emit('rollChanged'); } }
  else if (name === 'discard') discard();
  else if (name === 'frame') {
    const last = CAMERA.frames.length - 1;
    if (!L.def.wide) toast('This camera frames one thing at a time until chapter 2.');
    else {
      const next = arg === 'cycle' ? (G.frameIdx + 1) % (last + 1) : THREE.MathUtils.clamp(G.frameIdx + n, 0, last);
      if (next !== G.frameIdx && !G.headless) SFX.click();
      G.frameIdx = next;
    }
  }
  else if (name === 'film') {
    const other = G.filmMode === 'pos' ? 'neg' : 'pos';
    if ((L.def.film?.[other] ?? 0) > 0) { G.filmMode = other; if (!G.headless) SFX.click(); emit('rollChanged'); }
  } else if (name === 'undo') {
    const s = G.undo.pop();
    if (s) { restore(s); G.checkpoint = snapshot(); if (!G.headless) SFX.undo(); toast('Undone.'); live.yaw = P.yaw; live.pitch = P.pitch; }
    else toast('Nothing to undo.');
  } else if (name === 'reset') { startLevel(L.def.id, { quiet: true }); toast('Frame restarted.'); }
}

export function tick(input) {
  const L = G.L;
  if (!L || L.finished) return;
  P.yaw = input.yaw; P.pitch = input.pitch;
  G.aim = input.aim || G.aimToggle;
  const fov = G.aim ? CAMERA.aimFov : CAMERA.fov;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, DT * 14); camera.updateProjectionMatrix(); }
  syncCamera();
  if (recording) record(input);
  for (const a of input.actions) { handle(a); if (G.L !== L) return; }
  stepPlayer(input);
  stepWorld();
  G.tick++;
  if (playerInExit()) finishLevel();
  else if (P.pos.y < L.killY) {
    // back to just after your last shot or development, with the photos you had then
    if (!G.headless) SFX.fall();
    restore(G.checkpoint);
    toast(G.undo.length ? 'You fell. Back to your last shot.' : 'You fell. Back to the start.');
    live.yaw = P.yaw; live.pitch = P.pitch;
  }
}

// Recorded input for a solution demo: one entry per tick where something changed.
let lastRec = null;
function record(input) {
  const e = { t: G.tick };
  const cur = { f: input.f, r: input.r, j: input.jump ? 1 : 0, y: input.yaw, p: input.pitch, a: input.aim ? 1 : 0 };
  let changed = input.actions.length > 0;
  for (const k in cur) if (!lastRec || lastRec[k] !== cur[k]) { e[k] = cur[k]; changed = true; }
  if (input.actions.length) e.x = input.actions.slice();
  lastRec = cur;
  if (changed) recording.push(e);
}

// ---------- level flow ----------
function startLevel(id, { quiet = false } = {}) {
  const def = G.defs[id];
  loadLevel(def);
  live.yaw = P.yaw; live.pitch = P.pitch;
  camera.fov = CAMERA.fov; camera.updateProjectionMatrix();
  syncCamera();
  if (!quiet) showTitle(); else updateRoll();
  progress.last = id; store.set(progress);
}

function finishLevel() {
  const L = G.L;
  L.finished = true;
  if (G.headless) return;
  SFX.done();
  if (L.def.id && G.order.includes(L.def.id)) { progress.done[L.def.id] = true; store.set(progress); }
  if (recording && editorReturn) editorReturn.solved(recording);
  $('fade').classList.add('on');
  setTimeout(() => {
    $('fade').classList.remove('on');
    if (editorReturn) { const r = editorReturn; editorReturn = null; recording = null; r.back(); return; }
    if (driver) { driver = null; showMenu('That was the stored solution.'); return; }
    const i = G.order.indexOf(L.def.id);
    const next = G.order[i + 1];
    if (next) {
      const ch = chapterOf(next);
      startLevel(next);
      if (chapterOf(L.def.id) !== ch) toast(`Chapter: ${ch.name}`);
    } else {
      G.mode = 'done';
      document.exitPointerLock?.();
      showMenu('Roll developed. That is every frame so far — the editor (F2) can make more.');
    }
  }, 700);
}

// ---------- menus ----------
function showMenu(msg) {
  if (G.mode !== 'done') G.mode = G.L && !G.L.finished && G.mode === 'playing' ? 'paused' : G.mode === 'paused' ? 'paused' : 'title';
  live.keys.clear(); live.aimHeld = false;
  $('menu').hidden = false; $('hud').hidden = true;
  $('menu-msg').hidden = !msg; $('menu-msg').textContent = msg || '';
  const paused = G.mode === 'paused';
  $('play').textContent = paused ? 'Resume' : Object.keys(progress.done).length ? 'Continue' : 'Start';
  $('restart').hidden = !paused;
  $('to-editor').hidden = !paused;
  const list = $('chapters');
  list.innerHTML = '';
  let n = 0;
  for (const ch of G.chapters) {
    const box = document.createElement('div'); box.className = 'chapter';
    box.innerHTML = `<div class="label">${ch.name.toUpperCase()}</div>`;
    const row = document.createElement('div'); row.className = 'row';
    for (const id of ch.levels) {
      n++;
      const b = document.createElement('button');
      const ok = unlocked(id) || ch.custom;
      b.className = 'lvl' + (progress.done[id] ? ' done' : '');
      b.disabled = !ok;
      b.innerHTML = `<span class="n">${ch.custom ? '·' : n}</span>${G.defs[id].name}`;
      b.onclick = () => begin(id);
      row.appendChild(b);
    }
    box.appendChild(row);
    list.appendChild(box);
  }
}
function pause() { G.mode = 'paused'; showMenu(); }
function begin(id) {
  unlockAudio();
  $('menu').hidden = true; $('hud').hidden = false;
  if (id) startLevel(id);
  G.mode = 'playing';
  lock();
}
$('play').onclick = () => (G.mode === 'paused' ? begin() : begin(nextUp()));
$('restart').onclick = () => begin(G.L.def.id);
$('to-editor').onclick = () => openEditor();
$('sens').value = sensitivity;
$('sens').oninput = e => { sensitivity = Number(e.target.value); try { localStorage.setItem('lightleak.sens', sensitivity); } catch (err) { /* ignore */ } };

// ---------- editor hookup ----------
let editor = null, editorReturn = null;
function openEditor() {
  document.exitPointerLock?.();
  G.mode = 'editor';
  $('menu').hidden = true; $('hud').hidden = true;
  editor.open(G.L ? G.L.def : G.defs[G.order[0]]);
}
const editorApi = {
  // Play the level being edited. `record` captures the input as a solution.
  playtest(def, { record = false, back, solved }) {
    G.defs[def.id] = def;
    editorReturn = { back, solved };
    recording = record ? [] : null; lastRec = null;
    G.mode = 'playing';
    $('hud').hidden = false;
    startLevel(def.id);
    G.tick = 0;
    lock();
  },
  // Watch a level's stored solution play itself.
  watch(def, back) {
    G.defs[def.id] = def;
    editorReturn = { back, solved() {} };
    G.mode = 'playing';
    $('hud').hidden = false;
    startLevel(def.id);
    driver = new Driver(def, { tick: G.tick });
  },
  leave() { G.mode = 'title'; showMenu(); },
};

// ---------- loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (Math.abs(camera.aspect - innerWidth / innerHeight) > 1e-3) resize();
  if (G.mode === 'editor') { editor.frame(dt); renderer.render(scene, camera); return; }
  if (G.mode === 'playing' && G.L) {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      let input;
      if (driver) {
        input = driver.next();
        if (!input) { const why = driver.error; driver = null; if (editorReturn) { const r = editorReturn; editorReturn = null; r.back(why); } break; }
      } else input = liveInput();
      tick(input);
      if (G.mode !== 'playing') break;
    }
    syncCamera(Math.min(1, acc / DT));
    updateAim();
  }
  renderer.render(scene, camera);
  if (G.pendingThumb) finishThumb();
}

// Crop the viewfinder out of the frame that was just drawn (the buffer is still intact).
const thumb = document.createElement('canvas');
thumb.width = 224; thumb.height = 168;
function finishThumb() {
  const photo = G.pendingThumb;
  G.pendingThumb = null;
  const k = renderer.getPixelRatio();
  const h = innerHeight * 0.72, w = h * 4 / 3;
  const g = thumb.getContext('2d');
  g.filter = photo.neg ? 'invert(1) sepia(.2) contrast(1.2)' : 'sepia(.35) contrast(1.12) saturate(.9)';
  g.drawImage(renderer.domElement, (innerWidth - w) / 2 * k, (innerHeight - h) / 2 * k, w * k, h * k, 0, 0, thumb.width, thumb.height);
  g.filter = 'none';
  photo.img = thumb.toDataURL('image/jpeg', 0.85);
  updateRoll();
}

// ---------- boot ----------
async function boot() {
  resize();
  initMaterials(renderer);
  initHUD();
  await RAPIER.init();
  G.R = RAPIER;
  const index = await fetch('levels/index.json', { cache: 'no-store' }).then(r => r.json());
  G.chapters = index.chapters;
  const ids = index.chapters.flatMap(c => c.levels);
  const defs = await Promise.all(ids.map(id => fetch(`levels/${id}.json`, { cache: 'no-store' }).then(r => r.json())));
  ids.forEach((id, i) => { G.defs[id] = { ...defs[i], id }; });
  G.order = index.chapters.filter(c => !c.custom).flatMap(c => c.levels);
  G.hooks = { toast, flash, rollChanged: updateRoll, levelLoaded() { G.checkpoint = snapshot(); }, acted() { G.checkpoint = snapshot(); } };
  const dev = await fetch('api/dev').then(r => r.json()).then(j => j.dev).catch(() => false);
  editor = new Editor(editorApi, { dev });

  if (new URLSearchParams(location.search).has('test')) {
    $('menu').hidden = true;
    G.headless = true;
    const report = await runTests(tick);
    window.__testReport = report;
    $('test-report').hidden = false;
    $('test-report').textContent = report.results.map(r => `${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.ok ? r.seconds.toFixed(1) + 's' : r.why}`).join('\n') + `\n\n${report.passed} passed, ${report.failed} failed`;
    return;
  }
  startLevel(progress.last && G.defs[progress.last] ? progress.last : G.order[0], { quiet: true });
  showMenu();
  requestAnimationFrame(frame);
}
boot().catch(e => { console.error(e); $('menu-msg').hidden = false; $('menu-msg').textContent = `Couldn't start: ${e.message}`; });

// Handy for poking at the game from the dev console.
window.lightleak = { G, P, tick, startLevel, pushUndo, input: () => liveInput(), setDriver: d => { driver = d; }, look: (yaw, pitch) => { live.yaw = yaw; live.pitch = pitch; }, act, get editor() { return editor; } };
