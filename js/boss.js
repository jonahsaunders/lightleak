// The final chamber: the Curator itself, a huge enlarger head hanging from three emulsion straps.
//
//   It watches  the lens swivels after you and throws a spotlight with real shadows.
//   It flashes  every few seconds it locks onto where you are, turns red, and flashes. If its lens
//               can see you there (glass doesn't hide you; anything solid does), you take a mark of
//               exposure. Three marks and you're rewound; marks fade if you stay clear for a while.
//   Phase 1     load both counterweight plates: the steel sleeves around the straps slide away.
//   Phase 2     dissolve the three straps with negatives. It tilts with each one, then falls.
//   Phase 3     it lies on the floor with its lens towards you. Photograph it.
//
// Everything here runs in the fixed tick, so it's deterministic like the rest of the simulation.
import { G, emit } from './state.js';
import { DT, PLAYER } from './config.js';
import { MAT, worldBox } from './materials.js';
import { P } from './player.js';
import { openDoor } from './level.js';
import { SFX } from './audio.js';
import { storyEvent } from './story.js';
import { SET } from './settings.js';

const THREE = window.THREE;
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const HOUSING = [4, 3, 4];

export function createBoss(cfg) {
  const L = G.L, R = G.R;
  const root = new THREE.Group();   // the whole head: moves and tilts
  L.group.add(root);
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const box = (parent, w, h, d, x, y, z, mat = MAT.door) => add(parent, worldBox([x - w / 2, y - h / 2, z - d / 2], [x + w / 2, y + h / 2, z + d / 2]), mat, x, y, z);
  const bellowsMat = new THREE.MeshStandardMaterial({ color: 0x141211, roughness: 0.9 });

  // housing (centred on the root), collars, a status lamp
  const [hw, hh, hd] = HOUSING;
  box(root, hw, hh, hd, 0, 0, 0);
  box(root, hw + 0.3, 0.22, hd + 0.3, 0, -hh / 2 + 0.1, 0, MAT.trim);
  box(root, hw + 0.3, 0.22, hd + 0.3, 0, hh / 2 - 0.1, 0, MAT.trim);
  const status = add(root, new THREE.SphereGeometry(0.14, 16, 10), MAT.safelight, hw / 2 - 0.4, 0.6, hd / 2 + 0.02);
  status.castShadow = false;

  // the lens assembly hangs under the housing and swivels towards its target
  const lens = new THREE.Group();
  lens.position.set(0, -hh / 2, 0);
  root.add(lens);
  for (let i = 0; i < 6; i++) box(lens, 2.6 - i * 0.22, 0.2, 2.6 - i * 0.22, 0, -0.14 - i * 0.26, 0, i % 2 ? MAT.trim : bellowsMat);
  const tipY = -1.75;
  box(lens, 1.2, 0.3, 1.2, 0, tipY + 0.2, 0, MAT.trim);
  // the lens: dark glass with a glowing iris in the middle
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0c0e, roughness: 0.05, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.5 });
  const eye = add(lens, new THREE.CylinderGeometry(0.7, 0.8, 0.2, 32), glass, 0, tipY, 0);
  eye.castShadow = false;
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd6b0, emissiveIntensity: 0.6 });
  const iris = add(lens, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 32), eyeMat, 0, tipY - 0.105, 0);
  iris.castShadow = false;
  // the bulb inside, only really visible once it's on the floor
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc27a, emissiveIntensity: 3 });
  const bulb = add(lens, new THREE.SphereGeometry(0.55, 32, 20), bulbMat, 0, tipY - 0.15, 0);
  bulb.castShadow = false; bulb.visible = false;
  const tip = new THREE.Object3D(); tip.position.set(0, tipY - 0.3, 0); lens.add(tip);

  // its light: a real spotlight with shadows, so cover is visible
  const spot = new THREE.SpotLight(0xffe6cc, 7, 40, 0.34, 0.35, 1);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.5; spot.shadow.camera.far = 40;
  spot.shadow.bias = -0.0008;
  L.group.add(spot, spot.target);

  // the warning ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(cfg.radius - 0.16, cfg.radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 4; ring.userData.noAO = true;
  L.group.add(ring);

  // straps are ordinary emulsion blocks in the level (tag "strap"); each gets a sliding steel sleeve
  const straps = L.statics.filter(s => s.src && s.src.tag === 'strap');
  const sleeves = straps.map(st => {
    const pad = 0.18;
    const min = [st.min.x - pad, st.min.y, st.min.z - pad], max = [st.max.x + pad, st.max.y, st.max.z + pad];
    const c = min.map((m, i) => (m + max[i]) / 2);
    const body = L.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...c));
    const col = L.world.createCollider(R.ColliderDesc.cuboid((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2), body);
    L.colliders.set(col.handle, { kind: 'door', ref: {} });
    const mesh = new THREE.Mesh(worldBox(min, max), MAT.door);
    mesh.position.set(...c); mesh.castShadow = true; mesh.userData.kind = 'door';
    L.group.add(mesh); L.rayMeshes.push(mesh);
    return { body, mesh, home: c };
  });

  const b = L.boss = {
    cfg, root, lens, tip, eye, iris, eyeMat, bulb, bulbMat, status, spot, ring, straps, sleeves, headCollider: null,
    aim: new V3(cfg.head[0], 0, cfg.head[2] + 4),
    // simulation state (snapshotted)
    phase: 1, t: cfg.grace, attack: null, sleeveT: 0, cuts: 0, fallT: 0, warnT: 0, defeated: false, deadT: 0,
    // not snapshotted
    exposure: 0, calm: 0, zapped: false,
  };
  setHeadCollider(b);
  pose(b);
  aimLens(b);
}

// Where the head is and how it's tilted, from the simulation state.
function headPose(b) {
  const cfg = b.cfg, pos = new V3(...cfg.head), q = new Q();
  if (b.fallT <= 0) {
    // lean towards each cut strap
    for (const st of b.straps) if (st.erased) {
      const dx = (st.min.x + st.max.x) / 2 - pos.x, dz = (st.min.z + st.max.z) / 2 - pos.z;
      const axis = new V3(dz, 0, -dx).normalize();
      q.premultiply(new Q().setFromAxisAngle(axis, -0.13));
    }
    if (b.warnT > 0) pos.y += Math.sin(b.warnT * 40) * 0.05; // shuddering before it goes
    return { pos, q };
  }
  // falling, then lying on its back with the lens towards the room
  const e = Math.min(1, b.fallT), t = e * e;
  pos.lerp(new V3(...cfg.fallen), t);
  q.setFromAxisAngle(new V3(1, 0, 0), -Math.PI / 2 * t);
  return { pos, q };
}

function pose(b) {
  const { pos, q } = headPose(b);
  b.root.position.copy(pos); b.root.quaternion.copy(q);
  // sleeves slide up into the ceiling
  const e = 1 - Math.pow(1 - b.sleeveT, 3);
  for (const s of b.sleeves) {
    const p = { x: s.home[0], y: s.home[1] + 3.4 * e, z: s.home[2] };
    s.body.setNextKinematicTranslation(p); s.body.setTranslation(p, true);
    s.mesh.position.set(p.x, p.y, p.z);
  }
  b.bulb.visible = b.fallT >= 1 && !b.defeated;
}

function setHeadCollider(b) {
  const L = G.L, R = G.R;
  if (b.headCollider) { L.colliders.delete(b.headCollider.handle); L.world.removeCollider(b.headCollider, true); }
  const { pos, q } = headPose(b);
  const desc = R.ColliderDesc.cuboid(HOUSING[0] / 2, HOUSING[1] / 2 + 0.9, HOUSING[2] / 2)
    .setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  b.headCollider = L.world.createCollider(desc);
  L.colliders.set(b.headCollider.handle, { kind: 'static', ref: { kind: 'static' } });
}

export function bossState() {
  const b = G.L.boss;
  return b && { phase: b.phase, t: b.t, attack: b.attack && { ...b.attack }, sleeveT: b.sleeveT, cuts: b.cuts, fallT: b.fallT, warnT: b.warnT, defeated: b.defeated, deadT: b.deadT, aim: b.aim.toArray() };
}

export function restoreBoss(s) {
  const b = G.L.boss;
  if (!b || !s) return;
  Object.assign(b, s, { attack: null, zapped: false, exposure: 0, calm: 0 });
  b.aim = new V3().fromArray(s.aim);
  b.t = Math.max(b.t, 2.5); // a moment to breathe after a rewind
  b.ring.visible = false;
  pose(b);
  setHeadCollider(b);
  aimLens(b);
}

// Can the lens see the player? Glass lets light through; everything else blocks it.
function lensSees(from) {
  const L = G.L, R = G.R, b = L.boss;
  const head = { x: P.pos.x, y: P.pos.y + PLAYER.height * 0.6, z: P.pos.z };
  const d = new V3(head.x - from.x, head.y - from.y, head.z - from.z);
  const dist = d.length();
  d.normalize();
  const hit = L.world.castRay(new R.Ray(from, { x: d.x, y: d.y, z: d.z }), dist, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, b.headCollider, P.body,
    c => { const i = L.colliders.get(c.handle); return !i || i.kind !== 'glass'; });
  return !hit || hit.timeOfImpact >= dist - 0.3;
}

// Called by the camera: is the Curator itself in the shot? Ends the fight once it's on the floor.
export function photographBoss() {
  const L = G.L, b = L && L.boss;
  if (!b || b.defeated || b.fallT < 1) return false;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), G.camera);
  ray.far = 40;
  b.root.updateMatrixWorld(true);
  const hits = ray.intersectObjects([b.bulb, b.eye, b.iris, ...L.rayMeshes], false);
  const first = hits.find(h => h.object.userData.kind !== 'glass');
  if (!first || ![b.bulb, b.eye, b.iris].includes(first.object)) return false;
  b.defeated = true; b.attack = null; b.ring.visible = false;
  openDoor(true);
  if (!G.headless) SFX.dying();
  storyEvent('defeated');
  return true;
}

export function stepBoss() {
  const L = G.L, b = L.boss;
  if (!b) return;
  const cfg = b.cfg;
  if (b.defeated) {
    b.deadT += DT;
    b.eyeMat.emissiveIntensity = Math.max(0, 3 - b.deadT * 2);
    b.bulbMat.emissiveIntensity = Math.max(0, 3 - b.deadT * 1.5);
    b.spot.intensity = Math.max(0, b.spot.intensity - DT * 3);
    b.status.visible = false;
    b.ring.visible = false;
    return;
  }

  // phase 1 → 2: both counterweights loaded, and the sleeves slide away (for good)
  if (b.phase === 1 && L.plates.length && L.plates.every(p => p.on)) {
    b.phase = 2;
    if (!G.headless) SFX.shutter2();
    storyEvent('phase2');
  }
  if (b.phase >= 2 && b.sleeveT < 1) { b.sleeveT = Math.min(1, b.sleeveT + DT / 1.5); pose(b); }

  // phase 2: straps being cut
  const cuts = b.straps.filter(s => s.erased).length;
  if (cuts !== b.cuts) {
    b.cuts = cuts;
    if (!G.headless) SFX.boom();
    emit('shake', 0.35);
    if (cuts < b.straps.length) storyEvent(`cut${cuts}`);
    pose(b); setHeadCollider(b);
  }
  // all cut: it shudders for a second, then falls
  if (b.phase === 2 && cuts === b.straps.length) { b.phase = 3; b.warnT = 1; b.attack = null; b.ring.visible = false; storyEvent('falling'); }
  if (b.phase === 3 && b.fallT < 1) {
    if (b.warnT > 0) { b.warnT = Math.max(0, b.warnT - DT); if (b.warnT === 0) b.fallT = 0.001; }
    else {
      b.fallT = Math.min(1, b.fallT + DT / 0.8);
      if (b.fallT >= 1) {
        if (!G.headless) SFX.boom();
        emit('shake', 1);
        setHeadCollider(b);
        // don't bury the player under it
        const f = cfg.fallen, hx = HOUSING[0] / 2 + 1.3, hz = HOUSING[1] / 2 + 1.3;
        if (Math.abs(P.pos.x - f[0]) < hx && Math.abs(P.pos.z - f[2]) < hz + 2) { P.pos.z = f[2] + hz + 2.4; P.body.setTranslation({ x: P.pos.x, y: P.pos.y + PLAYER.height / 2, z: P.pos.z }, true); }
        storyEvent('phase3');
        b.t = cfg.interval[2];
      }
    }
    pose(b);
    if (b.fallT < 1) { aimLens(b); return; }
  }

  // exposure fades if you stay clear
  b.calm += DT;
  if (b.exposure > 0 && b.calm > 8) { b.exposure--; b.calm = 0; }

  // the spotlight follows you, lagging behind; once charging, it holds still
  const speed = [2.6, 3.6, 0][b.phase - 1] || 0;
  if (!b.attack && speed) {
    const to = new V3(P.pos.x - b.aim.x, 0, P.pos.z - b.aim.z);
    const step = Math.min(to.length(), speed * DT);
    if (step > 0) b.aim.addScaledVector(to.normalize(), step);
  }
  if (b.fallT >= 1 && !b.attack) b.aim.set(P.pos.x, 0, P.pos.z); // on the floor it just stares at you
  aimLens(b);

  if (b.attack) {
    b.attack.t -= DT;
    const k = Math.max(0, b.attack.t / cfg.warn);
    b.ring.scale.setScalar(0.55 + 0.45 * k);
    b.eyeMat.emissiveIntensity = 0.6 + 5 * (1 - k);
    b.eyeMat.emissive.setRGB(1, 0.84 * k + 0.1, 0.69 * k + 0.06);
    b.spot.color.setRGB(1, 0.9 * k + 0.1, 0.8 * k + 0.1);
    b.spot.angle = 0.34 - 0.16 * (1 - k);
    b.spot.intensity = 7 + 14 * (1 - k);
    if (b.attack.t <= 0) {
      const from = new V3(); b.tip.getWorldPosition(from);
      const inside = Math.hypot(P.pos.x - b.attack.x, P.pos.z - b.attack.z) < cfg.radius;
      const hit = inside && lensSees(from);
      if (hit) {
        b.exposure++; b.calm = 0;
        if (b.exposure >= cfg.hits) { b.zapped = true; b.exposure = 0; storyEvent('overexposed'); }
        else storyEvent('exposed');
      } else storyEvent('dodged');
      if (!G.headless) SFX.flash();
      emit('whiteout', hit);
      b.spot.intensity = SET.flashing === 'reduced' ? 12 : 30;
      b.attack = null; b.ring.visible = false;
      b.eyeMat.emissive.setHex(0xffd6b0);
      b.spot.color.setHex(0xffe6cc); b.spot.angle = 0.34;
      b.t = cfg.interval[b.phase - 1];
    }
  } else {
    b.spot.intensity = Math.max(7, b.spot.intensity - DT * 60);
    b.eyeMat.emissiveIntensity = Math.max(0.6, b.eyeMat.emissiveIntensity - DT * 6);
    b.t -= DT;
    if (b.t <= 0) {
      b.attack = { x: b.aim.x, z: b.aim.z, t: cfg.warn };
      b.ring.position.set(b.aim.x, 0.03, b.aim.z);
      b.ring.visible = true;
      if (!G.headless) SFX.charge(cfg.warn);
    }
  }
}

// Point the lens (and its light) at the aim point.
function aimLens(b) {
  b.root.updateMatrixWorld(true);
  const target = new V3(b.aim.x, 0, b.aim.z);
  b.lens.rotation.set(0, 0, 0);
  if (b.fallT <= 0) {
    // swivel the lens assembly within the head's frame, up to about 45°
    const local = b.root.worldToLocal(target.clone()).sub(b.lens.position);
    const yaw = Math.atan2(local.x, local.z), down = Math.atan2(Math.hypot(local.x, local.z), -local.y);
    b.lens.rotateY(yaw); b.lens.rotateX(-Math.min(0.8, down));
  }
  b.lens.updateMatrixWorld(true);
  const from = new V3(); b.tip.getWorldPosition(from);
  b.spot.position.copy(from);
  b.spot.target.position.copy(b.fallT >= 1 ? new V3(P.pos.x, P.pos.y + 1, P.pos.z) : target);
  b.spot.target.updateMatrixWorld();
}

// What the HUD shows about the fight.
export function bossHUD() {
  const b = G.L && G.L.boss;
  if (!b) return null;
  const goal = b.defeated ? 'It has stopped.'
    : b.phase === 1 ? 'Load both counterweight plates'
    : b.phase === 2 ? 'Dissolve its straps with negatives'
    : b.fallT < 1 ? "It's coming down!"
    : 'Photograph it';
  return { goal, straps: b.straps.length, cut: b.cuts, exposure: b.exposure, hits: b.cfg.hits, defeated: b.defeated };
}
