// The one shared game state. Modules read and write it directly; it keeps the wiring simple.
export const G = {
  R: null,            // Rapier
  renderer: null, scene: null, camera: null,
  L: null,            // the running level (see level.js)
  defs: {},           // level definitions by id
  order: [],          // level ids in play order
  chapters: [],       // [{ name, levels: [id] }]
  roll: [],           // photos in hand
  selected: -1,       // index into roll, or -1
  filmMode: 'pos',    // 'pos' or 'neg'
  frameIdx: 0,        // index into CAMERA.frames
  aim: false,         // viewfinder raised this tick
  undo: [],           // snapshots taken before each action, newest last
  checkpoint: null,   // snapshot taken after the last action: where a fall sends you back to
  tick: 0,
  headless: false,    // test runs: no thumbnails, no sounds
  mode: 'title',      // title | playing | paused | done | editor
  hooks: {},          // callbacks other modules install (hud updates, level finished...)
};

export function emit(name, ...args) { const f = G.hooks[name]; if (f) f(...args); }
