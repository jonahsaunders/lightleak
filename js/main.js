// Boot, the fixed-step loop, input, menus and level flow.
import RAPIER from '../vendor/rapier.mjs';
import { G, emit } from './state.js';
import { DT, CAMERA, PLAYER } from './config.js';
import { initMaterials, ENV } from './materials.js';
import { setQuality, getQuality, renderFrame, resizePost, setExposure } from './post.js';
import { loadLevel, stepWorld, playerInExit, restore, pushUndo, snapshot } from './level.js';
import { P, stepPlayer, eyePosition } from './player.js';
import { takePhoto, develop, discard } from './photo.js';
import { initHUD, toast, flash, showTitle, updateRoll, updateAim, chapterOf, filmSwitched } from './hud.js';
import { SFX, unlockAudio, startAmbience, stopAmbience } from './audio.js';
import { initViewmodel, stepViewmodel, vmSwitch } from './viewmodel.js';
import { stepFX, clearFX } from './fx.js';
import { setDev, beginSession, recordInput, sessionEvent, endSession } from './sessions.js';
import { initReview, openReview } from './review.js';
import { SET, applySettings, settingsPanel } from './settings.js';
import { runTests, Driver } from './driver.js';
import { Editor } from './editor.js';
import { storyReset, storyEvent, storyFrame } from './story.js';

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
  resizePost();
}
addEventListener('resize', resize);

// ---------- progress ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('lightleak.v2') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('lightleak.v2', JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const progress = Object.assign({ done: {} }, store.get());
// Every level is open from the start; finished ones are marked in the menu.
const unlocked = () => true;
const nextUp = () => G.order.find(id => !progress.done[id]) || G.order[0];

// ---------- input ----------
const live = { keys: new Set(), yaw: 0, pitch: 0, aimHeld: false, actions: [], pad: { lx: 0, ly: 0, jump: false, aim: false } };
let locked = false;
let driver = null;      // when set, it supplies input instead of the keyboard and mouse
let recording = null;   // input recorded for a solution demo

const q4 = v => Math.round(v * 1e4) / 1e4;
function liveInput() {
  const k = live.keys, pad = live.pad;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - pad.ly, r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + pad.lx;
  return {
    f: q4(THREE.MathUtils.clamp(f, -1, 1)), r: q4(THREE.MathUtils.clamp(r, -1, 1)),
    jump: k.has('Space') || pad.jump, yaw: q4(live.yaw), pitch: q4(live.pitch), aim: live.aimHeld || pad.aim,
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
  const s = 0.0022 * (camera.fov / SET.fov) * SET.sens;
  live.yaw -= e.movementX * s;
  live.pitch = THREE.MathUtils.clamp(live.pitch - e.movementY * s * (SET.invertY ? -1 : 1), -1.5, 1.5);
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
// Gamepad (standard mapping): polled each frame, feeding the same input as keyboard and mouse.
const padPrev = [];
function pollGamepad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find(p => p && p.connected);
  const pad = live.pad;
  if (!gp) { pad.lx = pad.ly = 0; pad.jump = pad.aim = false; return; }
  const dz = v => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
  const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const edge = i => { const now = pressed(i), was = padPrev[i]; padPrev[i] = now; return now && !was; };
  if (G.mode !== 'playing') {
    if (edge(0) && !$('menu').hidden) $('play').click();
    for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = pressed(i);
    return;
  }
  pad.lx = dz(gp.axes[0] || 0); pad.ly = dz(gp.axes[1] || 0);
  const lookX = dz(gp.axes[2] || 0), lookY = dz(gp.axes[3] || 0);
  const speed = 2.6 * SET.sens * (camera.fov / SET.fov);
  live.yaw -= lookX * Math.abs(lookX) * speed * dt;
  live.pitch = THREE.MathUtils.clamp(live.pitch - lookY * Math.abs(lookY) * speed * dt * (SET.invertY ? -1 : 1), -1.5, 1.5);
  pad.jump = pressed(0);
  pad.aim = !!(gp.buttons[6] && gp.buttons[6].value > 0.4);
  if (edge(7)) act('click');
  if (edge(1)) act('undo');
  if (edge(2)) act('film');
  if (edge(8)) act('discard');
  if (edge(4)) act(G.aim ? 'frame:-1' : 'cycle:-1');
  if (edge(5)) act(G.aim ? 'frame:1' : 'cycle:1');
  if (edge(12)) act('frame:1');
  if (edge(13)) act('frame:-1');
  if (edge(14)) act('rotate:-1');
  if (edge(15)) act('rotate:1');
  if (edge(9)) { document.exitPointerLock?.(); pause(); }
  for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = pressed(i);
}

function lock() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* stays unlocked */ } }



// ---------- the tick ----------
// The simulation uses a fixed field of view (so framing, and therefore replays, never depend on a
// setting); the picture uses yours, blending to the same zoom when the camera is raised.
G.logicFov = CAMERA.fov;
function syncCamera(alpha = 1) {
  const aimT = (CAMERA.fov - G.logicFov) / (CAMERA.fov - CAMERA.aimFov);
  const fov = G.headless ? G.logicFov : SET.fov + (CAMERA.aimFov - SET.fov) * aimT;
  if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
  eyePosition(camera.position, alpha);
  camera.rotation.set(P.pitch, P.yaw, 0);
  camera.updateMatrixWorld();
}

function handle(a) {
  const L = G.L;
  const [name, arg] = a.split(':');
  const n = Number(arg);
  if (name === 'click') {
    if (G.aim) { const neg = G.filmMode === 'neg'; if (takePhoto()) sessionEvent(neg ? 'negative' : 'photo'); }
    else if (G.selected >= 0) { const p = G.roll[G.selected]; if (develop()) sessionEvent(p.neg ? 'dissolve' : 'develop'); }
  }
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
    if ((L.def.film?.[other] ?? 0) > 0) { G.filmMode = other; if (!G.headless) { SFX.click(); filmSwitched(); vmSwitch(); } emit('rollChanged'); }
  } else if (name === 'undo') {
    const s = G.undo.pop();
    if (s) { restore(s); G.checkpoint = snapshot(); if (!G.headless) SFX.undo(); toast('Undone.'); storyEvent('undo'); sessionEvent('undo'); live.yaw = P.yaw; live.pitch = P.pitch; }
    else toast('Nothing to undo.');
  } else if (name === 'reset') {
    sessionEvent('restart'); endSession('restart');
    const id = L.def.id;
    restarts[id] = (restarts[id] || 0) + 1;
    startLevel(id, { quiet: true }); toast('Frame restarted.');
    if (restarts[id] >= 2) storyEvent('nudge');
  }
}

export function tick(input) {
  const L = G.L;
  if (!L || L.finished) return;
  P.yaw = input.yaw; P.pitch = input.pitch;
  G.aim = input.aim || G.aimToggle;
  const fov = G.aim ? CAMERA.aimFov : CAMERA.fov;
  if (Math.abs(G.logicFov - fov) > 0.01) G.logicFov += (fov - G.logicFov) * Math.min(1, DT * 14);
  syncCamera();
  if (recording) record(input);
  if (!driver && !G.headless) recordInput(input);
  for (const a of input.actions) { handle(a); if (G.L !== L) return; }
  stepPlayer(input);
  stepWorld();
  G.tick++;
  if (L.boss && L.boss.zapped) {
    // caught by the enlarger's flash: same as a fall, back to just after your last action
    L.boss.zapped = false;
    sessionEvent('overexposed');
    restore(G.checkpoint);
    toast('Overexposed. Back to your last shot.');
    live.yaw = P.yaw; live.pitch = P.pitch;
    return;
  }
  if (playerInExit()) finishLevel();
  else if (P.pos.y < L.killY) {
    // back to just after your last shot or development, with the photos you had then
    if (!G.headless) SFX.fall();
    storyEvent('fall');
    sessionEvent('fall');
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
  if (G.mode === 'playing' && !driver && !editorReturn && !G.headless) beginSession(def); else endSession('left');
  live.yaw = P.yaw; live.pitch = P.pitch;
  G.logicFov = CAMERA.fov;
  syncCamera();
  if (!quiet) showTitle(); else updateRoll();
  progress.last = id; store.set(progress);
}

function finishLevel() {
  const L = G.L;
  L.finished = true;
  if (G.headless) return;
  endSession('finished');
  SFX.done();
  if (L.def.id && G.order.includes(L.def.id)) { progress.done[L.def.id] = true; store.set(progress); }
  if (recording && editorReturn) editorReturn.solved(recording);
  // the room develops into a print of the moment you left it
  const story = !editorReturn && !driver;
  if (story) {
    // photograph the room you solved, from its doorway looking back in, without the camera in shot
    const r = L.def.room, d = r.door, vm = camera.children[0];
    const saved = { pos: camera.position.clone(), rot: camera.rotation.clone(), fov: camera.fov };
    camera.position.set(d.x, (d.y || 0) + 2.2, r.z0 + 0.6);
    camera.lookAt((r.x0 + r.x1) / 2, (d.y || 0) * 0.5 + 0.6, (r.z0 + r.z1) / 2 + 2);
    camera.fov = 70; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (vm) vm.visible = false;
    renderFrame();
    const i = G.order.indexOf(L.def.id);
    $('print-img').src = renderer.domElement.toDataURL('image/jpeg', 0.82);
    camera.position.copy(saved.pos); camera.rotation.copy(saved.rot); camera.fov = saved.fov; camera.updateProjectionMatrix();
    $('print-cap').textContent = `${i >= 0 ? `ROOM ${String(i + 1).padStart(2, '0')} · ` : ''}${L.def.name.toUpperCase()}`;
    const pr = $('print'); pr.hidden = false; pr.classList.remove('go'); void pr.offsetWidth; pr.classList.add('go');
    stopAmbience();
  }
  $('fade').classList.add('on');
  setTimeout(() => {
    $('fade').classList.remove('on');
    $('print').hidden = true;
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
      showEnding();
    }
  }, story ? 2300 : 700);
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
function pause() { G.mode = 'paused'; stopAmbience(); showMenu(); }
const ambienceFor = def => (def.bright ? 'outside' : def.boss ? 'enlarger' : 'archive');

// Footsteps, from how far you've walked on the ground; the surface underfoot picks the sound.
let stride = 0, leftFoot = false;
const restarts = {};
function footsteps(dt, speed) {
  if (!P.grounded || speed < 0.5) { stride = Math.min(stride, 0.45); return; }
  stride += speed * dt;
  if (stride < 0.62) return;
  stride = 0; leftFoot = !leftFoot;
  const R = G.R, L = G.L;
  const hit = L.world.castRay(new R.Ray({ x: P.pos.x, y: P.pos.y + 0.2, z: P.pos.z }, { x: 0, y: -1, z: 0 }), 0.5, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, P.body);
  const info = hit && L.colliders.get(hit.collider.handle);
  const surface = !info ? 'concrete' : info.kind === 'prop' ? info.ref.type : info.kind === 'glass' ? 'glass' : info.kind === 'plate' || info.kind === 'door' ? 'steel' : 'concrete';
  SFX.step(surface, leftFoot);
}
function showEnding() {
  stopAmbience();
  showMenu();
  $('menu').hidden = true;
  $('ending').hidden = false;
}
$('ending-close').onclick = () => { $('ending').hidden = true; showMenu(); };
function begin(id) {
  unlockAudio();
  $('menu').hidden = true; $('hud').hidden = false;
  G.mode = 'playing';
  if (id) startLevel(id);
  else if (G.L) startAmbience(ambienceFor(G.L.def));
  lock();
}
$('play').onclick = () => (G.mode === 'paused' ? begin() : begin(nextUp()));
$('restart').onclick = () => begin(G.L.def.id);
$('to-editor').onclick = () => openEditor();
$('to-review').onclick = () => openReview();
$('gfx').onchange = e => { setQuality(e.target.value); try { localStorage.setItem('lightleak.gfx', e.target.value); } catch (err) { /* ignore */ } };
settingsPanel($('settings-panel'));
applySettings();

// ---------- editor hookup ----------
let editor = null, editorReturn = null;
function openEditor() {
  document.exitPointerLock?.();
  stopAmbience();
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
let last = performance.now(), acc = 0, shake = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (Math.abs(camera.aspect - innerWidth / innerHeight) > 1e-3) resize();
  pollGamepad(dt);
  if (G.mode === 'editor') { editor.frame(dt); renderFrame(); return; }
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
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.3;
      camera.position.y += (Math.random() - 0.5) * shake * 0.3;
      shake = Math.max(0, shake - dt * 1.5);
    }
    updateAim();
    storyFrame(dt);
  }
  if (G.L) {
    for (const f of G.L.animate) f(dt);
    stepFX(dt);
    const speed = Math.hypot(P.vel.x, P.vel.z);
    stepViewmodel(dt, { moving: speed > 0.5, grounded: P.grounded, yaw: P.yaw, pitch: P.pitch });
    if (G.mode === 'playing') footsteps(dt, speed);
  }
  renderFrame();
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
  scene.environment = ENV;
  initViewmodel();
  let q = 'high';
  try { q = localStorage.getItem('lightleak.gfx') || 'high'; } catch (e) { /* default */ }
  setQuality(q);
  $('gfx').value = q;
  initHUD();
  await RAPIER.init();
  G.R = RAPIER;
  const index = await fetch('levels/index.json', { cache: 'no-store' }).then(r => r.json());
  G.chapters = index.chapters;
  const ids = index.chapters.flatMap(c => c.levels);
  const defs = await Promise.all(ids.map(id => fetch(`levels/${id}.json`, { cache: 'no-store' }).then(r => r.json())));
  ids.forEach((id, i) => { G.defs[id] = { ...defs[i], id }; });
  G.order = index.chapters.filter(c => !c.custom).flatMap(c => c.levels);
  G.hooks = {
    toast, flash, rollChanged: updateRoll,
    levelLoaded() { G.checkpoint = snapshot(); storyReset(); storyEvent('start'); setExposure(G.L.def.bright ? 0.85 : 1.15); clearFX(); if (!G.headless && G.mode === 'playing') startAmbience(ambienceFor(G.L.def)); },
    acted() { G.checkpoint = snapshot(); },
    shake(a) { if (SET.shake) shake = Math.max(shake, a); },
    whiteout(hit) { const w = $('whiteout'); w.classList.remove('go', 'hit'); void w.offsetWidth; w.classList.add('go'); if (hit) w.classList.add('hit'); },
  };
  const dev = await fetch('api/dev').then(r => r.json()).then(j => j.dev).catch(() => false);
  setDev(dev);
  // watching a recorded attempt: play it back, then return to the review screen
  initReview((def, back) => {
    const orig = G.defs[def.id];
    $('menu').hidden = true;
    editorApi.watch(def, why => { G.defs[def.id] = orig; if (why) toast(`Replay stopped: ${why}`); G.mode = 'title'; showMenu(); back(); });
  });
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
