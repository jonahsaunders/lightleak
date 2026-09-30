// Camera actions shared by live play, recordings, and the renderer-free checks.
import { G, emit } from './state.js';
import { CAMERA } from './config.js';
import { takePhoto, develop, discard } from './photo.js';
import { SFX } from './audio.js';
import { sessionEvent } from './sessions.js';

export function handleCameraAction(action) {
  const L = G.L, [name, arg] = action.split(':'), n = Number(arg);
  if (name === 'click') {
    if (G.aim) { const neg = G.filmMode === 'neg'; if (takePhoto()) sessionEvent(neg ? 'negative' : 'photo'); }
    else if (G.selected >= 0) { const p = G.roll[G.selected]; if (develop()) sessionEvent(p.neg ? 'dissolve' : 'develop'); }
  } else if (name === 'aimtoggle') {
    G.aimToggle = !G.aimToggle; if (G.aimToggle) G.selected = -1; emit('rollChanged');
  } else if (name === 'select') {
    G.selected = n < 0 || n >= G.roll.length || G.selected === n ? -1 : n;
    G.aimToggle = false; emit('rollChanged');
  } else if (name === 'cycle') {
    const k = G.roll.length;
    G.selected = !k ? -1 : G.selected < 0 ? (n > 0 ? 0 : k - 1) : (G.selected + n + k) % k;
    G.aimToggle = false; emit('rollChanged');
  } else if (name === 'rotate') {
    const p = G.roll[G.selected];
    if (p) { p.rot = (p.rot + n + 4) % 4; if (!G.headless) SFX.click(); emit('rollChanged'); }
  } else if (name === 'discard') discard();
  else if (name === 'frame') {
    const last = CAMERA.frames.length - 1;
    if (!L.def.wide) emit('toast', 'Wide framing becomes available in restoration.');
    else {
      const next = arg === 'cycle' ? (G.frameIdx + 1) % (last + 1) : window.THREE.MathUtils.clamp(G.frameIdx + n, 0, last);
      if (next !== G.frameIdx && !G.headless) SFX.click();
      G.frameIdx = next;
    }
  } else if (name === 'film') {
    const other = G.filmMode === 'pos' ? 'neg' : 'pos';
    if ((L.def.film?.[other] ?? 0) > 0) {
      G.filmMode = other;
      if (!G.headless) { SFX.click(); emit('filmSwitched'); }
      emit('rollChanged');
    }
  } else return false;
  return true;
}
