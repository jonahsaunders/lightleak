// Builds a level from its JSON definition: meshes, colliders, props, plates, the door and the exit.
// Also owns the per-tick world simulation and undo snapshots.
import { G, emit } from './state.js';
import { MAT, PRINT_TEX, worldBox, propMaterial, canvasTexture } from './materials.js';
import { DT, GRAVITY, DENSITY, UNDO_DEPTH } from './config.js';
import { createPlayer, P, placePlayer } from './player.js';
import { SFX } from './audio.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const DEEP = ['wall', 'wall', 'floor', 'wall', 'wall', 'wall'];

// ---------- lookups ----------
export function infoOf(collider) { return G.L && G.L.colliders.get(collider.handle); }
export function propMass(type, size) { return DENSITY[type] * size[0] * size[1] * size[2]; }

// ---------- building ----------
export function loadLevel(def, { keepUndo = false } = {}) {
  const R = G.R;
  unloadLevel();
  const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = DT;
  const L = G.L = {
    def, world, group: new THREE.Group(), colliders: new Map(),
    statics: [], props: [], plates: [], rayMeshes: [], door: null, exit: null,
    film: { pos: def.film?.pos ?? 0, neg: def.film?.neg ?? 0 },
    killY: def.killY ?? -8, finished: false, propSeq: 0, time: 0,
  };
  G.scene.add(L.group);
  buildRoom(def.room);
  for (const b of def.blocks || []) addBlock(b.min, b.max, b.mat || 'ledge', b);
  for (const p of def.plates || []) addPlate(p);
  for (const p of def.props || []) {
    const [x, y, z] = p.pos, s = p.size;
    const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), THREE.MathUtils.degToRad(p.rot || 0));
    addProp(p.type, s, [x, y + s[1] / 2, z], [q.x, q.y, q.z, q.w]);
  }
  for (const l of def.lights || []) addLight(l);
  for (const d of def.decor || []) addDecor(d);
  lightRoom(def.room);
  createPlayer(world);
  placePlayer(def.spawn.pos, def.spawn.yaw * Math.PI / 180);
  if (!L.plates.length) openDoor(true);
  G.roll.length = 0; G.selected = -1; G.filmMode = L.film.pos > 0 || !L.film.neg ? 'pos' : 'neg'; G.frameIdx = 0; G.aim = false;
  if (!keepUndo) G.undo.length = 0;
  world.step(); // lets scene queries see every collider straight away
  G.scene.updateMatrixWorld(true);
  emit('levelLoaded');
  return L;
}

export function unloadLevel() {
  const L = G.L;
  if (!L) return;
  G.scene.remove(L.group);
  L.group.traverse(o => {
    if (o.geometry && o.geometry !== UNIT_BOX) o.geometry.dispose();
    if (o.userData.ownMaterial) { if (o.material.map && o.userData.ownMap) o.material.map.dispose(); o.material.dispose(); }
  });
  L.world.free();
  G.L = null;
}

function meshFor(min, max, mat) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const m = Array.isArray(mat) ? mat.map(k => MAT[k]) : MAT[mat];
  const mesh = new THREE.Mesh(worldBox(w, h, d), m);
  mesh.position.set(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
  mesh.receiveShadow = true;
  return mesh;
}
function staticCollider(min, max, friction = 0.8) {
  const R = G.R;
  const hx = (max[0] - min[0]) / 2, hy = (max[1] - min[1]) / 2, hz = (max[2] - min[2]) / 2;
  const desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(min[0] + hx, min[1] + hy, min[2] + hz).setFriction(friction);
  return G.L.world.createCollider(desc);
}

// kind: static | glass | emulsion
export function addBlock(min, max, mat = 'wall', src = null) {
  const L = G.L;
  const kind = mat === 'glass' ? 'glass' : mat === 'emulsion' ? 'emulsion' : 'static';
  const mesh = meshFor(min, max, mat === 'deep' ? DEEP : mat);
  mesh.castShadow = !!(src && src.cast !== false && kind === 'static') || mat === 'emulsion';
  if (kind === 'emulsion') { mesh.material = MAT.emulsion.clone(); mesh.userData.ownMaterial = true; }
  if (kind === 'glass') {
    mesh.receiveShadow = false; mesh.renderOrder = 2;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x8fa9a3, transparent: true, opacity: 0.45 })));
  }
  const s = { id: L.statics.length, kind, min: new V3(...min), max: new V3(...max), mesh, collider: staticCollider(min, max), erased: false, src };
  mesh.userData.kind = kind; mesh.userData.solid = s;
  L.colliders.set(s.collider.handle, { kind, ref: s });
  L.group.add(mesh); L.rayMeshes.push(mesh); L.statics.push(s);
  return s;
}

function buildRoom(r) {
  const t = 0.5, { x0, x1, z0, z1, h } = r;
  const wb = r.wallBottom ?? 0;
  const S = (a, b, mat = 'wall') => addBlock(a, b, mat);
  if (r.floor !== false) S([x0 - t, -t, z0 - t], [x1 + t, 0, z1 + t], 'floor');
  S([x0 - t, h, z0 - t], [x1 + t, h + t, z1 + t], 'ceil');
  S([x0 - t, wb, z0], [x0, h, z1]);
  S([x1, wb, z0], [x1 + t, h, z1]);
  S([x0 - t, wb, z1], [x1 + t, h, z1 + t]);
  const d = r.door, dx = d.x, dw = d.w || 2, dy = d.y || 0, dh = d.h || 2.6;
  S([x0 - t, wb, z0 - t], [dx - dw / 2, h, z0]);
  S([dx + dw / 2, wb, z0 - t], [x1 + t, h, z0]);
  S([dx - dw / 2, dy + dh, z0 - t], [dx + dw / 2, h, z0]);
  if (dy > wb) S([dx - dw / 2, wb, z0 - t], [dx + dw / 2, dy, z0]);
  // corridor behind the door
  const cw = dw + 1, len = 4, cz = z0 - t - len, ch = dh + 0.4;
  S([dx - cw / 2 - t, dy - t, cz - t], [dx + cw / 2 + t, dy, z0], 'floor');
  S([dx - cw / 2 - t, dy + ch, cz - t], [dx + cw / 2 + t, dy + ch + t, z0 - t], 'ceil');
  S([dx - cw / 2 - t, dy, cz], [dx - cw / 2, dy + ch, z0 - t]);
  S([dx + cw / 2, dy, cz], [dx + cw / 2 + t, dy + ch, z0 - t]);
  S([dx - cw / 2 - t, dy, cz - t], [dx + cw / 2 + t, dy + ch, cz]);
  const L = G.L;
  const lamp = new THREE.PointLight(0xffd9a8, 0.7, 8, 2); lamp.position.set(dx, dy + ch - 0.3, cz + 1.5); L.group.add(lamp);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.6, 0.12, 0.08), MAT.safelight);
  strip.position.set(dx, dy + dh + 0.25, z0 + 0.05); L.group.add(strip);
  const red = new THREE.PointLight(0xff4a30, 1.0, 10, 2); red.position.set(dx, dy + dh, z0 + 0.8); L.group.add(red);
  // safelight fixtures halfway along the side walls
  for (const [x, dir] of [[x0, 1], [x1, -1]]) {
    const zc = (z0 + z1) / 2, y = Math.min(h - 0.8, 3.2);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.7), MAT.safelight);
    lamp.position.set(x + dir * 0.06, y, zc); L.group.add(lamp);
    const glow = new THREE.PointLight(0xff3a22, 0.6, 11, 2); glow.position.set(x + dir * 0.6, y, zc); L.group.add(glow);
  }
  // the door itself: a kinematic slab that slides up into the lintel
  const R = G.R;
  const hx = dw / 2, hy = dh / 2, hz = 0.15;
  const cy = dy + hy, czd = z0 - t / 2;
  const body = L.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(dx, cy, czd));
  const collider = L.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz), body);
  const mesh = new THREE.Mesh(worldBox(dw, dh, 0.3), MAT.door);
  mesh.position.set(dx, cy, czd); mesh.receiveShadow = true; mesh.userData.kind = 'door';
  L.group.add(mesh); L.rayMeshes.push(mesh);
  L.door = { body, collider, mesh, base: cy, h: dh, t: 0, open: false, x: dx, z: czd };
  L.colliders.set(collider.handle, { kind: 'door', ref: L.door });
  L.exit = { min: new V3(dx - cw / 2, dy, cz), max: new V3(dx + cw / 2, dy + dh, cz + 2) };
}

function lightRoom(r) {
  const L = G.L;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const span = Math.max(r.x1 - r.x0, r.z1 - r.z0) / 2 + 4;
  const sun = new THREE.DirectionalLight(0xffe0c0, 0.5);
  sun.position.set(cx + 6, 40, cz + 9); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 80 });
  L.group.add(sun, sun.target);
  L.group.add(new THREE.HemisphereLight(0xd9c6b0, 0x261c18, 0.36));
}

function addLight(l) {
  const L = G.L;
  const [x, y, z] = l.pos;
  if (l.panel) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(l.w || 2, 0.05, l.d || 1), MAT.panel);
    m.position.set(x, y - 0.03, z); L.group.add(m);
  }
  const color = l.color ? parseInt(l.color.replace('#', ''), 16) : 0xffe2bc;
  const light = new THREE.PointLight(color, l.intensity ?? 0.9, l.dist ?? 14, 2);
  light.position.set(x, l.panel ? y - 0.4 : y, z);
  L.group.add(light);
}

// Set dressing: benches with developing trays, drying lines with prints. Benches are solid.
function addDecor(d) {
  const L = G.L;
  if (d.kind === 'bench') {
    const [x, y, z] = d.pos, rot = THREE.MathUtils.degToRad(d.rot || 0);
    const len = d.len || 2.4, g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.9), MAT.wood); top.position.y = 0.9; g.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), MAT.metal); leg.position.set(sx * (len / 2 - 0.1), 0.45, sz * 0.35); g.add(leg);
    }
    for (let i = 0; i < Math.floor(len / 0.8); i++) {
      const tx = -len / 2 + 0.45 + i * 0.8;
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.48), MAT.tray); tray.position.set(tx, 0.975, 0); g.add(tray);
      const liq = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.4), MAT.liquid); liq.position.set(tx, 1.0, 0); g.add(liq);
    }
    g.position.set(x, y, z); g.rotation.y = rot;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    L.group.add(g);
    // collision: one box for the whole bench
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const hx = (len / 2) * c + 0.45 * s, hz = (len / 2) * s + 0.45 * c;
    const solid = { id: L.statics.length, kind: 'static', min: new V3(x - hx, y, z - hz), max: new V3(x + hx, y + 1.02, z + hz), mesh: null, erased: false };
    solid.collider = staticCollider(solid.min.toArray(), solid.max.toArray());
    L.colliders.set(solid.collider.handle, { kind: 'static', ref: solid });
    L.statics.push(solid);
    // an invisible box so the camera sees the bench as a surface
    const hit = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 1.02, hz * 2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y + 0.51, z); hit.userData.kind = 'static'; hit.userData.solid = solid; hit.userData.decor = d;
    L.group.add(hit); L.rayMeshes.push(hit);
  } else if (d.kind === 'line') {
    const a = new V3(...d.from), b = new V3(...d.to);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    L.group.add(new THREE.Line(geo, MAT.string));
    const n = d.prints ?? Math.floor(a.distanceTo(b) / 0.7);
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / n);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshStandardMaterial({ map: PRINT_TEX[(((i + Math.round(a.x + a.z)) % PRINT_TEX.length) + PRINT_TEX.length) % PRINT_TEX.length], side: THREE.DoubleSide, roughness: 0.6 }));
      m.userData.ownMaterial = true;
      m.position.copy(p).add(new V3(0, -0.22, 0));
      m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      m.rotation.z = ((i * 37) % 7 - 3) * 0.02;
      L.group.add(m);
    }
  }
}

// ---------- props ----------
export function addProp(type, size, pos, quat, lin, ang) {
  const L = G.L, R = G.R;
  const [sx, sy, sz] = size;
  const desc = R.RigidBodyDesc.dynamic()
    .setTranslation(pos[0], pos[1], pos[2])
    .setRotation({ x: quat[0], y: quat[1], z: quat[2], w: quat[3] })
    .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3);
  const body = L.world.createRigidBody(desc);
  if (lin) body.setLinvel({ x: lin[0], y: lin[1], z: lin[2] }, true);
  if (ang) body.setAngvel({ x: ang[0], y: ang[1], z: ang[2] }, true);
  const collider = L.world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(DENSITY[type]).setFriction(0.8).setRestitution(0), body);
  const mesh = new THREE.Mesh(UNIT_BOX, propMaterial(type));
  mesh.userData.ownMaterial = true;
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = mesh.receiveShadow = true;
  const p = { id: ++L.propSeq, type, size: [sx, sy, sz], mass: propMass(type, size), body, collider, mesh, flash: 0, lastVy: 0 };
  mesh.userData.kind = 'prop'; mesh.userData.prop = p;
  L.colliders.set(collider.handle, { kind: 'prop', ref: p });
  L.group.add(mesh); L.rayMeshes.push(mesh); L.props.push(p);
  syncProp(p);
  return p;
}

export function removeProp(p) {
  const L = G.L;
  L.colliders.delete(p.collider.handle);
  L.world.removeRigidBody(p.body);
  L.group.remove(p.mesh);
  p.mesh.material.dispose();
  L.props.splice(L.props.indexOf(p), 1);
  L.rayMeshes.splice(L.rayMeshes.indexOf(p.mesh), 1);
}

function syncProp(p) {
  const t = p.body.translation(), r = p.body.rotation();
  p.mesh.position.set(t.x, t.y, t.z);
  p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
}

export function eraseStatic(s) {
  const L = G.L;
  if (s.erased) return;
  s.erased = true;
  L.colliders.delete(s.collider.handle);
  L.world.removeCollider(s.collider, true);
  s.collider = null;
  s.mesh.visible = false;
  L.rayMeshes.splice(L.rayMeshes.indexOf(s.mesh), 1);
}
function restoreStatic(s) {
  const L = G.L;
  if (!s.erased) return;
  s.erased = false;
  s.collider = staticCollider(s.min.toArray(), s.max.toArray());
  L.colliders.set(s.collider.handle, { kind: s.kind, ref: s });
  s.mesh.visible = true;
  L.rayMeshes.push(s.mesh);
}

// ---------- plates and the door ----------
function addPlate(def) {
  const L = G.L;
  const [x, y, z] = def.pos, [w, d] = def.size;
  const min = [x - w / 2, y, z - d / 2], max = [x + w / 2, y + 0.08, z + d / 2];
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a1a14, emissive: 0xd8452f, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.3 });
  const mesh = meshFor(min, max, 'wall');
  mesh.material = mat; mesh.userData.ownMaterial = true; mesh.userData.kind = 'plate';
  const collider = staticCollider(min, max);
  const { canvas, tex } = canvasTexture(256, 128);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.userData.ownMaterial = true; sprite.userData.ownMap = true;
  sprite.scale.set(1.6, 0.8, 1);
  sprite.position.set(x, y + (def.label ?? 2.5), z);
  L.group.add(mesh, sprite); L.rayMeshes.push(mesh);
  const p = { need: def.need, max: def.max ?? null, load: 0, shown: -1, on: false, collider, mesh, mat, canvas, tex };
  L.colliders.set(collider.handle, { kind: 'plate', ref: p });
  L.plates.push(p);
  drawPlate(p);
}

function fmtT(v) { return v < 10 ? v.toFixed(1) : Math.round(v).toString(); }
function drawPlate(p) {
  const g = p.canvas.getContext('2d');
  const on = p.on;
  const over = p.max != null && p.load > p.max;
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = '#120f0dd9'; g.fillRect(4, 4, 248, 120);
  g.strokeStyle = on ? '#8fc27a' : '#d8452f'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#efe6d2'; g.font = '700 20px ui-monospace, Consolas, monospace'; g.textAlign = 'center';
  g.fillText(p.max != null ? `LOAD ${fmtT(p.need)}–${fmtT(p.max)} t` : `LOAD ≥ ${fmtT(p.need)} t`, 128, 34);
  g.font = '700 38px ui-monospace, Consolas, monospace';
  g.fillStyle = on ? '#8fc27a' : over ? '#f0a04f' : '#efe6d2';
  g.fillText(`${fmtT(p.load)} t`, 128, 78);
  const top = p.max ?? p.need;
  g.fillStyle = '#3a322c'; g.fillRect(24, 94, 208, 14);
  g.fillStyle = on ? '#8fc27a' : over ? '#f0a04f' : '#d8452f'; g.fillRect(24, 94, 208 * Math.min(1, p.load / (top * (p.max != null ? 1.25 : 1))), 14);
  if (p.max != null) { g.fillStyle = '#efe6d2'; g.fillRect(24 + 208 * (p.need / (top * 1.25)), 90, 2, 22); g.fillRect(24 + 208 / 1.25, 90, 2, 22); }
  p.tex.needsUpdate = true;
}

function touching(a, b) {
  let n = 0;
  G.L.world.contactPair(a, b, m => { n += m.numContacts(); });
  return n > 0;
}
// Everything resting on the plate, directly or stacked.
function plateLoad(plate) {
  const L = G.L, seen = new Set(), queue = [];
  L.world.contactPairsWith(plate.collider, c => {
    const info = L.colliders.get(c.handle);
    if (info && info.kind === 'prop' && touching(plate.collider, c)) queue.push(info.ref);
  });
  let load = 0;
  while (queue.length) {
    const p = queue.pop();
    if (seen.has(p)) continue;
    seen.add(p); load += p.mass;
    const y = p.body.translation().y;
    L.world.contactPairsWith(p.collider, c => {
      const info = L.colliders.get(c.handle);
      if (info && info.kind === 'prop' && !seen.has(info.ref) && info.ref.body.translation().y > y + 0.05 && touching(p.collider, c)) queue.push(info.ref);
    });
  }
  return load;
}

export function openDoor(quiet) {
  const d = G.L.door;
  if (d.open) return;
  d.open = true;
  if (!quiet) { SFX.door(); emit('toast', 'The door is open.'); }
}

// ---------- the tick ----------
export function stepWorld() {
  const L = G.L;
  L.world.step();
  L.time += DT;
  for (const p of L.props.slice()) {
    const v = p.body.linvel().y;
    if (p.lastVy < -6 && v > p.lastVy + 4 && !G.headless) SFX.land(-p.lastVy / 6);
    p.lastVy = v;
    syncProp(p);
    if (p.flash > 0) { p.flash = Math.max(0, p.flash - DT * 2.5); p.mesh.material.emissive.setRGB(p.flash, p.flash * 0.9, p.flash * 0.8); }
    if (p.mesh.position.y < L.killY - 30) removeProp(p);
  }
  let all = L.plates.length > 0;
  for (const p of L.plates) {
    p.load = plateLoad(p);
    const on = p.load >= p.need - 1e-6 && (p.max == null || p.load <= p.max + 1e-6);
    if (on && !p.on && !G.headless) SFX.plate();
    p.on = on;
    if (!on) all = false;
    p.mat.emissive.setHex(on ? 0x8fc27a : 0xd8452f);
    const shown = Math.round(p.load * 10) * 2 + (on ? 1 : 0);
    if (shown !== p.shown) { p.shown = shown; drawPlate(p); }
  }
  if (all) openDoor(G.headless);
  const d = L.door;
  if (d.open && d.t < 1) {
    d.t = Math.min(1, d.t + DT / 1.1);
    const y = d.base + d.h * (1 - Math.pow(1 - d.t, 3));
    d.body.setNextKinematicTranslation({ x: d.x, y, z: d.z });
    d.mesh.position.y = y;
  }
}

export function playerInExit() {
  const L = G.L;
  const e = L.exit;
  return P.pos.x > e.min.x && P.pos.x < e.max.x && P.pos.z > e.min.z && P.pos.z < e.max.z && P.pos.y > e.min.y - 0.5 && P.pos.y < e.max.y;
}

// ---------- undo ----------
export function snapshot() {
  const L = G.L;
  return {
    props: L.props.map(p => {
      const t = p.body.translation(), r = p.body.rotation(), v = p.body.linvel(), w = p.body.angvel();
      return { type: p.type, size: p.size.slice(), pos: [t.x, t.y, t.z], quat: [r.x, r.y, r.z, r.w], lin: [v.x, v.y, v.z], ang: [w.x, w.y, w.z] };
    }),
    erased: L.statics.filter(s => s.erased).map(s => s.id),
    door: { open: L.door.open, t: L.door.t },
    film: { ...L.film },
    roll: G.roll.map(ph => ({ ...ph })),
    filmMode: G.filmMode,
    player: { pos: P.pos.toArray(), vel: P.vel.toArray(), yaw: P.yaw, pitch: P.pitch },
  };
}
export function pushUndo() {
  G.undo.push(snapshot());
  if (G.undo.length > UNDO_DEPTH) G.undo.shift();
}
export function restore(s) {
  const L = G.L;
  for (const p of L.props.slice()) removeProp(p);
  for (const p of s.props) addProp(p.type, p.size, p.pos, p.quat, p.lin, p.ang);
  for (const st of L.statics) { if (s.erased.includes(st.id)) eraseStatic(st); else if (st.erased) restoreStatic(st); }
  const d = L.door;
  d.open = s.door.open; d.t = s.door.t;
  const y = d.base + d.h * (1 - Math.pow(1 - d.t, 3));
  d.body.setTranslation({ x: d.x, y, z: d.z }, true); d.mesh.position.y = y;
  L.film = { ...s.film };
  G.roll.length = 0; G.roll.push(...s.roll.map(ph => ({ ...ph })));
  G.selected = -1; G.filmMode = s.filmMode;
  placePlayer(s.player.pos, s.player.yaw, s.player.pitch);
  P.vel.fromArray(s.player.vel);
  L.world.step();
  for (const p of L.props) syncProp(p);
  G.scene.updateMatrixWorld(true);
  emit('rollChanged');
}
