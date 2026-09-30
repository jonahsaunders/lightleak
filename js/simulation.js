// The same fixed step is used in desktop/browser play and Node gameplay verification.
import { G, emit } from './state.js';
import { DT, CAMERA } from './config.js';
import { P, stepPlayer } from './player.js';
import { stepWorld, playerInExit, restore } from './level.js';
import { SFX } from './audio.js';
import { storyEvent } from './story.js';
import { sessionEvent } from './sessions.js';

export function stepSimulation(input, { handle, syncCamera, beforeActions = () => {} }) {
  const L = G.L;
  if (!L || L.finished) return null;
  P.yaw = input.yaw; P.pitch = input.pitch;
  G.aim = input.aim || G.aimToggle;
  const fov = G.aim ? CAMERA.aimFov : CAMERA.fov;
  if (Math.abs(G.logicFov - fov) > 0.01) G.logicFov += (fov - G.logicFov) * Math.min(1, DT * 14);
  syncCamera(); beforeActions(input);
  for (const a of input.actions) { handle(a); if (G.L !== L) return null; }
  stepPlayer(input); stepWorld(); G.tick++;
  if (L.boss?.zapped) {
    L.boss.zapped = false; sessionEvent('overexposed'); restore(G.checkpoint);
    emit('toast', 'Overexposed. Back to your last shot.'); return 'rewound';
  }
  if (playerInExit()) return 'finished';
  if (P.pos.y < L.killY) {
    if (!G.headless) SFX.fall(); storyEvent('fall'); sessionEvent('fall');
    restore(G.checkpoint);
    emit('toast', G.undo.length ? 'You fell. Back to your last shot.' : 'You fell. Back to the start.');
    return 'rewound';
  }
  return null;
}
