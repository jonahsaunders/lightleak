// Finds z-fighting: two box faces on the same plane, facing the same way, overlapping, somewhere a
// player could see. Those flicker as the depth buffer can't decide which is in front.
// Run for every level by the test runner (npm test).
import { G } from './state.js';

const THREE = window.THREE;

export function auditLevel() {
  const L = G.L, faces = [], solids = [], box = new THREE.Box3();
  L.group.updateMatrixWorld(true);
  L.group.traverse(o => {
    if (!o.isMesh || !o.visible || o.geometry.type !== 'BoxGeometry' || o.userData.prop) return;
    const m = o.material;
    if (!m || (!Array.isArray(m) && m.visible === false)) return;
    box.setFromObject(o);
    const mn = box.min.toArray(), mx = box.max.toArray();
    if (Array.isArray(m) || !m.transparent) solids.push([mn, mx]);
    for (let ax = 0; ax < 3; ax++) for (const dir of [-1, 1]) {
      const [a, b] = [0, 1, 2].filter(i => i !== ax);
      faces.push({ ax, dir, c: dir > 0 ? mx[ax] : mn[ax], a, b, a0: mn[a], a1: mx[a], b0: mn[b], b1: mx[b], o });
    }
  });
  // where a player can be: the room and the corridor behind the door
  const r = L.def.room, d = r.door, dw = d.w || 2, dy = d.y || 0, cw = dw + 1;
  const spaces = [
    [[r.x0, r.wallBottom ?? 0, r.z0], [r.x1, r.h, r.z1]],
    [[d.x - cw / 2, dy, r.z0 - 4.5], [d.x + cw / 2, dy + (d.h || 2.6) + 0.4, r.z0]],
  ];
  const inside = (p, [mn, mx]) => p[0] > mn[0] && p[0] < mx[0] && p[1] > mn[1] && p[1] < mx[1] && p[2] > mn[2] && p[2] < mx[2];
  const open = p => spaces.some(s => inside(p, s)) && !solids.some(s => inside(p, s));
  const problems = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const f = faces[i], g = faces[j];
    if (f.o === g.o || f.ax !== g.ax || f.dir !== g.dir || Math.abs(f.c - g.c) > 1e-4) continue;
    const a0 = Math.max(f.a0, g.a0), a1 = Math.min(f.a1, g.a1), b0 = Math.max(f.b0, g.b0), b1 = Math.min(f.b1, g.b1);
    if (a1 - a0 <= 1e-3 || b1 - b0 <= 1e-3) continue;
    let seen = false;
    for (const u of [0.1, 0.5, 0.9]) for (const v of [0.1, 0.5, 0.9]) {
      const p = [0, 0, 0];
      p[f.ax] = f.c + f.dir * 0.002; p[f.a] = a0 + (a1 - a0) * u; p[f.b] = b0 + (b1 - b0) * v;
      if (open(p)) seen = true;
    }
    if (seen) {
      const at = [0, 1, 2].map(k => (k === f.ax ? f.c : k === f.a ? (a0 + a1) / 2 : (b0 + b1) / 2).toFixed(2));
      problems.push(`${'xyz'[f.ax]}${f.dir > 0 ? '+' : '-'} faces overlap at (${at.join(', ')})`);
    }
  }
  return problems;
}
