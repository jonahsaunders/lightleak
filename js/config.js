// Tuning shared across modules.
export const DT = 1 / 60;                 // fixed simulation step
export const GRAVITY = 18;                // for props
export const PLAYER = {
  gravity: 22, jump: 1.3, speed: 5.2, eye: 1.6, height: 1.75, radius: 0.3,
  step: 0.45,
};
export const CAMERA = {
  fov: 75, aimFov: 52, range: 60, roll: 3,
  minDim: 0.15, maxDim: 10,               // a developed photo stays inside these sizes overall
  maxGroup: 8,                            // objects one photo can hold
  frames: [0, 0.3, 0.5, 0.75, 1],         // capture frame sizes: 0 is "just what's under the crosshair"
};
export const DENSITY = { crate: 0.6, steel: 3, plank: 0.6 };
export const NAMES = { crate: 'Crate', steel: 'Steel block', plank: 'Plank' };
export const UNDO_DEPTH = 30;
