// The player: a kinematic capsule driven by Rapier's character controller.
import { G } from './state.js';
import { PLAYER, DT } from './config.js';
import { SFX } from './audio.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;
const HALF = (PLAYER.height - 2 * PLAYER.radius) / 2;
const JUMP_V = Math.sqrt(2 * PLAYER.gravity * PLAYER.jump);

export const P = {
  pos: new V3(), prev: new V3(), vel: new V3(), yaw: 0, pitch: 0, grounded: false,
  coyote: 0, jumpBuffer: 0, jumpHeld: false,
  body: null, collider: null, ctrl: null,
};

export function createPlayer(world) {
  const R = G.R;
  P.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
  P.collider = world.createCollider(R.ColliderDesc.capsule(HALF, PLAYER.radius).setFriction(0), P.body);
  G.L.colliders.set(P.collider.handle, { kind: 'player', ref: P });
  const c = world.createCharacterController(0.02);
  c.setUp({ x: 0, y: 1, z: 0 });
  c.enableAutostep(PLAYER.step, 0.1, true);
  c.enableSnapToGround(0.25);
  c.setMaxSlopeClimbAngle(50 * Math.PI / 180);
  // Props only move under gravity: shoving them around made balanced setups too easy to wreck.
  c.setApplyImpulsesToDynamicBodies(false);
  P.ctrl = c;
}

export function placePlayer(pos, yaw, pitch = 0) {
  P.pos.fromArray(pos); P.prev.copy(P.pos);
  P.vel.set(0, 0, 0);
  P.yaw = yaw; P.pitch = pitch;
  P.grounded = false; P.coyote = 0; P.jumpBuffer = 0; P.jumpHeld = false;
  const c = { x: P.pos.x, y: P.pos.y + PLAYER.height / 2, z: P.pos.z };
  P.body.setTranslation(c, true);
  P.body.setNextKinematicTranslation(c);
}

// input: { f, r, jump, yaw, pitch }
export function stepPlayer(input) {
  P.prev.copy(P.pos);
  P.yaw = input.yaw; P.pitch = input.pitch;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let wx = -sy * input.f + cy * input.r, wz = -cy * input.f - sy * input.r;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; } // scripted input can ask for less than full speed
  const acc = (P.grounded ? 60 : 14) * DT;
  P.vel.x += THREE.MathUtils.clamp(wx * PLAYER.speed - P.vel.x, -acc, acc);
  P.vel.z += THREE.MathUtils.clamp(wz * PLAYER.speed - P.vel.z, -acc, acc);
  // Forgive an early press before landing, or a late press just after a ledge.
  P.coyote = P.grounded ? PLAYER.coyote : Math.max(0, P.coyote - DT);
  P.jumpBuffer = input.jump && !P.jumpHeld ? PLAYER.jumpBuffer : Math.max(0, P.jumpBuffer - DT);
  P.jumpHeld = !!input.jump;
  if (P.coyote > 0 && P.jumpBuffer > 0) {
    P.vel.y = JUMP_V; P.grounded = false; P.coyote = 0; P.jumpBuffer = 0;
  }
  // While grounded, don't push down into the floor: Rapier's controller then sometimes refuses the
  // horizontal part of the move. Snap-to-ground keeps us on the floor, and walking off an edge
  // ungrounds us so gravity takes over next tick.
  if (P.grounded && P.vel.y <= 0) P.vel.y = 0;
  else P.vel.y = Math.max(P.vel.y - PLAYER.gravity * DT, -30);

  const want = { x: P.vel.x * DT, y: P.vel.y * DT, z: P.vel.z * DT };
  P.ctrl.computeColliderMovement(P.collider, want, G.R.QueryFilterFlags.EXCLUDE_SENSORS);
  const m = P.ctrl.computedMovement();
  const wasGrounded = P.grounded;
  P.grounded = P.ctrl.computedGrounded();
  const fallSpeed = -P.vel.y;
  if (P.grounded && P.vel.y < 0) P.vel.y = 0;
  if (want.y > 0 && m.y < want.y * 0.5) P.vel.y = 0; // bumped a ceiling
  // keep horizontal speed honest when something blocks us
  if (Math.abs(want.x) > 1e-6) P.vel.x *= THREE.MathUtils.clamp(m.x / want.x, 0, 1);
  if (Math.abs(want.z) > 1e-6) P.vel.z *= THREE.MathUtils.clamp(m.z / want.z, 0, 1);
  P.pos.x += m.x; P.pos.y += m.y; P.pos.z += m.z;
  P.body.setNextKinematicTranslation({ x: P.pos.x, y: P.pos.y + PLAYER.height / 2, z: P.pos.z });
  if (P.grounded && !wasGrounded && fallSpeed > 9 && !G.headless) SFX.land(fallSpeed / 9);
}

export function eyePosition(out, alpha = 1) {
  return out.lerpVectors(P.prev, P.pos, alpha).add(new V3(0, PLAYER.eye, 0));
}

