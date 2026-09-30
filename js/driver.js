// Plays a level's stored solution by generating the same per-tick input a player would.
// Two kinds of solution:
//   scripted: a list of steps — {walk:[x,z], jumpAt?:[x,z]}, {shoot:[x,y,z], frame, film}, {develop:[x,y,z], slot, rot},
//             {look:[x,y,z]}, {wait:s}, {jump:true}, {exit:true}
//   recorded: {demo:[...]} — raw input captured in the editor's playtest
// The test runner (?test, or `npm test`) runs every level's solution and reports which still finish.
import { G } from './state.js';
import { DT, PLAYER } from './config.js';
import { P } from './player.js';
import { loadLevel } from './level.js';
import { auditLevel } from './audit.js';

const THREE = window.THREE;

function lookAngles(target) {
  const ex = P.pos.x, ey = P.pos.y + PLAYER.eye, ez = P.pos.z;
  const dx = target[0] - ex, dy = target[1] - ey, dz = target[2] - ez;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
const q4 = v => Math.round(v * 1e4) / 1e4;

export class Driver {
  constructor(def, steps = null) {
    const sol = steps || def.solution;
    this.demo = sol && !Array.isArray(sol) ? sol.demo : null;
    this.steps = Array.isArray(sol) ? sol : [];
    this.i = 0; this.sub = null; this.t = 0;
    this.yaw = P.yaw; this.pitch = P.pitch;
    this.cur = { f: 0, r: 0, j: 0, y: P.yaw, p: P.pitch, a: 0 };
    this.di = 0;
    this.error = null;
    if (!sol || (!this.demo && !this.steps.length)) this.error = 'no stored solution';
  }

  input(extra = {}) {
    return Object.assign({ f: 0, r: 0, jump: false, yaw: q4(this.yaw), pitch: q4(this.pitch), aim: false, actions: [] }, extra);
  }

  next() {
    if (this.error || !G.L || G.L.finished) return null;
    this.t++;
    if (this.demo) return this.nextDemo();
    if (this.t > 60 * 60 * 5) return this.fail('ran for five minutes without finishing');
    while (this.i < this.steps.length) {
      const out = this.run(this.steps[this.i]);
      if (out === 'next') { this.i++; this.sub = null; continue; }
      return out;
    }
    // out of steps: keep still for a moment in case the exit is being reached, then give up
    if ((this.sub = this.sub || { n: 0 }).n++ > 120) return this.fail('solution ended before the level did');
    return this.input();
  }

  nextDemo() {
    const tick = this.t - 1;
    const acts = [];
    while (this.di < this.demo.length && this.demo[this.di].t <= tick) {
      const e = this.demo[this.di++];
      for (const k of ['f', 'r', 'j', 'y', 'p', 'a']) if (k in e) this.cur[k] = e[k];
      if (e.x) acts.push(...e.x);
    }
    if (this.di >= this.demo.length && tick > (this.demo.at(-1)?.t ?? 0) + 180) return this.fail('recording ended before the level did');
    const c = this.cur;
    return { f: c.f, r: c.r, jump: !!c.j, yaw: c.y, pitch: c.p, aim: !!c.a, actions: acts };
  }

  fail(why) { this.error = `step ${this.i + 1}: ${why}`; return null; }

  run(s) {
    const sub = this.sub || (this.sub = { n: 0, phase: 0 });
    sub.n++;
    if (s.look) { Object.assign(this, lookAngles(s.look)); return 'next'; }
    if (s.wait !== undefined) return sub.n > s.wait / DT ? 'next' : this.input();

    if (s.walk || s.exit) {
      let tx, tz;
      if (s.exit) { const e = G.L.exit; tx = (e.min.x + e.max.x) / 2; tz = (e.min.z + e.max.z) / 2; }
      else [tx, tz] = s.walk;
      const dx = tx - P.pos.x, dz = tz - P.pos.z, d = Math.hypot(dx, dz);
      if (!s.exit && d < (s.within ?? 0.2) && P.grounded) return 'next';
      if (sub.n > (s.timeout ?? 20) / DT) return this.fail(s.exit ? "couldn't reach the exit" : `couldn't reach [${s.walk}] (stopped at ${P.pos.x.toFixed(1)}, ${P.pos.y.toFixed(1)}, ${P.pos.z.toFixed(1)})`);
      this.yaw = Math.atan2(-dx, -dz); this.pitch = 0;
      // hop if we've stopped making progress; `jumpAt` asks for a running jump at a spot
      let jump = false;
      if (sub.n % 12 === 0) { if (sub.best !== undefined && sub.best - d < 0.08 && P.grounded) jump = true; sub.best = d; }
      if (sub.best === undefined) sub.best = d;
      if (s.jumpAt && !sub.jumped && P.grounded && Math.hypot(s.jumpAt[0] - P.pos.x, s.jumpAt[1] - P.pos.z) < 0.35) { jump = true; sub.jumped = true; }
      const full = s.exit || s.jumpAt;
      return this.input({ f: full ? 1 : Math.min(1, 0.25 + d / 0.8), jump });
    }

    if (s.jump) return sub.n === 1 ? this.input({ jump: true }) : sub.n > 30 ? 'next' : this.input();

    if (s.shoot) {
      const acts = [];
      if (sub.phase === 0) {
        const film = s.film || 'pos';
        if (G.filmMode !== film) acts.push('film');
        const f = s.frame ?? 0;
        if (G.frameIdx !== f) acts.push(`frame:${f - G.frameIdx}`);
        sub.phase = 1; sub.before = G.roll.length;
      }
      Object.assign(this, lookAngles(s.shoot));
      if (sub.n < 20) return this.input({ aim: true, actions: acts });
      if (sub.n === 20) return this.input({ aim: true, actions: ['click'] });
      if (G.roll.length <= sub.before) return this.fail(`photo not taken: ${G.lastDeny || '?'}`);
      return sub.n > 24 ? 'next' : this.input();
    }

    if (s.develop) {
      const acts = [];
      if (sub.phase === 0) {
        const slot = s.slot ?? G.roll.length - 1;
        if (!G.roll[slot]) return this.fail(`no photo in slot ${slot + 1}`);
        if (G.selected !== slot) acts.push(`select:${slot}`);
        const turn = ((s.rot ?? 0) - G.roll[slot].rot + 4) % 4;
        if (turn) acts.push(`rotate:${turn}`);
        sub.phase = 1; sub.before = G.roll.length;
      }
      Object.assign(this, lookAngles(s.develop));
      if (sub.n < 4) return this.input({ actions: acts });
      if (sub.n === 4) return this.input({ actions: ['click'] });
      if (sub.n === 5 && G.roll.length >= sub.before) return this.fail(`couldn't develop: ${G.lastDeny || '?'}`);
      return sub.n > (s.settle ?? 1) / DT ? 'next' : this.input();
    }
    return this.fail(`unknown step ${JSON.stringify(s)}`);
  }
}

// Runs every level's solution as fast as possible. `tick` is the game's own tick function.
export async function runTests(tick, ids = null) {
  const list = ids || [...G.order, ...G.chapters.filter(c => c.custom).flatMap(c => c.levels)];
  const results = [];
  // Plays one script to the end; resolves to { finished, ticks, error }.
  async function play(def, steps) {
    loadLevel(def);
    G.camera.fov = 75; G.camera.updateProjectionMatrix(); G.logicFov = 75;
    G.tick = 0;
    const d = new Driver(def, steps);
    let ticks = 0;
    for (;;) {
      const input = d.next();
      if (!input) break;
      tick(input);
      ticks++;
      if (ticks % 600 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { finished: G.L.finished, ticks, error: d.error };
  }
  for (const id of list) {
    const def = G.defs[id];
    try {
      const r = await play(def);
      results.push(r.finished ? { id, ok: true, seconds: r.ticks * DT } : { id, ok: false, why: r.error || 'did not finish' });
      // No flickering surfaces anywhere a player can see.
      loadLevel(def);
      const flicker = auditLevel();
      results.push(flicker.length ? { id: `${id} ◫`, ok: false, why: `${flicker.length} z-fighting spot(s): ${flicker.slice(0, 3).join('; ')}` } : { id: `${id} ◫`, ok: true, seconds: 0, note: 'no z-fighting' });
      // Valid alternative reasoning is explicitly welcomed and kept working.
      for (const [i, alt] of (def.mustPass || []).entries()) {
        const a = await play(def, alt.steps);
        results.push(a.finished ? { id: `${id} +${i + 1}`, ok: true, seconds: a.ticks * DT, note: alt.why }
          : { id: `${id} +${i + 1}`, ok: false, why: `alternative failed: ${alt.why}: ${a.error || 'did not finish'}` });
      }
      // Shortcuts the design means to rule out: each must NOT finish the level.
      for (const [i, bad] of (def.mustFail || []).entries()) {
        const b = await play(def, bad.steps);
        const name = `${id} ✗${i + 1}`;
        results.push(b.finished ? { id: name, ok: false, why: `shortcut worked: ${bad.why}` } : { id: name, ok: true, seconds: b.ticks * DT, note: bad.why });
      }
    } catch (e) {
      results.push({ id, ok: false, why: `crashed: ${e.message}` });
      console.error(e);
    }
    await new Promise(r => setTimeout(r, 0));
  }
  return { results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length };
}

