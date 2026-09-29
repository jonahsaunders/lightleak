# Lightleak

A first-person puzzle game. Your only tool is a camera. Photograph something and it goes onto your roll. Develop the photo, and a copy appears where you're looking, **at the size it looked in the picture**: shot up close and developed far away, it comes out huge; shot from across the room and developed at your feet, it comes out tiny.

Fifteen puzzles in three chapters, a level editor, and an automated test that plays every level.

## Running it

| Command | What it does |
| --- | --- |
| `npm start` | Serves the game at http://127.0.0.1:5178 |
| `npm run dev` | Same, and the editor can save levels straight into `levels/` |
| `npm run desktop` | Runs it as a desktop app (Electron) |
| `npm test` | Plays every level's stored solution in a hidden window and prints pass/fail |
| `npm run web` | Builds the static web version into `build/web` and `build/lightleak-web.zip` |
| `npm run dist` | Builds the Windows installer and portable `.exe` into `dist/` (`dist:mac` on a Mac) |
| `npm run icon` | Redraws `desktop/icon.png` |

Run `npm install` once first. If npm holds back Electron's install script, run `node node_modules/electron/install.js`.

## Controls

| Input | Action |
| --- | --- |
| WASD, Space | Move, jump |
| Hold RMB (or toggle F) | Raise the camera; click to take a photo |
| Wheel up / down, or G, while the camera is up | Widen or narrow the frame to take in several things (chapter 2 on) |
| 1 / 2 / 3, wheel | Hold up a photo; click to develop it |
| Q / E | Turn the photo you're holding by 90° |
| T | Switch between film and negative (chapter 3) |
| Z | Undo the last shot, development or discard |
| X | Throw away the photo you're holding |
| R | Restart the frame |
| Esc, F2 | Pause, level editor |

Mouse sensitivity is on the title screen.

## How it works

- **Scale.** A photo stores its objects, their arrangement and their distance from your eye (`d0`). Developing scales the whole thing by `k = d / d0`, where `d` is the distance to where it lands, so it keeps its apparent size. The result is clamped between 0.15 m and 10 m overall.
- **Placement.** The photo develops against the surface under the crosshair and is nudged out of anything it clips. A green ghost shows where it goes, its size and weight, and (faintly) where it will land if it's going to fall. Red means no room.
- **Composition.** From chapter 2, the mouse wheel widens the capture frame. Everything inside the frame and visible to the camera goes into one photo, keeping its arrangement relative to you, so what was on your left develops on your left. Glass is transparent to the camera; walls and emulsion are not.
- **Negatives.** A negative develops as a hole: every object it touches, and any emulsion (the red film-like panels), dissolves whole.
- **Physics.** Rapier simulates the objects, so stacks settle, overhangs tip and things fall. The player can't push objects; they only move under gravity, which keeps puzzles from being wrecked by accident.
- **Weight.** Mass is volume × density (crate and plank 0.6 t/m³, steel 3 t/m³). Load plates count everything resting on them, stacked or not; some want a range, not just a minimum.
- **Undo and falls.** Z steps back through every shot and development. Falling out of the level puts you back to just after your last action.

## The chapters

1. **Exposure**: Exposure, Depth of Field, Wide Angle, Ascent, Overhang. The basic scaling.
2. **Composition**: Group Shot, Doubling, Staircase, Turnaround, Terrace. Several objects in one photo, and turning photos.
3. **Negative**: Negative, Clearance, Undercut, Window, Darkroom. Dissolving things.

## Making levels

Press **F2** in the game, or choose "Edit this level" from the pause menu.

- Click the view to fly (WASD, Space/Ctrl for up and down, Shift for speed). Esc frees the mouse for the panel.
- Number keys pick a tool: block, glass, emulsion, prop, plate, light panel, bench, spawn. LMB places against the surface you're looking at; RMB selects; Delete removes; C copies the size of what you're looking at; M cycles material or prop type; R turns it; the wheel and `[ ] ; ' - =` change its size. Ctrl+Z undoes.
- The panel edits the level's name, hint, film, whether wide framing is allowed, and the room. Anything you select can be edited as JSON.
- **Playtest** plays it. **Record solution** plays it and keeps your exact input as the level's solution. **Watch it** replays the stored solution. **Test** runs it headless and reports pass/fail.
- **Save** writes `levels/<id>.json` when running `npm run dev` (new levels appear in a "Custom" chapter); otherwise it downloads the JSON.

### Level files

Levels are JSON in `levels/`, listed in play order in `levels/index.json`. A level has a `room` (walls, ceiling, and a door in the north wall with a short corridor behind it), `blocks` (`mat`: ledge, wall, floor, dark, deep, glass, emulsion), `props` (crate, steel, plank; `pos` is the bottom centre), `plates` (`need`, optional `max`), `lights`, `decor`, `spawn`, `film` (`pos`, `neg`) and `wide`.

### Solutions and tests

Each level carries a `solution`, either scripted steps (`walk`, `shoot`, `develop`, `wait`, `exit`, with options like `frame`, `film`, `rot`, `jumpAt`) or a recorded `demo` of raw input. The simulation runs at a fixed 60 Hz and is deterministic, so a recording replays exactly. A level can also list `mustFail` shortcuts, scripts that must *not* finish it: for example, jumping the Overhang gap without a plank, or putting the too-light crate in Window's cubby.

`npm test` runs all of them: currently 15 solutions and 6 blocked shortcuts. Open `/?test` in a browser for the same report.

## Project layout

| Path | What's there |
| --- | --- |
| `js/main.js` | Boot, the fixed-step loop, input, menus, level flow |
| `js/level.js` | Building levels, physics bodies, plates, the door, undo snapshots |
| `js/photo.js` | Framing, taking photos, placement, developing, negatives |
| `js/player.js` | The character controller |
| `js/hud.js` | Viewfinder, ghost, photo roll, readouts |
| `js/driver.js` | Solution playback and the test runner |
| `js/editor.js` | The level editor |
| `js/materials.js`, `js/audio.js` | Procedural textures and synthesised sound |
| `server.js`, `desktop/main.js` | Local server (with the editor's save endpoint) and the Electron wrapper |
| `tools/` | Web build and icon generator |

## Publishing to itch.io

Run `npm run web` and upload `build/lightleak-web.zip` as an HTML project with "This file will be played in the browser" ticked. A 1280×800 viewport works well; turn on the fullscreen button. You can upload the Windows builds from `dist/` alongside it.

## Known gaps

- It hasn't been played by anyone yet. The scripted solutions prove each level can be solved, not that it's fun or fair. Watch a few people play it before building more.
- Mouse feel, jump height and reach were tuned by numbers, not by hand.
- On a window narrower than 4:3, the drawn capture frame is slightly smaller than what the camera actually takes in.
- Room lights have no shadows, so a lamp can light the far side of a thin wall.

## Originality

The idea of a camera that copies objects into photos was explored in a cancelled Valve prototype. Game mechanics aren't protected by copyright, but specific expression is. This project is written from scratch and deliberately takes nothing from that work or from the Portal series: no Valve code, assets, names, characters, setting, sounds or leaked material, and none was used as reference. The setting, puzzles, UI, text and name are original; textures are drawn at runtime, sounds are synthesised, and the icon is generated by `tools/icon.js`. Third-party code is listed in [LICENSES.md](LICENSES.md).

If you take this further commercially, don't market it by reference to Valve's project or Portal, and check that the name "Lightleak" is clear to trademark where you'll sell it.
