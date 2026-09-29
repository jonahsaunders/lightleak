# Lightleak

A first-person puzzle game. Your only tool is a camera. Photograph something and it goes onto your roll. Develop the photo, and a copy appears where you're looking, **at the size it looked in the picture**: shot up close and developed far away, it comes out huge; shot from across the room and developed at your feet, it comes out tiny.

You wake up on the floor of a drying room. The archive's caretaker, the Curator, would like you back on the line. Eighteen levels: a prologue, fifteen puzzles in three chapters, a boss fight and a way out. There's also a level editor and an automated test that plays every level.

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

0. **Prologue**: Drying Room.
1. **Exposure**: Exposure, Depth of Field, Wide Angle, Ascent, Overhang. The basic scaling.
2. **Composition**: Group Shot, Doubling, Staircase, Turnaround, Terrace. Several objects in one photo, and turning photos.
3. **Negative**: Negative, Clearance, Undercut, Window, Darkroom. Dissolving things.
4. **Fixing**: The Enlarger (the final fight), then Daylight.

## The story

The archive is an automated photographic collection run by the Curator: a soft-spoken, fastidious caretaker that preserves things by photographing them. It preserved the staff the same way. You are a print, the sixteenth copy of a staff member called Wren Adeyemi, who came loose from the drying line. The Curator talks you through the puzzles as "calibration", and index cards pinned to the walls (look at one up close to read it) fill in the rest. It gets less friendly once you start dissolving things.

**The Enlarger.** The Curator itself is a huge enlarger head hanging over the last room from three red emulsion straps. Its lens follows you and throws a spotlight with real shadows. Every few seconds it locks on (a red ring, the lens turning red) and flashes. If the lens can see you there, you take a mark of **exposure**. Three marks rewind you to just after your last action, and marks fade if you stay clear. Anything solid between you and the lens protects you; glass doesn't. A bar at the top shows the goal and how many straps are left.

1. Load its two counterweight plates. The steel sleeves around its straps slide away.
2. Dissolve the three straps with negatives. It sags with each one, then crashes to the floor.
3. Photograph it while it lies there staring at you. That last shot needs no film.

Lines live in each level's `story` field and play once per visit on events: `start`, `photo`, `negative`, `develop`, `dissolve`, `plate`, `door`, `fall`, `undo`, `zone:<name>`, and the boss's `dodged`, `exposed`, `overexposed`, `phase2`, `cut1`, `cut2`, `falling`, `phase3` and `defeated`. Cards are `decor` entries with `"kind": "card"`, a `title` and `text`.

## How it feels

- **Clean sizes.** A developed size snaps to a clean ratio (same size, ½, 2×, 3×…) when you're within about 7% of one, and the ghost says so. Puzzles are about the idea, not about standing on the exact spot.
- **The ghost tells you the outcome.** Before you develop, it shows the size, the weight, the snap, whether it will fall, and what the plate it lands on will read ("plate 0.6 t ✓").
- **A camera in your hands.** The shutter clicks, the film lever advances, a print slides out. The photo you're holding appears in your other hand. An amber lamp shows when negative film is loaded.
- **Things materialise and dissolve.** Developed objects grow out of a spray of emulsion; dissolved things redden, lift and fizz away.
- **Sound** is layered on separate volume buses: footsteps that change with the surface, mechanical camera foley, room tone and safelight hum, and a quiet generative score that turns tense in the last room.
- **When you're stuck,** the Curator notices after about 70 seconds without progress, or after two restarts, and drops an in-character hint, then a plainer one later. The level hint fades once you've had time to read it and comes back with the nudge.
- **Between rooms,** the room you just solved develops into a print, taken from its doorway.

## Playtesting

The most useful thing you can do with this game is watch people play it.

- Every attempt at a level is recorded automatically: the full input stream (it replays exactly), a position trail, and every shot, development, undo, fall and restart. With `npm run dev` they're saved as files in `sessions/`; otherwise in the browser.
- **Playtest review** on the title screen shows each room's attempts, finish rate, median time, undos, falls, restarts and how often people got stuck (45 seconds or more without progress), plus a top-down heatmap of where people went and what they did. **Watch** replays any attempt.
- Testers can **Export** their sessions and send you the file; **Import** adds them to your review.

## Settings and access

The title screen's settings cover mouse sensitivity, field of view (display only; the simulation's framing stays fixed so replays stay exact), invert look, five volume levels, reduced camera flashes, screen shake and subtitle size. Gamepads work: left stick move, right stick look, LT raise the camera, RT shoot or develop, bumpers change photo or frame size, A jump, B undo, X switch film, D-pad turn the photo, Start pause.

## How it looks

- **Materials** are painted in code as height, colour and roughness; normal maps come from the height. Wall and floor textures span 4 m with 1 m panels, tile seamlessly, and are mapped in world space, so the grid runs unbroken across every surface and still works as a ruler.
- **Architecture** is added automatically to every room: wainscot panelling with a rail, baseboards, a cornice, pilaster ribs, a framed exit door with the room's name stencilled beside it, framed glass, recessed ceiling panels with soft light shafts, and drifting dust.
- **Rendering** goes through ambient occlusion, bloom, a filmic grade and SMAA anti-aliasing, with reflections from a generated environment map. The title screen's **Graphics** setting picks High (all of it), Medium (no ambient occlusion) or Low (plain rendering).
- **No flicker.** Two surfaces sharing a plane flicker (z-fighting). Trim stands proud of walls, runs stop short at corners, decals sit off the wall, and `npm test` audits every level for coplanar faces a player could see.

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

`npm test` runs all of them: currently 18 solutions, 7 blocked shortcuts, and a z-fighting audit of every level. Open `/?test` in a browser for the same report.

## Project layout

| Path | What's there |
| --- | --- |
| `js/main.js` | Boot, the fixed-step loop, input, menus, level flow (every level is unlocked from the start) |
| `js/level.js` | Building levels, physics bodies, plates, the door, undo snapshots |
| `js/photo.js` | Framing, taking photos, placement, developing, negatives |
| `js/player.js` | The character controller |
| `js/hud.js` | Viewfinder, ghost, photo roll, readouts |
| `js/driver.js` | Solution playback and the test runner |
| `js/sessions.js`, `js/review.js` | Playtest recording and the review screen |
| `js/viewmodel.js`, `js/fx.js` | The camera in your hands, and develop/dissolve effects |
| `js/settings.js` | Player settings |
| `js/story.js`, `js/boss.js` | The Curator's lines and nudges, and the final fight |
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

The idea of a camera that copies objects into photos was explored in a cancelled Valve prototype. Game mechanics aren't protected by copyright, but specific expression is. This project is written from scratch and deliberately takes nothing from that work or from the Portal series: no Valve code, assets, names, characters, setting, sounds or leaked material, and none was used as reference. The setting, story, characters, dialogue, puzzles, art direction, UI and name are original; the look is a darkroom (warm concrete, dark steel, red safelights), deliberately unlike Portal's white panels and orange-and-blue; textures are drawn at runtime, sounds are synthesised, and the icon is generated by `tools/icon.js`. Third-party code is listed in [LICENSES.md](LICENSES.md).

The story follows a common genre shape (a lone survivor in a facility, a guiding voice that turns out to have its own agenda, a final confrontation), which many games share and nobody owns. What's protected is specific expression, and none of Portal's is used here: no testing framing, no sarcastic AI, no cake, turrets or cubes. The Curator is a different character, the story is about photographs and copies, and the fight is built from this game's own mechanics.

If you take this further commercially, don't market it by reference to Valve's project or Portal, and check that the name "Lightleak" is clear to trademark where you'll sell it.
