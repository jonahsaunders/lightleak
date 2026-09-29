// The camera: what's in frame, taking a photo, and developing it back into the world.
//
// A photo stores its objects in the photographer's frame of reference (yaw only), so a scene
// develops the way it looked to you: whatever was on your left is still on your left.
// Developing scales everything by k = d / d0: the new distance from your eye over the old one.
import { G, emit } from './state.js';
import { CAMERA, NAMES } from './config.js';
import { addProp, removeProp, eraseStatic, pushUndo, propMass } from './level.js';
import { P } from './player.js';
import { SFX } from './audio.js';
import { storyEvent } from './story.js';

const THREE = window.THREE;
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const UP = new V3(0, 1, 0);
const ray = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
const tmp = new V3();

// ---------- what the camera sees ----------
function eye() { return G.camera.position; }

export function castCenter() {
  ray.setFromCamera(CENTER, G.camera);
  ray.far = CAMERA.range;
  return ray.intersectObjects(G.L.rayMeshes, false);
}

// The prop under the crosshair, looking through glass.
export function aimedProp() {
  for (const h of castCenter()) {
    if (h.object.userData.kind === 'glass') continue;
    return h.object.userData.prop || null;
  }
  return null;
}

function propCorners(p, shrink = 1) {
  const out = [];
  const [sx, sy, sz] = p.size;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    out.push(new V3(a * sx / 2 * shrink, b * sy / 2 * shrink, c * sz / 2 * shrink).applyQuaternion(p.mesh.quaternion).add(p.mesh.position));
  }
  return out;
}

// Can the camera see any of this prop? Glass is transparent, everything else blocks.
function visible(p) {
  const e = eye();
  for (const pt of [p.mesh.position.clone(), ...propCorners(p, 0.85)]) {
    const dir = tmp.copy(pt).sub(e);
    const dist = dir.length();
    if (dist > CAMERA.range) continue;
    ray.set(e, dir.normalize());
    ray.far = dist + 0.01;
    const hits = ray.intersectObjects(G.L.rayMeshes, false);
    const first = hits.find(h => h.object.userData.kind !== 'glass');
    if (!first || first.object === p.mesh || first.distance > dist - 0.05) return true;
  }
  return false;
}

// The capture frame as angular half-extents (tangents), so it doesn't depend on window size.
// The viewfinder is 72% of the screen's height and 4:3, which is what the HUD draws.
export function frameRect() {
  const f = CAMERA.frames[G.frameIdx];
  const t = Math.tan(THREE.MathUtils.degToRad(G.camera.fov) / 2);
  return { tx: 0.96 * f * t, ty: 0.72 * f * t, frac: f };
}

// Everything a photo taken right now would contain.
export function framedProps() {
  const L = G.L;
  const aimed = aimedProp();
  const { tx, ty, frac } = frameRect();
  if (!frac || !L.def.wide) return aimed ? [aimed] : [];
  const out = new Set(aimed ? [aimed] : []);
  const e = eye();
  G.camera.updateMatrixWorld();
  const inv = G.camera.matrixWorldInverse;
  for (const p of L.props) {
    if (out.has(p)) continue;
    const c = p.mesh.position.clone().applyMatrix4(inv);
    if (c.z > -0.1 || Math.abs(c.x / -c.z) > tx || Math.abs(c.y / -c.z) > ty) continue;
    if (p.mesh.position.distanceTo(e) > CAMERA.range) continue;
    if (visible(p)) out.add(p);
  }
  return [...out].sort((a, b) => a.mesh.position.distanceTo(e) - b.mesh.position.distanceTo(e)).slice(0, CAMERA.maxGroup);
}

// ---------- taking a photo ----------
export function takePhoto() {
  const L = G.L;
  const neg = G.filmMode === 'neg';
  const group = framedProps();
  if (!group.length) { deny('Nothing to photograph there.'); return false; }
  if (L.film[G.filmMode] <= 0) { deny(neg ? 'Out of negative film.' : 'Out of film. Z undoes, R restarts.'); return false; }
  if (G.roll.length >= CAMERA.roll) { deny('Your hands are full. Develop or throw away (X) a photo first.'); return false; }
  pushUndo();
  L.film[G.filmMode]--;

  const yawQ = new Q().setFromAxisAngle(UP, P.yaw);
  const inv = yawQ.clone().invert();
  const ref = group[0].mesh.position.clone();
  const items = group.map(p => ({
    type: p.type, size: p.size.slice(),
    p: p.mesh.position.clone().sub(ref).applyQuaternion(inv),
    q: inv.clone().multiply(p.mesh.quaternion),
  }));
  const box = new THREE.Box3();
  for (const it of items) for (const c of itemCorners(it, 1)) box.expandByPoint(c);
  const center = box.getCenter(new V3());
  for (const it of items) it.p.sub(center);
  const worldCenter = center.clone().applyQuaternion(yawQ).add(ref);
  const photo = {
    neg,
    items: items.map(it => ({ type: it.type, size: it.size, p: it.p.toArray(), q: it.q.toArray() })),
    half: box.getSize(new V3()).multiplyScalar(0.5).toArray(),
    d0: Math.max(0.3, worldCenter.distanceTo(eye())),
    rot: 0,
    img: '',
    mass: group.reduce((m, p) => m + p.mass, 0),
    label: group.length > 1 ? `${group.length} objects` : NAMES[group[0].type],
    born: performance.now(),
  };
  G.roll.push(photo);
  G.aimToggle = false;
  if (!G.headless) { G.pendingThumb = photo; SFX.shutter(); emit('flash'); }
  emit('rollChanged');
  emit('acted');
  storyEvent(neg ? 'negative' : 'photo');
  return true;
}

function itemCorners(it, k) {
  const out = [];
  const q = it.q instanceof Q ? it.q : new Q().fromArray(it.q);
  const p = it.p instanceof V3 ? it.p : new V3().fromArray(it.p);
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    out.push(new V3(a * it.size[0] / 2, b * it.size[1] / 2, c * it.size[2] / 2).applyQuaternion(q).add(p).multiplyScalar(k));
  }
  return out;
}

// ---------- developing ----------
function clampK(k, photo) {
  const maxExtent = 2 * Math.max(...photo.half);
  const minDim = Math.min(...photo.items.map(it => Math.min(...it.size)));
  return THREE.MathUtils.clamp(k, CAMERA.minDim / minDim, CAMERA.maxDim / maxExtent);
}

function groupQuat(photo) {
  return new Q().setFromAxisAngle(UP, P.yaw).multiply(new Q().setFromAxisAngle(UP, photo.rot * Math.PI / 2));
}

// World poses of every item for a group centred at `center`, oriented `qG`, scaled `k`.
function poses(photo, center, qG, k) {
  return photo.items.map(it => {
    const q = qG.clone().multiply(new Q().fromArray(it.q));
    const pos = new V3().fromArray(it.p).multiplyScalar(k).applyQuaternion(qG).add(center);
    return { type: it.type, size: it.size.map(v => v * k), pos, q };
  });
}

function shapeOf(pose) { return new G.R.Cuboid(pose.size[0] / 2, pose.size[1] / 2, pose.size[2] / 2); }
const vec = v => ({ x: v.x, y: v.y, z: v.z });
const rot = q => ({ x: q.x, y: q.y, z: q.z, w: q.w });

// Colliders overlapping a pose by more than `slack` metres, with the deepest contact.
function overlaps(pose, slack = 0.005) {
  const world = G.L.world, out = [];
  const shape = shapeOf(pose);
  world.intersectionsWithShape(vec(pose.pos), rot(pose.q), shape, c => {
    const hit = shape.contactShape(vec(pose.pos), rot(pose.q), c.shape, c.translation(), c.rotation(), 0);
    if (hit && hit.distance < -slack) out.push({ collider: c, hit });
    return true;
  }, G.R.QueryFilterFlags.EXCLUDE_SENSORS);
  return out;
}

// Where, and how big, the held photo would develop. Returns null if there's nothing to develop onto.
export function solvePlacement(photo) {
  const hits = castCenter();
  if (!hits.length) return null;
  const h = hits[0];
  const e = eye();
  const qG = groupQuat(photo);
  const corners = photo.items.flatMap(it => itemCorners(it, 1)).map(c => c.applyQuaternion(qG));
  const center = new V3();
  let k;

  if (photo.neg) {
    center.copy(h.point);
    k = clampK(h.distance / photo.d0, photo);
    const ps = poses(photo, center, qG, k);
    const erase = new Set();
    for (const pose of ps) {
      G.L.world.intersectionsWithShape(vec(pose.pos), rot(pose.q), shapeOf(pose), c => {
        const info = G.L.colliders.get(c.handle);
        if (info && (info.kind === 'prop' || info.kind === 'emulsion')) erase.add(info.ref);
        return true;
      }, G.R.QueryFilterFlags.EXCLUDE_SENSORS);
    }
    const size = new V3().fromArray(photo.half).multiplyScalar(2 * k);
    return { neg: true, center, k, poses: ps, erase: [...erase], valid: erase.size > 0, reason: erase.size ? '' : 'NOTHING TO DISSOLVE', size };
  }

  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  k = clampK(h.distance / photo.d0, photo);
  for (let i = 0; i < 6; i++) {
    let ext = -Infinity;
    for (const c of corners) ext = Math.max(ext, -c.dot(n) * k);
    center.copy(h.point).addScaledVector(n, ext + 0.01);
    k = clampK(center.distanceTo(e) / photo.d0, photo);
  }
  let ext = -Infinity;
  for (const c of corners) ext = Math.max(ext, -c.dot(n) * k);
  center.copy(h.point).addScaledVector(n, ext + 0.01);

  // nudge out of anything it clips
  const start = center.clone();
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const pose of poses(photo, center, qG, k)) {
      for (const o of overlaps(pose)) {
        const info = G.L.colliders.get(o.collider.handle);
        if (info && info.kind === 'player') continue;
        center.addScaledVector(new V3(o.hit.normal1.x, o.hit.normal1.y, o.hit.normal1.z), o.hit.distance - 0.003);
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  const ps = poses(photo, center, qG, k);
  let valid = center.distanceTo(start) < 1.5, reason = valid ? '' : 'NO ROOM';
  if (valid) for (const pose of ps) {
    const o = overlaps(pose, 0.01);
    if (o.length) {
      valid = false;
      reason = o.some(x => G.L.colliders.get(x.collider.handle)?.kind === 'player') ? 'TOO CLOSE' : 'NO ROOM';
      break;
    }
  }
  // how far will it fall?
  let drop = Infinity;
  for (const pose of ps) {
    const hit = G.L.world.castShape(vec(pose.pos), rot(pose.q), { x: 0, y: -1, z: 0 }, shapeOf(pose), 0, 60, false, G.R.QueryFilterFlags.EXCLUDE_SENSORS);
    if (hit) drop = Math.min(drop, hit.time_of_impact);
  }
  const mass = photo.items.reduce((m, it) => m + propMass(it.type, it.size.map(v => v * k)), 0);
  const size = new V3().fromArray(photo.half).multiplyScalar(2 * k);
  return { neg: false, center, k, poses: ps, valid, reason, drop, mass, size };
}

export function develop() {
  const photo = G.roll[G.selected];
  if (!photo || !G.L || G.L.finished) return false;
  const pl = solvePlacement(photo);
  if (!pl) { deny('Aim at something to develop onto.'); return false; }
  if (!pl.valid) { deny(photo.neg ? 'Nothing there for the negative to dissolve.' : pl.reason === 'TOO CLOSE' ? "That's where you're standing." : "It won't fit there."); return false; }
  pushUndo();
  if (photo.neg) {
    for (const r of pl.erase) { if (r.body) removeProp(r); else eraseStatic(r); }
    if (!G.headless) SFX.erase();
  } else {
    for (const pose of pl.poses) {
      const p = addProp(pose.type, pose.size, pose.pos.toArray(), pose.q.toArray());
      p.flash = 1;
    }
    if (!G.headless) SFX.develop();
  }
  storyEvent(photo.neg ? 'dissolve' : 'develop');
  G.roll.splice(G.selected, 1);
  G.selected = -1;
  emit('rollChanged');
  emit('acted');
  return true;
}

export function discard() {
  if (G.selected < 0) return;
  pushUndo();
  G.roll.splice(G.selected, 1);
  G.selected = -1;
  emit('rollChanged');
  emit('toast', 'Photo thrown away.');
  emit('acted');
}

function deny(msg) {
  if (!G.headless) SFX.deny();
  emit('toast', msg);
  G.lastDeny = msg;
}
