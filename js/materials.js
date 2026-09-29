// Procedural textures and the materials built from them. Nothing here is loaded from disk.
const THREE = window.THREE;

let aniso = 4;
function paint(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function texture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Seeded so textures look the same every run.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
function grain(g, w, h, n, alpha, rand) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rand() * alpha})` : `rgba(255,255,255,${rand() * alpha * 0.6})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}
// One tile is one metre, so the grid doubles as a ruler.
function tile(base, line, half, seed) {
  const rand = rng(seed);
  return paint(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    grain(g, w, h, 3000, 0.08, rand);
    g.strokeStyle = line; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
    if (half) {
      g.globalAlpha = 0.4; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.globalAlpha = 1;
    }
  });
}

export const MAT = {};
export const PROP_TEX = {};
export const PRINT_TEX = [];

export function initMaterials(renderer) {
  aniso = renderer.capabilities.getMaxAnisotropy();
  const crate = paint(256, 256, (g, w, h) => {
    const rand = rng(11);
    g.fillStyle = '#9a6b3c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7d5530'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    grain(g, w, h, 2500, 0.12, rand);
    g.strokeStyle = '#5d3d20'; g.lineWidth = 26; g.strokeRect(13, 13, w - 26, h - 26);
    g.lineWidth = 22; g.beginPath(); g.moveTo(26, h - 26); g.lineTo(w - 26, 26); g.stroke();
    g.fillStyle = '#3a2614';
    for (const [x, y] of [[13, 13], [w - 13, 13], [13, h - 13], [w - 13, h - 13]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  });
  const steel = paint(256, 256, (g, w, h) => {
    const rand = rng(23);
    g.fillStyle = '#6f777c'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 4000, 0.1, rand);
    g.strokeStyle = '#4c5256'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.save(); g.beginPath(); g.rect(30, 100, w - 60, 56); g.clip();
    for (let x = -60, i = 0; x < w; x += 28, i++) { g.fillStyle = i % 2 ? '#1c1a18' : '#d9a52e'; g.beginPath(); g.moveTo(x, 156); g.lineTo(x + 28, 156); g.lineTo(x + 84, 100); g.lineTo(x + 56, 100); g.fill(); }
    g.restore();
    g.fillStyle = '#9aa2a6';
    for (const x of [22, w - 22]) for (const y of [22, h - 22]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
  });
  const plank = paint(256, 256, (g, w, h) => {
    const rand = rng(37);
    g.fillStyle = '#b8894f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8e6536'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const x = rand() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 10, h / 3, x - 10, h * 2 / 3, x + 4, h); g.stroke(); }
    grain(g, w, h, 2000, 0.1, rand);
    g.strokeStyle = '#6b4a26'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  });
  // Emulsion: the light-sensitive film that negatives can dissolve.
  const emulsion = paint(256, 256, (g, w, h) => {
    const rand = rng(51);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#3e0f0a'); grd.addColorStop(0.5, '#2c0906'); grd.addColorStop(1, '#360c08');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    grain(g, w, h, 5000, 0.12, rand);
    // faint drips, like film that hasn't set
    for (let i = 0; i < 9; i++) {
      const x = rand() * w, len = 40 + rand() * 120;
      const d = g.createLinearGradient(0, 0, 0, len);
      d.addColorStop(0, 'rgba(216,69,47,0.22)'); d.addColorStop(1, 'rgba(216,69,47,0)');
      g.fillStyle = d; g.fillRect(x, 0, 2 + rand() * 3, len);
    }
    g.strokeStyle = 'rgba(240,106,79,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  });
  PROP_TEX.crate = texture(crate); PROP_TEX.steel = texture(steel); PROP_TEX.plank = texture(plank);

  Object.assign(MAT, {
    wall: new THREE.MeshStandardMaterial({ map: texture(tile('#5f5953', '#403b36', true, 3), true), roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ map: texture(tile('#35302c', '#1e1b19', true, 5), true), roughness: 0.85 }),
    ceil: new THREE.MeshStandardMaterial({ map: texture(tile('#241f1c', '#171412', false, 7), true), roughness: 1 }),
    ledge: new THREE.MeshStandardMaterial({ map: texture(tile('#83786b', '#5a5046', true, 9), true), roughness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0807, roughness: 1 }),
    door: new THREE.MeshStandardMaterial({ map: texture(tile('#363b3f', '#212528', false, 13), true), roughness: 0.6, metalness: 0.4 }),
    safelight: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xd8452f, emissiveIntensity: 1.3 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2c0, emissiveIntensity: 1.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xcfe2dc, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.2, depthWrite: false }),
    emulsion: new THREE.MeshStandardMaterial({ map: texture(emulsion, true), roughness: 0.22, metalness: 0.15, emissive: 0x3a0a05, emissiveIntensity: 0.5 }),
    // decor
    wood: new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2c2f31, roughness: 0.5, metalness: 0.6 }),
    tray: new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.4 }),
    liquid: new THREE.MeshStandardMaterial({ color: 0x5b1a10, roughness: 0.05, metalness: 0.3 }),
    string: new THREE.LineBasicMaterial({ color: 0x8a7a66 }),
  });

  // Prints that hang on the drying lines: blurry sepia "photos" of nothing in particular.
  for (let i = 0; i < 6; i++) {
    const rand = rng(100 + i * 7);
    PRINT_TEX.push(texture(paint(96, 120, (g, w, h) => {
      g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
      const grd = g.createLinearGradient(0, 8, 0, 96);
      grd.addColorStop(0, `hsl(28, 25%, ${50 + rand() * 20}%)`); grd.addColorStop(1, `hsl(20, 30%, ${15 + rand() * 20}%)`);
      g.fillStyle = grd; g.fillRect(8, 8, w - 16, 88);
      g.fillStyle = `rgba(30,18,10,${0.4 + rand() * 0.3})`;
      for (let k = 0; k < 3; k++) { const s = 10 + rand() * 26; g.fillRect(8 + rand() * (w - 16 - s), 96 - s - rand() * 30, s, s); }
    })));
  }
}

// Box geometry whose UVs tile once per metre.
export function worldBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
  }
  return g;
}

export function propMaterial(type) {
  const roughness = type === 'steel' ? 0.45 : 0.82;
  return new THREE.MeshStandardMaterial({ map: PROP_TEX[type], roughness, metalness: type === 'steel' ? 0.55 : 0 });
}

// A canvas the page can draw on repeatedly (plate readouts).
export function canvasTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { canvas: c, tex: texture(c) };
}

// Film grain for the HUD overlay.
export function grainDataURL() {
  const rand = rng(77);
  return paint(160, 160, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }).toDataURL();
}
