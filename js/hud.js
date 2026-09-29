// Everything drawn in HTML over the 3D view.
import { G } from './state.js';
import { CAMERA, NAMES } from './config.js';
import { framedProps, solvePlacement, frameRect, aimedProp } from './photo.js';
import { grainDataURL } from './materials.js';
import { SFX } from './audio.js';
import { bossHUD } from './boss.js';

const THREE = window.THREE;
const $ = id => document.getElementById(id);
let toastTimer = 0;

export function initHUD() {
  $('grain').style.backgroundImage = `url(${grainDataURL()})`;
}

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

export function flash() {
  const fl = $('flash');
  fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
}

// Switching film: the whole screen flips to negative for a moment.
export function filmSwitched() {
  const f = $('negflash');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  toast(G.filmMode === 'neg' ? 'Negative film loaded. What you develop will dissolve things.' : 'Film loaded.');
}

export function levelNumber(id) {
  const i = G.order.indexOf(id);
  return i < 0 ? 'CUSTOM' : `FRAME ${String(i + 1).padStart(2, '0')} / ${String(G.order.length).padStart(2, '0')}`;
}
export function chapterOf(id) { return G.chapters.find(c => c.levels.includes(id)); }

export function showTitle() {
  const def = G.L.def;
  const ch = chapterOf(def.id);
  $('tc-no').textContent = `${ch ? ch.name.toUpperCase() + ' · ' : ''}${levelNumber(def.id)}`;
  $('tc-name').textContent = def.name;
  $('fi-no').textContent = levelNumber(def.id);
  $('fi-name').textContent = def.name;
  $('fi-hint').textContent = def.hint || '';
  const tc = $('titlecard');
  tc.classList.add('on');
  clearTimeout(showTitle.t);
  showTitle.t = setTimeout(() => tc.classList.remove('on'), 2400);
  updateRoll();
}

export function updateRoll() {
  const L = G.L;
  if (!L) return;
  const film = $('film');
  film.innerHTML = '';
  for (const kind of ['pos', 'neg']) {
    const total = L.def.film?.[kind] ?? 0;
    if (!total) continue;
    const row = document.createElement('div');
    row.className = 'filmrow' + (G.filmMode === kind ? ' active' : '');
    row.innerHTML = `<span class="lbl">${kind === 'pos' ? 'FILM' : 'NEGATIVE'}</span>`;
    const cells = document.createElement('div'); cells.className = 'cells';
    for (let i = 0; i < total; i++) {
      const c = document.createElement('div');
      c.className = `cell ${kind}` + (i < L.film[kind] ? ' full' : '');
      cells.appendChild(c);
    }
    row.appendChild(cells);
    film.appendChild(row);
  }
  const hasNeg = (L.def.film?.neg ?? 0) > 0;
  $('hud').classList.toggle('negative', hasNeg && G.filmMode === 'neg');
  const hasFilm = hasNeg || (L.def.film?.pos ?? 0) > 0;
  $('roll').style.display = hasFilm ? '' : 'none';
  if (!hasFilm) { $('keys').innerHTML = '<kbd>R</kbd> restart'; return; }
  $('keys').innerHTML = [
    L.def.wide ? '<kbd>Wheel</kbd>/<kbd>G</kbd> frame size (camera up)' : '',
    hasNeg ? '<kbd>T</kbd> switch film' : '',
    '<kbd>Q</kbd><kbd>E</kbd> turn photo',
    '<kbd>Z</kbd> undo', '<kbd>R</kbd> restart',
  ].filter(Boolean).join('<br>');

  const r = $('roll');
  r.innerHTML = '';
  const now = performance.now();
  for (let i = 0; i < CAMERA.roll; i++) {
    const s = document.createElement('div');
    const p = G.roll[i];
    s.className = 'slot' + (p ? ' photo' : '') + (p && p.neg ? ' neg' : '') + (i === G.selected ? ' sel' : '');
    if (p) {
      const img = document.createElement('img'); img.alt = '';
      if (p.img) img.src = p.img;
      const age = now - p.born;
      if (age < 2200) { img.classList.add('fresh'); img.style.animationDelay = `${-age}ms`; }
      const cap = document.createElement('div'); cap.className = 'cap';
      cap.textContent = `${p.neg ? 'NEG · ' : ''}${p.label} · ${p.d0.toFixed(1)} m`;
      s.append(img, cap);
      if (p.rot) { const t = document.createElement('div'); t.className = 'turn'; t.textContent = `↻ ${p.rot * 90}°`; s.appendChild(t); }
    }
    const k = document.createElement('kbd'); k.className = 'k'; k.textContent = i + 1;
    s.appendChild(k);
    r.appendChild(s);
  }
}

// Per rendered frame: the viewfinder, the ghost and the prompt under the crosshair.
const ghost = { group: null, meshes: [], edges: [], land: [], mat: null, edgeMat: null, landMat: null };
const HILITE = new THREE.Color(0x1e150a), ERASE = new THREE.Color(0x6a1006), NONE = new THREE.Color(0, 0, 0);
let lit = [];

function ensureGhost() {
  if (ghost.group) return;
  ghost.group = new THREE.Group();
  ghost.mat = new THREE.MeshBasicMaterial({ color: 0x8fc27a, transparent: true, opacity: 0.2, depthWrite: false });
  ghost.edgeMat = new THREE.LineBasicMaterial({ color: 0x8fc27a });
  ghost.landMat = new THREE.LineBasicMaterial({ color: 0x8fc27a, transparent: true, opacity: 0.35 });
  G.scene.add(ghost.group);
}
function ghostBox(i) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  while (ghost.meshes.length <= i) {
    const m = new THREE.Mesh(box, ghost.mat); m.renderOrder = 3;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(box), ghost.edgeMat); m.add(e);
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(box), ghost.landMat);
    ghost.meshes.push(m); ghost.land.push(l);
    ghost.group.add(m, l);
  }
  return [ghost.meshes[i], ghost.land[i]];
}

function setLit(props, color) {
  for (const p of lit) if (p.mesh.material.emissive && !p.flash) p.mesh.material.emissive.copy(NONE);
  lit = props;
  for (const p of lit) if (!p.flash) p.mesh.material.emissive.copy(color);
}

// The fight's status: goal, straps left, and how exposed you are.
let lastBoss = '';
function updateBossBar() {
  const s = bossHUD();
  $('bossbar').hidden = !s; $('exposure').hidden = !s || s.defeated;
  if (!s) { $('overexposure').style.opacity = 0; lastBoss = ''; return; }
  const key = JSON.stringify(s);
  if (key === lastBoss) return;
  lastBoss = key;
  $('boss-goal').textContent = s.goal;
  $('boss-straps').innerHTML = Array.from({ length: s.straps }, (_, i) => `<div class="strap${i < s.cut ? ' cut' : ''}"></div>`).join('');
  $('exposure-pips').innerHTML = Array.from({ length: s.hits }, (_, i) => `<span class="pip${i < s.exposure ? ' on' : ''}"></span>`).join('');
  $('exposure-pips').style.display = 'inline-flex'; $('exposure-pips').style.gap = '6px';
  $('overexposure').style.opacity = (s.exposure / s.hits) * 0.55;
}

export function updateAim() {
  ensureGhost();
  updateBossBar();
  const L = G.L, prompt = $('prompt'), vf = $('vf');
  ghost.group.visible = false;
  vf.hidden = !G.aim;
  $('hud').classList.toggle('aiming', G.aim);
  $('roll').hidden = G.aim;
  $('cardread').hidden = true;
  if (!L || L.finished) { prompt.textContent = ''; setLit([], NONE); return; }
  for (const s of L.statics) if (s.kind === 'emulsion' && s.mesh) s.mesh.material.emissive.setHex(0x2a0603);

  if (G.aim) {
    const group = framedProps();
    setLit(group, HILITE);
    const { frac } = frameRect();
    const f = $('vf-frame');
    const wide = frac && L.def.wide;
    f.hidden = !wide;
    if (wide) { f.style.width = `${frac * 100}%`; f.style.height = `${frac * 100}%`; }
    // always say what the frame takes in, and how to change it
    const size = $('vf-size');
    size.hidden = !L.def.wide;
    if (L.def.wide) size.textContent = frac ? `FRAME ${Math.round(frac * 100)}% · WHEEL ↑↓ OR G` : 'FRAME: ONE THING · WHEEL ↑ OR G TO WIDEN';
    vf.classList.toggle('locked', group.length > 0);
    vf.classList.toggle('negative', G.filmMode === 'neg');
    $('vf-mode').textContent = G.filmMode === 'neg' ? 'NEGATIVE' : 'FILM';
    if (group.length) {
      const e = G.camera.position;
      const c = group.reduce((a, p) => a.add(p.mesh.position), new THREE.Vector3()).multiplyScalar(1 / group.length);
      const mass = group.reduce((m, p) => m + p.mass, 0);
      const what = group.length > 1 ? `${group.length} OBJECTS` : `${NAMES[group[0].type].toUpperCase()} · ${fmtM(Math.max(...group[0].size))} m`;
      $('vf-subject').textContent = `${what} · ${fmtT(mass)} t`;
      $('vf-dist').textContent = `${c.distanceTo(e).toFixed(1)} m`;
      prompt.innerHTML = L.film[G.filmMode] > 0 ? '<span class="ok">CLICK</span> take photo' : '<span class="bad">OUT OF FILM</span>';
    } else {
      $('vf-subject').textContent = 'No subject';
      $('vf-dist').textContent = wide ? `frame ${Math.round(frac * 100)}%` : '';
      prompt.textContent = '';
    }
    return;
  }
  const photo = G.roll[G.selected];
  if (!photo) { setLit([], NONE); prompt.textContent = ''; readCard(); return; }
  if (photo.keepsake) { setLit([], NONE); prompt.textContent = 'A photograph of the Curator.'; return; }
  const pl = solvePlacement(photo);
  if (!pl) { setLit([], NONE); prompt.innerHTML = '<span class="bad">NO SURFACE</span>'; return; }
  ghost.group.visible = true;
  const col = photo.neg ? (pl.valid ? 0xf06a4f : 0x7a6a60) : pl.valid ? 0x8fc27a : 0xe0574a;
  ghost.mat.color.setHex(photo.neg ? 0x120f0d : col);
  ghost.mat.opacity = photo.neg ? 0.45 : 0.2;
  ghost.edgeMat.color.setHex(col); ghost.landMat.color.setHex(col);
  for (let i = 0; i < ghost.meshes.length; i++) { ghost.meshes[i].visible = false; ghost.land[i].visible = false; }
  pl.poses.forEach((pose, i) => {
    const [m, land] = ghostBox(i);
    m.visible = true;
    m.position.copy(pose.pos); m.quaternion.copy(pose.q); m.scale.fromArray(pose.size);
    if (!photo.neg && pl.drop > 0.05 && isFinite(pl.drop)) {
      land.visible = true;
      land.position.copy(pose.pos).y -= pl.drop; land.quaternion.copy(pose.q); land.scale.fromArray(pose.size);
    }
  });
  if (photo.neg) {
    setLit(pl.erase.filter(r => r.body), ERASE);
    for (const r of pl.erase) if (!r.body) r.mesh.material.emissive.setHex(0x6a1a0c);
    prompt.innerHTML = pl.valid ? `<span class="ok">CLICK</span> dissolve ${pl.erase.length} thing${pl.erase.length > 1 ? 's' : ''}` : `<span class="bad">${pl.reason}</span>`;
    return;
  }
  setLit([], NONE);
  const dims = `${fmtM(pl.size.x)} × ${fmtM(pl.size.y)} × ${fmtM(pl.size.z)} m · ${fmtT(pl.mass)} t`;
  const fall = !isFinite(pl.drop) ? ' · <span class="bad">FALLS AWAY</span>' : pl.drop > 1.5 ? ` · drops ${pl.drop.toFixed(1)} m` : '';
  prompt.innerHTML = pl.valid ? `<span class="ok">CLICK</span> develop · ${dims}${fall}` : `<span class="bad">${pl.reason}</span> · ${dims}`;
}

// An index card within reach and in plain view shows its text.
const cardRay = new THREE.Raycaster();
let lastCard = null;
function readCard() {
  const L = G.L;
  if (!L.cards.length) return;
  cardRay.setFromCamera(new THREE.Vector2(0, 0), G.camera);
  cardRay.far = 3.2;
  const h = cardRay.intersectObjects([...L.cards, ...L.rayMeshes], false).find(x => x.object.userData.kind !== 'glass');
  const card = h && h.object.userData.card;
  const box = $('cardread');
  if (!card) { box.hidden = true; lastCard = null; return; }
  if (card !== lastCard) { SFX.card(); lastCard = card; }
  $('card-title').textContent = card.title || '';
  $('card-text').textContent = card.text || '';
  box.hidden = false;
}

function fmtM(v) { return v < 10 ? v.toFixed(2) : v.toFixed(1); }
function fmtT(v) { return v < 10 ? v.toFixed(1) : Math.round(v).toString(); }
