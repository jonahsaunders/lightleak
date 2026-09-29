// Stages the README screenshots. Loaded only with ?shots; `npm run shots` drives it from Electron,
// which captures each staged scene to docs/screenshots/.
import { G } from './state.js';
import { P } from './player.js';
import { Driver } from './driver.js';
import { loadLevel } from './level.js';
import { updateAim, updateRoll } from './hud.js';
import { openReview, closeReview } from './review.js';
import { importSessions } from './sessions.js';

const THREE = window.THREE;
const $ = id => document.getElementById(id);
const ll = () => window.lightleak;

// Play part of a level's stored solution, silently and instantly.
// With `live`, photos get real thumbnails, rendered at the moment the shutter fires.
function play(id, steps, { live = false } = {}) {
  const { tick, thumbNow } = ll();
  G.headless = !live;
  loadLevel(G.defs[id]);
  G.tick = 0; G.logicFov = 75;
  const d = new Driver({ ...G.defs[id], solution: steps });
  let input;
  while ((input = d.next())) { tick(input); if (live && G.pendingThumb) thumbNow(); }
  G.headless = false;
  return d.error;
}
const hold = (n = 30) => { for (let i = 0; i < n; i++) ll().tick({ f: 0, r: 0, jump: false, yaw: P.yaw, pitch: P.pitch, aim: false, actions: [] }); };
const lookAngles = (from, at) => ({ yaw: Math.atan2(-(at[0] - from[0]), -(at[2] - from[2])), pitch: Math.atan2(at[1] - from[1], Math.hypot(at[0] - from[0], at[2] - from[2])) });

function hudOn(on) {
  $('menu').hidden = true; $('review').hidden = true; $('editor').hidden = true;
  $('hud').hidden = !on;
  $('titlecard').classList.remove('on'); $('toast').classList.remove('on'); $('subtitle').hidden = true;
  $('shot-title').hidden = true;
}
// A free camera for scenery shots (no HUD, no camera in hand).
function freeCamera(pos, at, fov = 70) {
  G.mode = 'debug';
  hudOn(false);
  G.camera.position.set(...pos); G.camera.fov = fov; G.camera.updateProjectionMatrix();
  G.camera.lookAt(...at); G.camera.updateMatrixWorld();
}
// First person, with HUD and the camera in hand; the live loop keeps the pose.
function firstPerson(at) {
  const eye = [P.pos.x, P.pos.y + 1.6, P.pos.z];
  const { yaw, pitch } = lookAngles(eye, at);
  ll().look(yaw, pitch);
  G.mode = 'playing';
  hudOn(true);
  updateRoll();
}

const SHOTS = {
  banner() {
    // mid-fight: two straps left, and a flash charging at someone standing in the open
    play('enlarger', G.defs.enlarger.solution.slice(0, 13));
    P.pos.set(-3, 0, -18); P.body.setTranslation({ x: -3, y: 0.875, z: -18 }, true);
    let n = 0; while (!(G.L.boss.attack && G.L.boss.attack.t < 0.45) && n++ < 3000) hold(1);
    freeCamera([8, 1.9, 3.5], [-1.5, 6.8, -13], 64);
    $('shot-title').hidden = false;
  },
  enlarger() {
    play('enlarger', G.defs.enlarger.solution.slice(0, 13));
    P.pos.set(3.5, 0, -17); P.body.setTranslation({ x: 3.5, y: 0.875, z: -17 }, true);
    let n = 0; while (!(G.L.boss.attack && G.L.boss.attack.t < 0.5) && n++ < 3000) hold(1);
    freeCamera([-9, 4.2, -2.5], [1, 5, -15], 66);
  },
  viewfinder() {
    play('group-shot', []);
    P.pos.set(0, 0, 0.3); P.body.setTranslation({ x: 0, y: 0.875, z: 0.3 }, true);
    firstPerson([0, 0.5, 4.5]);
    G.aimToggle = true; G.frameIdx = 3; G.logicFov = 52;
  },
  develop() {
    play('doubling', G.defs.doubling.solution.slice(0, 3), { live: true });
    G.selected = 0;
    firstPerson([-1, 0.08, -8]);
  },
  staircase() {
    play('staircase', G.defs.staircase.solution.slice(0, 4)); hold(60);
    freeCamera([5.8, 2.2, 0.5], [-0.5, 1.6, -7], 68);
  },
  negative() {
    play('clearance', G.defs.clearance.solution.slice(0, 1));
    G.filmMode = 'neg';
    firstPerson([0, 0.7, -7]);
    G.aimToggle = true; G.logicFov = 52;
  },
  darkroom() {
    play('darkroom', []);
    freeCamera([4.5, 1.7, -8.5], [-3, 1.8, 3], 72);
  },
  photograph() {
    const sol = G.defs.enlarger.solution, i = sol.findIndex(s => s.shoot && s.film === 'pos' && s.shoot[1] === 2.02);
    play('enlarger', sol.slice(0, i));
    G.L.boss.exposure = 0; G.L.boss.t = 30; G.L.boss.attack = null; G.filmMode = 'pos';
    firstPerson([0, 2.02, -9.5]);
  },
  daylight() {
    play('daylight', []);
    P.pos.set(0, 0, 1); P.body.setTranslation({ x: 0, y: 0.875, z: 1 }, true);
    freeCamera([0, 1.6, 1], [0, 1.5, -20], 70);
  },
  async review(sessions) {
    if (sessions) importSessions(sessions);
    G.mode = 'title'; hudOn(false);
    await openReview('overhang');
  },
  editor() {
    play('staircase', []);
    ll().editor.open(G.defs.staircase);
    const ed = ll().editor;
    ed.cam.pos.set(5.8, 5.4, 1.5); ed.cam.yaw = 0.48; ed.cam.pitch = -0.4;
    ed.frame(0); ed.tool = 'prop'; ed.renderPanel();
  },
};

export async function stage(name, data) {
  G.shots = true; // keeps the Curator quiet
  closeReview();
  if (G.mode === 'editor') $('editor').hidden = true;
  G.aimToggle = false; G.selected = -1; G.filmMode = 'pos'; G.frameIdx = 0;
  await SHOTS[name](data);
  if (G.mode === 'debug') updateAim();
  return true;
}
export const SHOT_NAMES = Object.keys(SHOTS);
