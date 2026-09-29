// In-game level editor. F2 from the game (or "Edit this level" in the pause menu) opens it.
// Fly around, place blocks, glass, emulsion, props, plates, lights, benches and the spawn point,
// edit anything as JSON, then playtest, record a solution, run the level's test and save.
import { G } from './state.js';
import { loadLevel } from './level.js';
import { runTests } from './driver.js';
import { NAMES } from './config.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);
const snap = (v, s = 0.25) => Math.round(v / s) * s;
const r2 = v => Math.round(v * 100) / 100;

const TOOLS = [
  { id: 'block', label: 'Block', key: '1' },
  { id: 'glass', label: 'Glass', key: '2' },
  { id: 'emulsion', label: 'Emulsion', key: '3' },
  { id: 'prop', label: 'Prop', key: '4' },
  { id: 'plate', label: 'Plate', key: '5' },
  { id: 'light', label: 'Light panel', key: '6' },
  { id: 'bench', label: 'Bench', key: '7' },
  { id: 'spawn', label: 'Spawn', key: '8' },
];

export class Editor {
  constructor(api, { dev }) {
    this.api = api; this.dev = dev;
    this.def = null; this.tool = 'block';
    this.size = new V3(1, 1, 1);
    this.mat = 'ledge'; this.propType = 'crate'; this.need = 1; this.rot = 0;
    this.cam = { pos: new V3(0, 4, 8), yaw: 0, pitch: -0.3 };
    this.keys = new Set();
    this.history = [];
    this.selected = null;
    this.locked = false;
    this.cursor = null;
    this.markers = new THREE.Group();
    this.pickables = [];
    this.bind();
  }

  // ---------- lifecycle ----------
  open(def, msg) {
    this.def = JSON.parse(JSON.stringify(def));
    G.mode = 'editor';
    $('editor').hidden = false;
    $('menu').hidden = true; $('hud').hidden = true;
    this.rebuild();
    if (!this.placedCam) {
      // start just behind and above the spawn point, kept inside the room
      const s = this.def.spawn.pos, r = this.def.room, yaw = this.def.spawn.yaw * Math.PI / 180;
      const x = THREE.MathUtils.clamp(s[0] + Math.sin(yaw) * 2, r.x0 + 0.5, r.x1 - 0.5);
      const z = THREE.MathUtils.clamp(s[2] + Math.cos(yaw) * 2, r.z0 + 0.5, r.z1 - 0.5);
      this.cam.pos.set(x, s[1] + 2.6, z);
      this.cam.yaw = yaw; this.cam.pitch = -0.3;
      this.placedCam = true;
    }
    G.camera.fov = 75; G.camera.updateProjectionMatrix();
    this.renderPanel();
    this.say(msg || '');
  }
  close() {
    document.exitPointerLock?.();
    $('editor').hidden = true;
    G.scene.remove(this.markers);
    if (this.cursor) this.cursor.visible = false;
    this.api.leave();
  }

  rebuild() {
    G.defs[this.def.id] = this.def;
    loadLevel(this.def);
    // map meshes back to the definition they came from
    this.pickables = [];
    const L = G.L;
    L.props.forEach((p, i) => { p.mesh.userData.ref = { list: 'props', i }; this.pickables.push(p.mesh); });
    L.plates.forEach((p, i) => { p.mesh.userData.ref = { list: 'plates', i }; this.pickables.push(p.mesh); });
    for (const s of L.statics) {
      if (s.src && s.mesh) { s.mesh.userData.ref = { list: 'blocks', i: this.def.blocks.indexOf(s.src) }; this.pickables.push(s.mesh); }
    }
    L.group.traverse(o => { if (o.userData.decor) { o.userData.ref = { list: 'decor', i: this.def.decor.indexOf(o.userData.decor) }; this.pickables.push(o); } });
    G.scene.remove(this.markers);
    this.markers = new THREE.Group();
    const lampGeo = new THREE.OctahedronGeometry(0.25);
    (this.def.lights || []).forEach((l, i) => {
      const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffe2bc, wireframe: true }));
      m.position.fromArray(l.pos).y -= 0.3; m.userData.ref = { list: 'lights', i };
      this.markers.add(m); this.pickables.push(m);
    });
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.75, 12), new THREE.MeshBasicMaterial({ color: 0x8fc27a, wireframe: true }));
    sp.position.fromArray(this.def.spawn.pos).y += 0.875; sp.userData.ref = { list: 'spawn' };
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0x8fc27a }));
    arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.6, -0.5); sp.add(arrow);
    sp.rotation.y = this.def.spawn.yaw * Math.PI / 180;
    this.markers.add(sp); this.pickables.push(sp);
    G.scene.add(this.markers);
    if (!this.cursor) {
      this.cursor = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xf06a4f }));
    }
    G.scene.add(this.cursor);
    this.status();
  }

  change(fn, { rebuild = true } = {}) {
    this.history.push(JSON.stringify(this.def));
    if (this.history.length > 100) this.history.shift();
    fn(this.def);
    if (rebuild) this.rebuild();
    this.renderPanel();
  }
  undo() {
    const s = this.history.pop();
    if (!s) return this.say('Nothing to undo.');
    this.def = JSON.parse(s);
    this.rebuild(); this.renderPanel();
  }

  // ---------- input ----------
  bind() {
    const canvas = $('game');
    addEventListener('keydown', e => {
      if (G.mode !== 'editor') return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
      this.keys.add(e.code);
      if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); this.undo(); return; }
      if (e.code === 'F2') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
      const t = TOOLS.find(t => `Digit${t.key}` === e.code);
      if (t) { this.tool = t.id; this.renderPanel(); }
      const step = e.shiftKey ? 0.25 : 0.5;
      const grow = { BracketRight: ['x', step], BracketLeft: ['x', -step], Quote: ['z', step], Semicolon: ['z', -step], Equal: ['y', step], Minus: ['y', -step] }[e.code];
      if (grow) { this.size[grow[0]] = Math.max(0.1, r2(this.size[grow[0]] + grow[1])); this.status(); }
      if (e.code === 'KeyR') { this.rot = (this.rot + 90) % 360; this.status(); }
      if (e.code === 'KeyC') this.pick();
      if (e.code === 'KeyM') this.cycle();
      if (e.code === 'Delete' || e.code === 'Backspace') this.remove();
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    canvas.addEventListener('mousedown', e => {
      if (G.mode !== 'editor') return;
      if (!this.locked) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ } return; }
      if (e.button === 0) this.place();
      if (e.button === 2) this.select(true);
    });
    addEventListener('mousemove', e => {
      if (G.mode !== 'editor' || !this.locked) return;
      this.cam.yaw -= e.movementX * 0.0022;
      this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch - e.movementY * 0.0022, -1.55, 1.55);
    });
    addEventListener('wheel', e => {
      if (G.mode !== 'editor' || !this.locked) return;
      const d = (e.deltaY > 0 ? -1 : 1) * 0.25;
      if (e.shiftKey) this.size.y = Math.max(0.1, r2(this.size.y + d));
      else { this.size.x = Math.max(0.1, r2(this.size.x + d)); this.size.z = Math.max(0.1, r2(this.size.z + d)); if (this.tool === 'prop') this.size.y = Math.max(0.1, r2(this.size.y + d)); }
      this.status();
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas && G.mode === 'editor'; });
  }

  frame(dt) {
    const k = this.keys, c = this.cam;
    const speed = (k.has('ShiftLeft') ? 16 : 7) * dt;
    const fwd = new V3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)), right = new V3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    if (this.locked) {
      if (k.has('KeyW')) c.pos.addScaledVector(fwd, speed);
      if (k.has('KeyS')) c.pos.addScaledVector(fwd, -speed);
      if (k.has('KeyD')) c.pos.addScaledVector(right, speed);
      if (k.has('KeyA')) c.pos.addScaledVector(right, -speed);
      if (k.has('Space')) c.pos.y += speed;
      if (k.has('ControlLeft') || k.has('KeyQ')) c.pos.y -= speed;
    }
    G.camera.position.copy(c.pos);
    G.camera.rotation.set(c.pitch, c.yaw, 0);
    G.camera.updateMatrixWorld();
    this.updateCursor();
  }

  // ---------- placing ----------
  hit(markers = false) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), G.camera);
    ray.far = 200;
    const h = ray.intersectObjects(markers ? [...G.L.rayMeshes, ...this.markers.children] : G.L.rayMeshes, false)[0];
    if (!h) return null;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new V3(0, 1, 0);
    const ax = ['x', 'y', 'z'].reduce((a, b) => (Math.abs(n[b]) > Math.abs(n[a]) ? b : a), 'x');
    const normal = new V3(); normal[ax] = Math.sign(n[ax]);
    return { point: h.point, normal, object: h.object };
  }

  footprint() {
    const s = this.size.clone();
    if (this.tool === 'plate') s.y = 0.08;
    if (this.tool === 'light') s.set(2, 0.05, 1);
    if (this.tool === 'spawn') s.set(0.6, 1.75, 0.6);
    if (this.tool === 'bench') s.set(this.rot % 180 ? 0.9 : 2.4, 1, this.rot % 180 ? 2.4 : 0.9);
    if ((this.tool === 'prop' || this.tool === 'block' || this.tool === 'glass' || this.tool === 'emulsion') && this.rot % 180) s.set(s.z, s.y, s.x);
    return s;
  }

  // The box the current tool would place, sitting against the surface under the crosshair.
  target() {
    const h = this.hit();
    if (!h) return null;
    const s = this.footprint();
    const c = h.point.clone();
    for (const ax of ['x', 'y', 'z']) {
      if (h.normal[ax]) c[ax] = h.point[ax] + h.normal[ax] * s[ax] / 2;
      else c[ax] = snap(h.point[ax] - s[ax] / 2) + s[ax] / 2;
    }
    if (this.tool === 'light') c.y = h.point.y - (h.normal.y < 0 ? 0 : -0.03);
    return { center: c, size: s, min: c.clone().addScaledVector(s, -0.5), max: c.clone().addScaledVector(s, 0.5), h };
  }

  updateCursor() {
    const t = this.target();
    this.cursor.visible = !!t && this.locked;
    if (t) { this.cursor.position.copy(t.center); this.cursor.scale.copy(t.size); }
  }

  place() {
    const t = this.target();
    if (!t) return;
    const min = t.min.toArray().map(r2), max = t.max.toArray().map(r2), c = t.center;
    this.change(def => {
      const tool = this.tool;
      if (tool === 'block' || tool === 'glass' || tool === 'emulsion') (def.blocks ||= []).push({ min, max, mat: tool === 'block' ? this.mat : tool });
      else if (tool === 'prop') (def.props ||= []).push({ type: this.propType, pos: [r2(c.x), r2(min[1]), r2(c.z)], size: [r2(this.size.x), r2(this.size.y), r2(this.size.z)], rot: this.rot });
      else if (tool === 'plate') (def.plates ||= []).push({ pos: [r2(c.x), r2(min[1]), r2(c.z)], size: [r2(t.size.x), r2(t.size.z)], need: this.need });
      else if (tool === 'light') (def.lights ||= []).push({ pos: [r2(c.x), r2(t.h.point.y), r2(c.z)], panel: true });
      else if (tool === 'bench') (def.decor ||= []).push({ kind: 'bench', pos: [r2(c.x), r2(min[1]), r2(c.z)], rot: this.rot, len: 2.4 });
      else if (tool === 'spawn') def.spawn = { pos: [r2(c.x), r2(min[1]), r2(c.z)], yaw: Math.round(this.cam.yaw * 180 / Math.PI) };
    });
  }

  select(fromMouse) {
    const h = this.hit(true);
    const ref = h && h.object.userData.ref;
    this.selected = ref || null;
    if (fromMouse && !ref) this.say('That is part of the room; edit the room in the panel.');
    this.renderPanel();
  }
  selectedValue() {
    const s = this.selected;
    if (!s) return null;
    return s.list === 'spawn' ? this.def.spawn : (this.def[s.list] || [])[s.i];
  }
  remove() {
    const h = this.hit(true);
    const ref = h && h.object.userData.ref;
    if (!ref || ref.list === 'spawn') return;
    this.change(def => def[ref.list].splice(ref.i, 1));
    this.selected = null;
  }
  // Copy the size and type of whatever is under the crosshair.
  pick() {
    const h = this.hit();
    const ref = h && h.object.userData.ref;
    if (!ref || ref.list === 'spawn' || ref.list === 'lights') return;
    const v = this.def[ref.list][ref.i];
    if (ref.list === 'blocks') { this.tool = v.mat === 'glass' || v.mat === 'emulsion' ? v.mat : 'block'; if (this.tool === 'block') this.mat = v.mat; this.size.set(...v.max.map((m, i) => r2(m - v.min[i]))); }
    if (ref.list === 'props') { this.tool = 'prop'; this.propType = v.type; this.size.fromArray(v.size); this.rot = v.rot || 0; }
    if (ref.list === 'plates') { this.tool = 'plate'; this.size.set(v.size[0], 1, v.size[1]); this.need = v.need; }
    this.renderPanel();
  }
  cycle() {
    if (this.tool === 'block') { const m = ['ledge', 'wall', 'floor', 'dark', 'deep']; this.mat = m[(m.indexOf(this.mat) + 1) % m.length]; }
    if (this.tool === 'prop') { const t = Object.keys(NAMES); this.propType = t[(t.indexOf(this.propType) + 1) % t.length]; }
    this.renderPanel();
  }

  // ---------- panel ----------
  status() {
    const s = this.size;
    const what = this.tool === 'block' ? `block (${this.mat})` : this.tool === 'prop' ? `prop (${this.propType})` : this.tool === 'plate' ? `plate (≥ ${this.need} t)` : this.tool;
    $('ed-status').textContent = `EDITOR · ${this.def?.name || ''} · ${what} · ${s.x} × ${s.y} × ${s.z} m${this.rot ? ` · ${this.rot}°` : ''}`;
    $('ed-help').innerHTML = this.locked
      ? '<kbd>WASD</kbd> fly · <kbd>Space</kbd>/<kbd>Ctrl</kbd> up/down · <kbd>Shift</kbd> fast<br><kbd>LMB</kbd> place · <kbd>RMB</kbd> select · <kbd>Del</kbd> remove · <kbd>C</kbd> copy size · <kbd>M</kbd> material/type · <kbd>R</kbd> turn<br><kbd>Wheel</kbd> size (<kbd>Shift</kbd> height) · <kbd>[</kbd><kbd>]</kbd> width · <kbd>;</kbd><kbd>\'</kbd> depth · <kbd>-</kbd><kbd>=</kbd> height · <kbd>Ctrl+Z</kbd> undo · <kbd>Esc</kbd> free the mouse'
      : 'Click the view to fly around. <kbd>F2</kbd> leaves the editor.';
  }
  say(msg) { const m = $('ed-msg'); if (m) m.textContent = msg; }

  renderPanel() {
    const d = this.def, room = d.room, door = room.door;
    const num = (label, path, val, step = 0.5) => `<label>${label}<input type="number" step="${step}" data-path="${path}" value="${val ?? ''}"></label>`;
    const sel = this.selectedValue();
    const others = Object.keys(G.defs).filter(id => id !== d.id).map(id => `<option value="${id}">${G.defs[id].name}</option>`).join('');
    $('ed-panel').innerHTML = `
      <h2>Level editor</h2>
      <div id="ed-msg"></div>
      <h3>LEVEL</h3>
      <label>Id<input data-path="id" value="${d.id}"></label>
      <label>Name<input data-path="name" value="${escapeHTML(d.name)}"></label>
      <label style="grid-template-columns:1fr">Hint<textarea data-path="hint">${escapeHTML(d.hint || '')}</textarea></label>
      ${num('Film', 'film.pos', d.film?.pos ?? 0, 1)}${num('Negatives', 'film.neg', d.film?.neg ?? 0, 1)}
      <label>Wide frame<input type="checkbox" data-path="wide" ${d.wide ? 'checked' : ''}></label>
      ${num('Fall limit y', 'killY', d.killY ?? -8)}
      <h3>ROOM</h3>
      ${num('x from', 'room.x0', room.x0)}${num('x to', 'room.x1', room.x1)}${num('z from', 'room.z0', room.z0)}${num('z to', 'room.z1', room.z1)}${num('Height', 'room.h', room.h)}
      ${num('Door x', 'room.door.x', door.x)}${num('Door width', 'room.door.w', door.w ?? 2)}${num('Door sill y', 'room.door.y', door.y ?? 0)}
      <label>Floor<input type="checkbox" data-path="room.floor" ${room.floor !== false ? 'checked' : ''}></label>
      ${num('Walls from y', 'room.wallBottom', room.wallBottom ?? 0)}
      <h3>TOOLS</h3>
      <div id="ed-tools">${TOOLS.map(t => `<button data-tool="${t.id}" class="${t.id === this.tool ? 'on' : ''}"><kbd>${t.key}</kbd> ${t.label}</button>`).join('')}</div>
      <label>Material<select id="ed-mat">${['ledge', 'wall', 'floor', 'dark', 'deep'].map(m => `<option ${m === this.mat ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Prop<select id="ed-prop">${Object.keys(NAMES).map(m => `<option value="${m}" ${m === this.propType ? 'selected' : ''}>${NAMES[m]}</option>`).join('')}</select></label>
      <label>Plate needs t<input id="ed-need" type="number" step="0.1" value="${this.need}"></label>
      <h3>SELECTED ${this.selected ? `· ${this.selected.list}` : ''}</h3>
      ${sel ? `<textarea id="ed-json" style="height:120px;font:12px var(--mono)">${escapeHTML(JSON.stringify(sel))}</textarea><div class="row"><button class="btn ghost" id="ed-apply">Apply</button></div>` : '<div style="color:var(--dim)">Right-click something you placed to edit it as JSON.</div>'}
      <h3>SOLUTION</h3>
      <div style="color:var(--dim)">${d.solution ? (Array.isArray(d.solution) ? `Scripted, ${d.solution.length} steps.` : `Recorded, ${d.solution.demo.length} inputs.`) : 'None yet. Record one by playing it through.'}</div>
      <div class="row">
        <button class="btn" id="ed-play">Playtest</button>
        <button class="btn ghost" id="ed-rec">Record solution</button>
        <button class="btn ghost" id="ed-watch" ${d.solution ? '' : 'disabled'}>Watch it</button>
        <button class="btn ghost" id="ed-test" ${d.solution ? '' : 'disabled'}>Test</button>
      </div>
      <h3>FILE</h3>
      <div class="row">
        <button class="btn" id="ed-save">${this.dev ? 'Save to levels/' : 'Download JSON'}</button>
        <button class="btn ghost" id="ed-new">New level</button>
      </div>
      <label>Open<select id="ed-open"><option value="">—</option>${others}</select></label>
      <div class="row"><button class="btn ghost" id="ed-exit">Leave editor</button></div>
      ${this.dev ? '' : '<div style="color:var(--dim);margin-top:8px">Run <kbd>npm run dev</kbd> to save straight into the levels folder.</div>'}
    `;
    const panel = $('ed-panel');
    panel.querySelectorAll('[data-path]').forEach(el => el.addEventListener('change', () => {
      const path = el.dataset.path.split('.');
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? undefined : Number(el.value)) : el.value;
      this.change(def => {
        let o = def;
        for (const k of path.slice(0, -1)) o = o[k] ||= {};
        if (v === undefined) delete o[path.at(-1)]; else o[path.at(-1)] = v;
      });
    }));
    panel.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { this.tool = b.dataset.tool; this.renderPanel(); });
    $('ed-mat').onchange = e => { this.mat = e.target.value; this.status(); };
    $('ed-prop').onchange = e => { this.propType = e.target.value; this.status(); };
    $('ed-need').onchange = e => { this.need = Number(e.target.value); this.status(); };
    if ($('ed-apply')) $('ed-apply').onclick = () => {
      try {
        const v = JSON.parse($('ed-json').value);
        const s = this.selected;
        this.change(def => { if (s.list === 'spawn') def.spawn = v; else def[s.list][s.i] = v; });
        this.say('Applied.');
      } catch (e) { this.say(`Not valid JSON: ${e.message}`); }
    };
    $('ed-play').onclick = () => this.playtest(false);
    $('ed-rec').onclick = () => this.playtest(true);
    $('ed-watch').onclick = () => { $('editor').hidden = true; this.api.watch(this.def, why => this.open(this.def, why ? `Solution stopped: ${why}` : 'The solution finished the level.')); };
    $('ed-test').onclick = () => this.test();
    $('ed-save').onclick = () => this.save();
    $('ed-new').onclick = () => this.fresh();
    $('ed-open').onchange = e => { if (e.target.value) { this.placedCam = false; this.history = []; this.open(G.defs[e.target.value]); } };
    $('ed-exit').onclick = () => this.close();
    this.status();
  }

  playtest(record) {
    $('editor').hidden = true;
    document.exitPointerLock?.();
    const def = this.def;
    let note = '';
    this.api.playtest(def, {
      record,
      back: why => this.open(def, why || note),
      solved: demo => { def.solution = { demo }; note = `Recorded a solution (${demo.length} inputs). Save to keep it.`; },
    });
  }

  async test() {
    this.say('Testing…');
    const def = this.def;
    G.defs[def.id] = def;
    G.headless = true;
    let rep;
    try { rep = await runTests(window.lightleak.tick, [def.id]); } finally { G.headless = false; }
    this.rebuild();
    const r = rep.results[0];
    this.say(r.ok ? `Passed: finished in ${r.seconds.toFixed(1)} s of play.` : `Failed: ${r.why}`);
  }

  async save() {
    const body = JSON.stringify(this.def, null, 2);
    if (this.dev) {
      const res = await fetch(`api/levels/${this.def.id}`, { method: 'PUT', body }).catch(e => ({ ok: false, statusText: e.message }));
      this.say(res.ok ? `Saved levels/${this.def.id}.json` : `Save failed: ${res.statusText}`);
      if (res.ok && !G.chapters.some(c => c.levels.includes(this.def.id))) {
        let custom = G.chapters.find(c => c.custom);
        if (!custom) G.chapters.push(custom = { name: 'Custom', custom: true, levels: [] });
        custom.levels.push(this.def.id);
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body + '\n'], { type: 'application/json' }));
    a.download = `${this.def.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.say(`Downloaded ${this.def.id}.json — put it in levels/ and list it in levels/index.json.`);
  }

  fresh() {
    let n = 1;
    while (G.defs[`custom-${n}`]) n++;
    this.history = []; this.placedCam = false;
    this.open({
      id: `custom-${n}`, name: `Custom ${n}`, hint: '', film: { pos: 2 },
      room: { x0: -6, x1: 6, z0: -10, z1: 6, h: 6, door: { x: 0 } },
      blocks: [], props: [{ type: 'crate', pos: [3, 0, 0], size: [1, 1, 1] }], plates: [{ pos: [0, 0, -7], size: [2, 2], need: 0.5 }],
      lights: [{ pos: [0, 6, 0], panel: true }, { pos: [0, 6, -6], panel: true }], decor: [],
      spawn: { pos: [0, 0, 4], yaw: 0 },
    }, 'New level. Place things, playtest, then record a solution.');
  }
}

function escapeHTML(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
