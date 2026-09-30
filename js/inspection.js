// A safe encounter teaches the final fight's actual visibility rule.
import { G } from './state.js';
import { P } from './player.js';
import { DT } from './config.js';
import { MAT } from './materials.js';
import { lightReachesPlayer } from './exposure.js';
import { storyEvent } from './story.js';
import { SFX } from './audio.js';

export function createInspection(cfg) {
  const T = window.THREE, L = G.L;
  const lamp = new T.Mesh(new T.CylinderGeometry(0.45, 0.6, 0.45, 20), MAT.trim);
  lamp.position.fromArray(cfg.pos); L.group.add(lamp);
  const spot = new T.SpotLight(0xffc27a, 12, 35, 0.5, 0.3, 1);
  spot.position.fromArray(cfg.pos); spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0006;
  L.group.add(spot, spot.target);
  L.inspection = { cfg, spot, time: 0, warning: false, exposed: 0, sheltered: 0, complete: false };
}

export function stepInspection() {
  const s = G.L.inspection;
  if (!s) return;
  s.time += DT;
  s.spot.target.position.set(P.pos.x, P.pos.y + 0.5, P.pos.z);
  s.spot.target.updateMatrixWorld();
  const cycle = s.cfg.interval || 5;
  const phase = s.time % cycle;
  const warning = phase > cycle - 1.4;
  if (warning && !s.warning && !G.headless) SFX.charge(1.4);
  const flashing = !warning && s.warning;
  s.warning = warning;
  s.spot.color.setHex(warning ? 0xf06a4f : 0xffd6b0);
  s.spot.intensity = warning ? 18 : 10;
  if (flashing) {
    if (lightReachesPlayer(s.spot.position)) {
      s.exposed++; storyEvent('inspection:exposed');
    } else {
      s.sheltered++; s.complete = true; storyEvent('inspection:sheltered');
    }
    // A mechanical click, never a screen flash or damage, even on reduced-flashing settings.
    if (!G.headless) SFX.shutter();
  }
}

export function inspectionState() {
  const s = G.L.inspection;
  return s ? { time: s.time, warning: s.warning, exposed: s.exposed, sheltered: s.sheltered, complete: s.complete } : null;
}
export function restoreInspection(state) { if (state && G.L.inspection) Object.assign(G.L.inspection, state); }
