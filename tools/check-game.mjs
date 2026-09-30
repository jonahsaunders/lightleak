// Real Rapier physics, Three geometry and the live action/simulation modules, without a GPU.
// Canvas drawing is omitted; this verifies solutions and geometry, not final rendered pixels.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
globalThis.window = { performance, THREE: require('../vendor/three.min.js') };
const T = window.THREE;
const noop = () => {};
globalThis.document = {
  createElement() {
    const canvas = { width: 256, height: 256 };
    const context = new Proxy({
      getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      measureText: text => ({ width: String(text).length * 8 }),
    }, { get: (obj, key) => key in obj ? obj[key] : noop });
    canvas.getContext = () => context;
    return canvas;
  },
};
const { default: R } = await import('../vendor/rapier.mjs');
await R.init();
const { G } = await import('../js/state.js');
const { MAT, PROP, PRINT_TEX } = await import('../js/materials.js');
for (const key of ['wall', 'wainscot', 'floor', 'ceil', 'ledge', 'dark', 'door', 'trim', 'trimLight', 'panel', 'safelight', 'emulsion', 'wood', 'metal', 'tray', 'liquid'])
  MAT[key] = new T.MeshStandardMaterial({ color: 0x777777 });
MAT.glass = new T.MeshPhysicalMaterial({ transparent: true, opacity: 0.12 });
MAT.string = new T.LineBasicMaterial();
for (const key of ['crate', 'steel', 'plank']) PROP[key] = { map: null, normalMap: null, roughnessMap: null, roughness: 0.8, metalness: 0 };
for (let i = 0; i < 6; i++) PRINT_TEX.push(new T.Texture());
const { P, eyePosition } = await import('../js/player.js');
const { snapshot, restore, loadLevel } = await import('../js/level.js');
const { handleCameraAction } = await import('../js/actions.js');
const { stepSimulation } = await import('../js/simulation.js');
const { runTests } = await import('../js/driver.js');
const { HintState } = await import('../js/hints.js');
const { gameViewport, captureAngles, capturePixels } = await import('../js/framing.js');
const { lightReachesPlayer } = await import('../js/exposure.js');

Object.assign(G, { R, headless: true, mode: 'playing', tick: 0, logicFov: 75,
  scene: new T.Scene(), camera: new T.PerspectiveCamera(75, 1.6, 0.05, 200) });
G.scene.fog = new T.Fog(0x0b0908, 28, 70); G.scene.background = new T.Color();
G.camera.rotation.order = 'YXZ'; G.scene.add(G.camera);
G.hooks = { levelLoaded() { G.aimToggle = false; G.checkpoint = snapshot(); }, acted() { G.checkpoint = snapshot(); } };
G.chapters = JSON.parse(fs.readFileSync(path.join(root, 'levels/index.json'))).chapters;
G.order = G.chapters.flatMap(c => c.levels);
for (const id of G.order) G.defs[id] = JSON.parse(fs.readFileSync(path.join(root, `levels/${id}.json`)));

function syncCamera() {
  G.camera.fov = G.logicFov; G.camera.updateProjectionMatrix();
  eyePosition(G.camera.position); G.camera.rotation.set(P.pitch, P.yaw, 0); G.camera.updateMatrixWorld(true);
}
function tick(input) {
  const result = stepSimulation(input, { handle: handleCameraAction, syncCamera });
  if (result === 'finished') G.L.finished = true;
}
const report = await runTests(tick);
for (const r of report.results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}: ${r.ok ? r.note || `${r.seconds.toFixed(1)}s` : r.why}`);

// Busy-but-stuck players must receive help; genuinely new understanding postpones it.
const hints = new HintState();
hints.progress('first-photo');
for (let i = 0; i < 7; i++) { hints.step(10); hints.attempt('same-shot'); hints.progress('first-photo'); }
assert.equal(hints.due(), 1);
hints.revealed(1); for (let i = 0; i < 6; i++) hints.fail(); assert.equal(hints.due(), 2);
hints.progress('new-plate'); assert.equal(hints.failures, 0); assert.equal(hints.idle, 0);
const idle = new HintState(); idle.step(70); assert.equal(idle.due(), 1);
idle.revealed(1); idle.step(80); assert.equal(idle.due(), 2);
console.log('PASS idle and active-failure hint escalation');

if (G.defs['light-study']) {
  loadLevel(G.defs['light-study']);
  const from = new T.Vector3(...G.L.inspection.cfg.pos);
  P.pos.set(0, 0, 3); assert.equal(lightReachesPlayer(from), false, 'solid pillar blocks light');
  P.pos.set(3, 0, 3); assert.equal(lightReachesPlayer(from), true, 'glass admits light');
  const saved = snapshot(); G.L.inspection.complete = true; G.L.inspection.time = 25; restore(saved);
  assert.equal(G.L.inspection.complete, false); assert.equal(G.L.inspection.time, 0);
  console.log('PASS shared exposure rule and inspection rewind');
}

// Developing/restoring a named archival object retains its identity.
loadLevel(G.defs.exposure);
const saved = snapshot(); restore(saved);
assert.equal(G.L.props[0].label, G.defs.exposure.props[0].label);
console.log('PASS archive labels survive undo');
// Check buffered/late jumping on the actual capsule controller.
loadLevel(G.defs.exposure);
const still = { f: 0, r: 0, yaw: 0, pitch: 0, aim: false, jump: false, actions: [] };
for (let i = 0; i < 3; i++) tick(still);
assert.equal(P.grounded, true);
P.grounded = false; P.coyote = 0.08;
tick({ ...still, jump: true }); assert.ok(P.vel.y > 0, 'late jump after leaving a ledge');
loadLevel(G.defs.exposure);
P.pos.y = 0.05; P.body.setTranslation({ x: P.pos.x, y: P.pos.y + 0.875, z: P.pos.z }, true);
P.body.setNextKinematicTranslation({ x: P.pos.x, y: P.pos.y + 0.875, z: P.pos.z });
P.vel.y = -2;
tick({ ...still, jump: true });
let buffered = false;
for (let i = 0; i < 8; i++) { tick(still); if (P.vel.y > 0) buffered = true; }
assert.equal(buffered, true, 'early jump press before landing');
console.log('PASS late-jump grace and early-press buffering');

// Exercise the live hint API as well as its state: progressive and repeatable, with no assets.
const elements = new Map();
document.getElementById = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, classList: { add: noop, remove: noop, toggle: noop } });
  return elements.get(id);
};
const { storyReset, requestHint, storyFrame, storyFailure } = await import('../js/story.js');
G.headless = false; storyReset();
requestHint(); assert.ok(elements.get('fi-hint').textContent.includes('see through glass'));
requestHint(); assert.ok(elements.get('fi-hint').textContent.includes('develop the copy'));
requestHint(); storyFrame(0.1);
assert.equal(elements.get('sub-who').textContent, 'CURATOR');
storyReset(); for (let i = 0; i < 6; i++) storyFailure(); storyFrame(0.1);
assert.ok(elements.get('fi-hint').textContent.includes('see through glass'));
G.headless = true;
console.log('PASS manual, repeated and active-failure hints in the live story API');
for (const [width, height] of [[1280, 800], [640, 1200], [1920, 1080]]) {
  const viewport = gameViewport(width, height);
  const pixels = capturePixels(52, 52, viewport);
  const angles = captureAngles(52);
  assert.ok(pixels.x >= 0 && pixels.y >= 0, 'capture frame fits the viewport');
  assert.ok(Math.abs(pixels.w / pixels.h - 4 / 3) < 1e-9);
  assert.ok(Math.abs(pixels.w / viewport.w - angles.tx / (Math.tan(52 * Math.PI / 360) * (viewport.w / viewport.h))) < 1e-9);
}
console.log('PASS capture/viewfinder projection at landscape and portrait sizes');
console.log(`\n${report.passed} gameplay/geometry checks passed, ${report.failed} failed`);
process.exitCode = report.failed ? 1 : 0;
