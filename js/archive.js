// Original archive architecture, wayfinding, and visible mechanical cause and effect.
import { G } from './state.js';
import { MAT, stencilTexture } from './materials.js';
import { decal } from './dressing.js';

const T = window.THREE;
export const DEPARTMENTS = {
  drying: { name: 'Drying / Accession', color: 0xc88659, sound: 'drying' },
  storage: { name: 'Storage / Weighing', color: 0xb39c69, sound: 'storage' },
  restoration: { name: 'Restoration / Models', color: 0x7baca2, sound: 'restoration' },
  wet: { name: 'Wet Processing', color: 0xd87864, sound: 'wet' },
  exhibition: { name: 'Exhibition / Staff', color: 0xc5b28b, sound: 'exhibition' },
};

function mesh(parent, size, pos, material = MAT.trim) {
  const m = new T.Mesh(new T.BoxGeometry(...size), material);
  m.position.set(...pos); m.castShadow = m.receiveShadow = true; parent.add(m);
  return m;
}
function wire(points, material, parent = G.L.group) {
  const line = new T.Line(new T.BufferGeometry().setFromPoints(points.map(p => new T.Vector3(...p))), material);
  parent.add(line); return line;
}
function label(text, pos, w, h, rotation = 0) {
  return decal(stencilTexture([[text, 32, 700]]), pos, w, h, rotation);
}

export function dressArchive(def) {
  const L = G.L, r = def.room, d = r.door;
  const dept = DEPARTMENTS[def.department] || DEPARTMENTS.storage;
  const tint = new T.MeshStandardMaterial({ color: dept.color, roughness: 0.85 });
  const dy = d.y || 0;
  // The same overhead service rail and accession crest connect every department.
  const railY = r.h - 0.45;
  mesh(L.group, [0.12, 0.1, r.z1 - r.z0 - 0.6], [d.x, railY, (r.z0 + r.z1) / 2], tint).userData.ownMaterial = true;
  label(dept.name.toUpperCase(), [r.x0 + 0.008, Math.min(r.h - 0.7, 2.8), r.z1 - 2], 3, 0.5, 90);
  const route = def.route || 'ARCHIVE SERVICE SPINE';
  label(route.toUpperCase(), [d.x, dy + 2, r.z0 - 4.49], 2.3, 0.7, 0);
  // A structural landmark appears both before and after the restoration chapter.
  if (def.gallery) {
    const restored = def.gallery === 'return';
    for (const x of [-4, 4]) {
      mesh(L.group, [0.34, 4.8, 0.34], [x, 2.4, -3], MAT.trimLight);
      mesh(L.group, [0.5, 0.16, 0.5], [x, 4.88, -3], MAT.trim);
    }
    mesh(L.group, [8.6, 0.3, 0.5], [0, 5.2, -3], MAT.trim);
    label('ACCESSION 1604', [0, 4.6, -3.29], 3.4, 0.5, 180);
    // Empty portrait mounts are evidence of the staff, rather than another exposition card.
    for (let i = 0; i < 3; i++) {
      const z = -7 + i * 3;
      mesh(L.group, [0.12, 1.4, 1.05], [r.x0 + 0.16, 2.1, z], MAT.trim);
      const portrait = document.createElement('canvas'); portrait.width = 128; portrait.height = 192;
      const g = portrait.getContext('2d');
      g.fillStyle = '#c6b59a'; g.fillRect(0, 0, 128, 192);
      g.fillStyle = '#52463b'; g.beginPath(); g.arc(64, 63, 23, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(22, 162); g.quadraticCurveTo(24, 93, 64, 95); g.quadraticCurveTo(104, 93, 106, 162); g.fill();
      const paper = new T.Mesh(new T.PlaneGeometry(0.85, 1.14), new T.MeshStandardMaterial({ map: new T.CanvasTexture(portrait), roughness: 0.9 }));
      paper.visible = !restored; paper.userData.ownMaterial = true; paper.userData.ownMap = true;
      paper.rotation.y = Math.PI / 2; paper.position.set(r.x0 + 0.23, 2.1, z); L.group.add(paper);
      label(restored ? 'RELEASED' : 'STAFF / FILED', [r.x0 + 0.24, 1.15, z], 1.2, 0.24, 90);
    }
    if (restored) label('RESTORATION ACCESS OPEN', [r.x1 - 0.01, 2.2, -3], 3.2, 0.45, -90);
  }
  for (const w of r.windows || []) dressWindow(r, w);
  L.machinery = L.plates.map((p, i) => createMachinery(p, i, r));
}

function dressWindow(r, w) {
  const L = G.L, east = w.side !== 'west', dir = east ? 1 : -1;
  const wallX = east ? r.x1 : r.x0, width = w.width || 3;
  const low = w.low || 1.3, high = w.high || 3.6;
  const z = w.z, x = wallX + dir * 0.6;
  mesh(L.group, [2.3, 0.12, width + 0.3], [wallX + dir * 1.08, low - 0.09, z], MAT.trim);
  mesh(L.group, [0.2, high - low + 0.3, width + 0.2], [wallX + dir * 2.3, (low + high) / 2, z], MAT.wall);
  for (const dz of [-width / 2 - 0.04, width / 2 + 0.04])
    mesh(L.group, [0.13, high - low + 0.12, 0.1], [wallX - dir * 0.02, (low + high) / 2, z + dz]);
  for (const y of [low - 0.04, high + 0.04])
    mesh(L.group, [0.13, 0.1, width - 0.03], [wallX - dir * 0.02, y, z]);
  label(w.label || 'NEXT DEPARTMENT', [wallX - dir * 0.012, high + 0.36, z], width, 0.36, east ? -90 : 90);
  const glow = new T.PointLight(w.color || 0xbda689, 1.8, 5, 2);
  glow.position.set(x, high - 0.4, z); L.group.add(glow);
  // Equipment on the far side is a view into the archive's service passage.
  for (let i = 0; i < 3; i++) {
    const zc = z - width / 3 + i * width / 3;
    mesh(L.group, [0.6, 0.4 + i * 0.35, 0.55], [wallX + dir * 1.55, low + 0.26 + i * 0.175, zc], MAT.door);
  }
  if (w.enlarger) {
    mesh(L.group, [0.85, 0.55, 0.85], [wallX + dir * 1.1, high - 0.6, z], MAT.door);
    const lens = new T.Mesh(new T.CylinderGeometry(0.2, 0.26, 0.3, 20), MAT.trim);
    lens.position.set(wallX + dir * 1.1, high - 1.04, z); L.group.add(lens);
  }
}

function createMachinery(plate, i, r) {
  const L = G.L, d = r.door, x = d.x + (i % 2 ? 1 : -1) * (1.4 + Math.floor(i / 2) * 0.45);
  const top = (d.y || 0) + (d.h || 2.6) + 0.2;
  const m = new T.LineBasicMaterial({ color: 0xb57753 });
  const px = (plate.lo[0] + plate.hi[0]) / 2, pz = (plate.lo[2] + plate.hi[2]) / 2;
  const cable = wire([[px, plate.baseY + 0.1, pz], [px, r.h - 0.65, pz], [x, r.h - 0.65, r.z0 + 0.26], [x, top, r.z0 + 0.26]], m);
  cable.userData.ownMaterial = true;
  const weight = mesh(L.group, [0.27, 0.6, 0.3], [x, top - 0.55, r.z0 + 0.27], MAT.door);
  const pulley = new T.Mesh(new T.TorusGeometry(0.16, 0.04, 8, 20), MAT.trim);
  pulley.position.set(x, top + 0.1, r.z0 + 0.28); L.group.add(pulley);
  return { plate, weight, pulley, cable, home: weight.position.y, value: 0 };
}

export function stepMachinery() {
  for (const m of G.L.machinery || []) {
    const next = Math.min(1.25, m.plate.load / m.plate.need);
    m.value += (next - m.value) * 0.12;
    m.weight.position.y = m.home - m.value * 0.65;
    m.pulley.rotation.z = m.value * Math.PI;
    m.cable.material.color.setHex(m.plate.on ? 0x8fc27a : 0xb57753);
  }
}
