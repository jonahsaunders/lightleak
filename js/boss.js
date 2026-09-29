// The final chamber: the Curator's enlarger. The floor is its easel and you are the print.
//
//   Attack  every few seconds it locks onto where you stand, warns for a moment, then flashes.
//           Caught in the open inside the ring, you're overexposed and rewound. Anything solid
//           between you and the lens (glass doesn't count) keeps you safe.
//   Phase 1 load every plate: the steel shutter over its lamp slides open.
//   Phase 2 dissolve the emulsion lid under the shutter with a negative.
//   Phase 3 drop something heavy onto the bulb, `hp` times. Develop it against the ceiling.
//
// Everything here runs in the fixed tick, so it's deterministic like the rest of the simulation.
import { G, emit } from './state.js';
import { DT, PLAYER } from './config.js';
import { MAT, worldBox } from './materials.js';
import { P } from './player.js';
import { openDoor, removeProp } from './level.js';
import { SFX } from './audio.js';
import { storyEvent } from './story.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;

export function createBoss(cfg) {
  const L = G.L, R = G.R;
  const g = new THREE.Group();
  L.group.add(g);
  const lens = new V3(...cfg.lens);
  const bellows = new THREE.MeshStandardMaterial({ color: 0x141211, roughness: 0.9 });
  const box = (w, h, d, x, y, z, m = MAT.door) => {
    const o = new THREE.Mesh(worldBox([x - w / 2, y - h / 2, z - d / 2], [x + w / 2, y + h / 2, z + d / 2]), m);
    o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
  };

  // the machine: a ribbed steel mast on the north wall, the lamp housing, pleated bellows and the lens
  const [lx, ly, lz] = cfg.lens;
  box(3, ly + 7, 2, lx, (ly + 7) / 2, lz - 4.5);
  box(0.9, ly + 7, 0.5, lx - 1.95, (ly + 7) / 2, lz - 4.2, MAT.trim);
  box(0.9, ly + 7, 0.5, lx + 1.95, (ly + 7) / 2, lz - 4.2, MAT.trim);
  box(5, 3.6, 5, lx, ly + 3.9, lz);
  box(5.3, 0.25, 5.3, lx, ly + 2.2, lz, MAT.trim);                       // collar under the housing
  box(5.3, 0.25, 5.3, lx, ly + 5.6, lz, MAT.trim);                       // and over it
  box(1.2, 2.2, 1.2, lx, ly + 3.9, lz - 3.2, MAT.trim);                  // arm back to the mast
  for (let i = 0; i < 7; i++) box(3.4 - i * 0.28, 0.2, 3.4 - i * 0.28, lx, ly + 1.95 - i * 0.26, lz, i % 2 ? MAT.trim : bellows);
  box(1.3, 0.3, 1.3, lx, ly + 0.15, lz, MAT.trim);
  // status lamp on the housing
  const status = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), MAT.safelight);
  status.position.set(lx + 1.8, ly + 4.9, lz + 2.52); g.add(status);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd6b0, emissiveIntensity: 0.4 });
  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.25, 32), eyeMat);
  eye.position.set(lx, ly, lz); g.add(eye);
  const lamp = new THREE.SpotLight(0xffe2c4, 0, 40, 0.5, 0.6, 1.5);
  lamp.position.copy(lens); lamp.target.position.set(lx, 0, lz + 10);
  g.add(lamp, lamp.target);

  // the bulb, and a steel shutter over its cage
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc27a, emissiveIntensity: 2.2, roughness: 0.2 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(cfg.bulbRadius, 32, 20), bulbMat);
  bulb.position.set(...cfg.bulb); g.add(bulb);
  const bulbLight = new THREE.PointLight(0xffc27a, 1.4, 12, 2);
  bulbLight.position.copy(bulb.position); g.add(bulbLight);
  const bulbCollider = L.world.createCollider(R.ColliderDesc.ball(cfg.bulbRadius).setTranslation(...cfg.bulb));
  L.colliders.set(bulbCollider.handle, { kind: 'static', ref: { kind: 'static' } });

  const s = cfg.shutter;
  const size = s.max.map((m, i) => m - s.min[i]);
  const home = s.min.map((m, i) => m + size[i] / 2);
  const shutterBody = L.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...home));
  const shutterCollider = L.world.createCollider(R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), shutterBody);
  L.colliders.set(shutterCollider.handle, { kind: 'door', ref: {} });
  const shutter = new THREE.Mesh(worldBox(s.min, s.max), MAT.door);
  shutter.position.set(...home); shutter.castShadow = true; shutter.userData.kind = 'door';
  g.add(shutter); L.rayMeshes.push(shutter);

  // the warning ring on the floor
  const ring = new THREE.Mesh(new THREE.RingGeometry(cfg.radius - 0.18, cfg.radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 4;
  g.add(ring);

  const lid = L.statics.find(st => st.src && st.src.tag === 'lid');
  L.boss = {
    cfg, lens, eye, eyeMat, lamp, bulb, bulbMat, bulbLight, bulbCollider, shutter, shutterBody, home, ring, lid,
    // simulation state (snapshotted)
    phase: 1, hp: cfg.hp, t: cfg.grace, attack: null, shutterT: 0, defeated: false, deadT: 0, zapped: false,
  };
}

export function bossState() {
  const b = G.L.boss;
  return b && { phase: b.phase, hp: b.hp, t: b.t, attack: b.attack && { ...b.attack }, shutterT: b.shutterT, defeated: b.defeated, deadT: b.deadT };
}

export function restoreBoss(s) {
  const b = G.L.boss;
  if (!b || !s) return;
  Object.assign(b, s, { attack: null, zapped: false });
  b.t = Math.max(b.t, 2.5); // a moment to breathe after a rewind
  if (!b.defeated && b.bulbRemoved) { // undone past the finishing blow
    b.bulbCollider = G.L.world.createCollider(G.R.ColliderDesc.ball(b.cfg.bulbRadius).setTranslation(...b.cfg.bulb));
    G.L.colliders.set(b.bulbCollider.handle, { kind: 'static', ref: { kind: 'static' } });
    b.bulbRemoved = false;
  }
  placeShutter(b);
  b.ring.visible = false;
  b.bulb.visible = b.hp > 0;
}

function placeShutter(b) {
  const m = b.cfg.shutter.move, e = 1 - Math.pow(1 - b.shutterT, 3);
  const p = { x: b.home[0] + m[0] * e, y: b.home[1] + m[1] * e, z: b.home[2] + m[2] * e };
  b.shutterBody.setNextKinematicTranslation(p);
  b.shutterBody.setTranslation(p, true);
  b.shutter.position.set(p.x, p.y, p.z);
}

function touching(a, c) {
  let n = 0;
  G.L.world.contactPair(a, c, m => { n += m.numContacts(); });
  return n > 0;
}

// Can the lens see the player? Glass lets light through; everything else blocks it.
function exposed() {
  const L = G.L, R = G.R, b = L.boss;
  const head = { x: P.pos.x, y: P.pos.y + PLAYER.height * 0.6, z: P.pos.z };
  const d = new V3(head.x - b.lens.x, head.y - b.lens.y, head.z - b.lens.z);
  const dist = d.length();
  d.normalize();
  const hit = L.world.castRay(new R.Ray(b.lens, { x: d.x, y: d.y, z: d.z }), dist, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, P.body,
    c => { const i = L.colliders.get(c.handle); return !i || i.kind !== 'glass'; });
  return !hit || hit.timeOfImpact >= dist - 0.3;
}

// Runs right after the physics step, before props record their velocity for the tick.
export function stepBoss() {
  const L = G.L, b = L.boss;
  if (!b) return;
  const cfg = b.cfg;
  if (b.defeated) {
    b.deadT += DT;
    b.eyeMat.emissiveIntensity = Math.max(0, 3 - b.deadT * 2);
    b.lamp.intensity = 0; b.ring.visible = false;
    return;
  }
  // phase 1 → 2: every plate loaded opens the shutter (and it stays open)
  if (b.phase === 1 && L.plates.length && L.plates.every(p => p.on)) {
    b.phase = 2;
    if (!G.headless) SFX.shutter2();
    storyEvent('phase2');
  }
  if (b.phase >= 2 && b.shutterT < 1) { b.shutterT = Math.min(1, b.shutterT + DT / 1.6); placeShutter(b); }
  // phase 2 → 3: the emulsion lid is gone
  if (b.phase === 2 && b.lid && b.lid.erased) { b.phase = 3; storyEvent('phase3'); }
  // something heavy dropped on the bulb
  if (b.phase === 3) {
    for (const p of L.props.slice()) {
      if (p.mass >= cfg.hitMass && p.fallVy < -4 && touching(b.bulbCollider, p.collider)) {
        removeProp(p);
        b.hp--;
        if (!G.headless) SFX.boom();
        emit('shake', 0.6);
        if (b.hp > 0) storyEvent(`hit${cfg.hp - b.hp}`);
        else {
          b.defeated = true;
          b.bulb.visible = false; b.bulbLight.intensity = 0;
          L.world.removeCollider(b.bulbCollider, true);
          b.bulbRemoved = true;
          openDoor(true);
          if (!G.headless) SFX.dying();
          storyEvent('defeated');
          return;
        }
      }
    }
  }
  const glow = b.hp / cfg.hp;
  b.bulbMat.emissiveIntensity = 0.6 + 1.6 * glow; b.bulbLight.intensity = 0.4 + glow;

  // the flash attack
  if (b.attack) {
    b.attack.t -= DT;
    const k = Math.max(0, b.attack.t / cfg.warn);
    b.ring.scale.setScalar(0.6 + 0.4 * k);
    b.eyeMat.emissiveIntensity = 0.4 + 4 * (1 - k);
    b.eyeMat.emissive.setRGB(1, 0.84 * k + 0.12, 0.69 * k + 0.08); // warms to red as it charges
    if (b.attack.t <= 0) {
      const inside = Math.hypot(P.pos.x - b.attack.x, P.pos.z - b.attack.z) < cfg.radius;
      if (inside && exposed()) { b.zapped = true; b.zaps = (b.zaps || 0) + 1; storyEvent('overexposed'); }
      else storyEvent('dodged');
      if (!G.headless) SFX.flash();
      emit('whiteout', inside);
      b.lamp.intensity = 12;
      b.eyeMat.emissive.setHex(0xffd6b0);
      b.attack = null; b.ring.visible = false;
      b.t = cfg.interval[b.phase - 1];
    }
  } else {
    b.lamp.intensity = Math.max(0, b.lamp.intensity - DT * 30);
    b.eyeMat.emissiveIntensity = Math.max(0.4, b.eyeMat.emissiveIntensity - DT * 6);
    b.t -= DT;
    if (b.t <= 0) {
      b.attack = { x: P.pos.x, z: P.pos.z, t: cfg.warn };
      b.ring.position.set(P.pos.x, P.pos.y + 0.03, P.pos.z);
      b.ring.visible = true;
      b.lamp.target.position.set(P.pos.x, P.pos.y, P.pos.z);
      if (!G.headless) SFX.charge(cfg.warn);
    }
  }
}
