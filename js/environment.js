// environment.js — sky, sun, image-based lighting, ground, compass, scale figure, site context, sun path.
//
// Scene coords: +x East, +y Up, +z South (N = −z). The 6-unit comparison yard (|x| ≤ 13, |z| ≤ 8) is kept
// clear; all site props live outside it. DOM-only bits (canvas textures, sprites) are created only when
// `document` exists, so this module imports cleanly in Node; renderer-only bits (PMREM) need a renderer.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIPE_R, shadows } from './parts.js';

const hasDOM = typeof document !== 'undefined';
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const SUN_DIST = 40;              // directional light distance from the origin (m)
const SUN_INTENSITY_1000 = 3.2;   // light intensity at GHI = 1000 W/m²
const PATH_R = 14;                // sun-path dome radius (m)
const ENV_MIN_DEG = 4;            // regenerate the env map when the sun moved more than this
const ENV_MIN_INTERVAL = 0.4;     // … but not more often than this (s)
const NIGHT_BG = [0.055, 0.085, 0.14];                  // night sky floor behind the sky (display sRGB)
const NIGHT_HEMI = new THREE.Color(0.35, 0.45, 0.75);    // hemisphere sky tint at night (linear)
const WHITE = new THREE.Color(1, 1, 1);
const ENV_NIGHT = new THREE.Color(0.030, 0.038, 0.060);                                 // dim IBL floor (linear)

// ---------------------------------------------------------------- Preetham sky, mirrored from three's Sky shader
// Used to derive fog / hemisphere / sun colours that match what the Sky mesh actually draws.
const SKY = { turbidity: 5, rayleigh: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8 };
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const MIE_K = 0.434 * 0.2 * SKY.turbidity * 1e-17 * SKY.mieCoefficient;

function opticalLengths(cosZenith) {
  const zen = Math.acos(Math.max(0, cosZenith));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen / DEG, -1.253));
  return [8.4e3 * inv, 1.25e3 * inv];
}

/** Linear sky radiance (pre tone mapping) seen in direction d with the sun toward s (both unit). */
function skyRadiance(d, s, out) {
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - Math.acos(clamp(s.y, -1, 1))) / 1.5));
  const [sR, sM] = opticalLengths(d.y);
  const cosT = d.x * s.x + d.y * s.y + d.z * s.z;
  const rPh = (3 / (16 * Math.PI)) * (1 + (cosT * 0.5 + 0.5) ** 2);
  const g = SKY.mieDirectionalG;
  const mPh = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5));
  const k = clamp((1 - s.y) ** 5, 0, 1);
  const bias = [0, 0.0003, 0.00075];
  for (let c = 0; c < 3; c++) {
    const bR = TOTAL_RAYLEIGH[c] * SKY.rayleigh, bM = MIE_CONST[c] * MIE_K;
    const fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPh + bM * mPh) / (bR + bM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.sqrt(sunE * ratio * fex) - 1) * k;
    out[c] = Math.pow((lin + 0.1 * fex) * 0.04 + bias[c], 1 / 2.4);
  }
  return out;
}

/** Linear radiance → displayed sRGB (0..1), mimicking three's ACESFilmic tone mapping + sRGB output. */
function toDisplay(lin, exposure, aces, out) {
  let r = lin[0] * exposure, g = lin[1] * exposure, b = lin[2] * exposure;
  if (aces) {
    r /= 0.6; g /= 0.6; b /= 0.6;
    const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
    const ig = 0.07600 * r + 0.90834 * g + 0.01566 * b;
    const ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
    const f = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
    const fr = f(ir), fg = f(ig), fb = f(ib);
    r = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb;
    g = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb;
    b = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb;
  }
  const enc = (v) => { v = clamp(v, 0, 1); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
  out[0] = enc(r); out[1] = enc(g); out[2] = enc(b);
  return out;
}

/** Sun disc colour from atmospheric extinction (physical Rayleigh, softened), normalised to max = 1. */
function sunTint(s, out) {
  const [sR, sM] = opticalLengths(Math.max(s.y, 0.02));
  let m = 0;
  for (let c = 0; c < 3; c++) { out[c] = Math.exp(-(TOTAL_RAYLEIGH[c] * sR + MIE_CONST[c] * MIE_K * sM)); m = Math.max(m, out[c]); }
  for (let c = 0; c < 3; c++) out[c] = Math.sqrt(out[c] / m);
  return out;
}

// Sample directions: upper hemisphere (for sky light) and a ring just above the horizon (for fog).
const HEMI_DIRS = [new THREE.Vector3(0, 1, 0)];
const HORIZON_DIRS = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  for (const el of [25, 55]) HEMI_DIRS.push(new THREE.Vector3(Math.cos(el * DEG) * Math.cos(a), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(a)));
  HORIZON_DIRS.push(new THREE.Vector3(Math.cos(2 * DEG) * Math.cos(a), Math.sin(2 * DEG), Math.cos(2 * DEG) * Math.sin(a)));
}

// ---------------------------------------------------------------- small helpers
function rng(seed) {             // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvasTex(w, h, draw, { repeat = [1, 1], anisotropy = 4 } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  return t;
}

/** Draw fn at (x, y) and at its wrapped copies so the texture tiles seamlessly. */
function wrapDraw(w, h, x, y, r, fn) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const px = x + dx, py = y + dy;
    if (px + r >= 0 && px - r <= w && py + r >= 0 && py - r <= h) fn(px, py);
  }
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** InstancedMesh from a list of {p:[x,y,z], r?:[rx,ry,rz], s?:[sx,sy,sz]} or Matrix4. */
function instanced(geo, mat, items, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((it, i) => {
    if (it.isMatrix4) { mesh.setMatrixAt(i, it); return; }
    _q.setFromEuler(new THREE.Euler(...(it.r || [0, 0, 0])));
    mesh.setMatrixAt(i, _m4.compose(_p.set(...it.p), _q, _s.set(...(it.s || [1, 1, 1]))));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  return shadows(mesh);
}

/** Matrix placing a unit box/cylinder (height along +y, centred) between a and b with cross-section w×d. */
function memberMatrix(a, b, w, d = w) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  _q.setFromUnitVectors(UP, dir.divideScalar(len || 1));
  return new THREE.Matrix4().compose(_p.copy(a).lerp(b, 0.5), _q, _s.set(w, len, d));
}

// ---------------------------------------------------------------- ground, pad, compass
function buildGround(aniso) {
  const group = new THREE.Group();
  group.name = 'ground';

  // Gravel / compacted soil, tiled every 3.5 m; vertex colours add large-scale variation against tiling.
  const gravel = canvasTex(512, 512, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#857c6f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {            // soft blotches
      const x = r() * w, y = r() * h, rad = 30 + r() * 90, dark = r() < 0.5;
      wrapDraw(w, h, x, y, rad, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, dark ? 'rgba(60,52,44,0.10)' : 'rgba(190,180,165,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 24000; i++) {         // grit
      const v = 95 + r() * 80;
      g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.86},0.5)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    const pal = ['#9a9285', '#6f675c', '#b3aa9b', '#5b544b', '#a39a8a', '#8c8272'];
    for (let i = 0; i < 2600; i++) {          // pebbles
      const x = r() * w, y = r() * h, rx = 1.5 + r() * 3.5, ry = rx * (0.6 + r() * 0.4), rot = r() * Math.PI, col = pal[(r() * pal.length) | 0];
      wrapDraw(w, h, x, y, rx + 1, (px, py) => {
        g.fillStyle = 'rgba(40,35,30,0.35)'; g.beginPath(); g.ellipse(px + 0.8, py + 0.8, rx, ry, rot, 0, Math.PI * 2); g.fill();
        g.fillStyle = col; g.beginPath(); g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); g.fill();
      });
    }
  }, { repeat: [2000 / 3.5, 2000 / 3.5], anisotropy: aniso });

  const geo = new THREE.PlaneGeometry(2000, 2000, 50, 50).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), r = rng(11);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const k = 1 + 0.07 * Math.sin(x / 37 + ph[0]) * Math.cos(z / 29 + ph[1]) + 0.05 * Math.sin((x + z) / 83 + ph[2]);
    col.set([k, k * 0.995, k * 0.985], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const groundMat = new THREE.MeshStandardMaterial({ name: 'ground', color: gravel ? 0xffffff : 0x857c6f, map: gravel, roughness: 1, metalness: 0, vertexColors: true });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.position.y = -0.02;
  ground.name = 'groundPlane';
  ground.receiveShadow = true;
  group.add(ground);

  // Concrete pad under the comparison yard (top at y = 0, 2 cm proud of the gravel).
  const concrete = canvasTex(512, 512, (g, w, h) => {
    const r2 = rng(3);
    g.fillStyle = '#b8b4ab'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 18000; i++) { const v = 150 + r2() * 70; g.fillStyle = `rgba(${v},${v},${v * 0.96},0.35)`; g.fillRect(r2() * w, r2() * h, 1, 1); }
    for (let i = 0; i < 14; i++) {
      const x = r2() * w, y = r2() * h, rad = 20 + r2() * 70;
      wrapDraw(w, h, x, y, rad, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, 'rgba(90,85,78,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    g.strokeStyle = 'rgba(70,68,64,0.55)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);   // saw-cut joints
  }, { repeat: [6, 4], anisotropy: aniso });
  const padMat = new THREE.MeshStandardMaterial({ name: 'concretePad', color: concrete ? 0xffffff : 0xb8b4ab, map: concrete, roughness: 0.92, metalness: 0 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(28, 0.05, 18), padMat);
  pad.position.y = -0.025;
  pad.name = 'concretePad';
  pad.receiveShadow = true;
  group.add(pad);

  return { group, ground, pad, materials: [groundMat, padMat] };
}

function buildCompass(x0, z0) {
  const group = new THREE.Group();
  group.name = 'compass';
  group.position.set(x0, 0, z0);
  const R = 1.6;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
  const mats = {
    plinth: new THREE.MeshStandardMaterial({ name: 'compassPlinth', color: 0xc9c5bb, roughness: 0.9 }),
    paint: std({ name: 'compassPaint', color: 0xf2f1ec }),
    red: std({ name: 'compassRed', color: 0xe0463a }),
    redDark: std({ name: 'compassRedDark', color: 0x9e2419 }),
    grey: std({ name: 'compassGrey', color: 0xe9e7e1 }),
    greyDark: std({ name: 'compassGreyDark', color: 0x3d4248 }),
  };
  const top = 0.03;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.05, 0.06, 56), mats.plinth);
  plinth.position.y = 0;
  group.add(shadows(plinth, false, true));

  // Flat decals: shape coords (x = East, y = North) → rotated onto the ground (shape +y → −z).
  const flat = (geo, mat, y) => { const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), mat); m.position.y = y; m.receiveShadow = true; group.add(m); return m; };
  flat(new THREE.RingGeometry(1.02, 1.09, 64), mats.paint, top + 0.003);

  // Compass star: each point is two triangles (lit / shaded halves). Bold red N.
  const half = (len, w, r0, sgn) => new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, len), new THREE.Vector2(0, 0), new THREE.Vector2(sgn * w, r0)]));
  const points = [
    { a: 0, len: 1.12, w: 0.2, light: mats.red, dark: mats.redDark },
    { a: -90, len: 0.86, w: 0.13, light: mats.grey, dark: mats.greyDark },
    { a: 180, len: 0.86, w: 0.13, light: mats.grey, dark: mats.greyDark },
    { a: 90, len: 0.86, w: 0.13, light: mats.grey, dark: mats.greyDark },
    ...[-45, -135, 135, 45].map((a) => ({ a, len: 0.55, w: 0.08, light: mats.grey, dark: mats.greyDark, small: true })),
  ];
  for (const p of points) {
    const y = top + (p.small ? 0.005 : 0.007);
    flat(half(p.len, p.w, p.w * 1.1, -1).rotateZ(p.a * DEG), p.light, y);
    flat(half(p.len, p.w, p.w * 1.1, 1).rotateZ(p.a * DEG), p.dark, y);
  }
  flat(new THREE.CircleGeometry(0.07, 20), mats.paint, top + 0.009);

  // Letters (N/E/S/W + Korean) painted on the plinth, canvas top = North.
  const letters = canvasTex(1024, 1024, (g, w) => {
    const px = w / (2 * R), c = w / 2;
    g.clearRect(0, 0, w, w);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const font = (size, weight = 'bold') => `${weight} ${Math.round(size * px)}px "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    const dirs = [['N', '북', 0], ['E', '동', 90], ['S', '남', 180], ['W', '서', 270]];
    for (const [en, ko, a] of dirs) {
      const s = Math.sin(a * DEG), k = -Math.cos(a * DEG);
      g.fillStyle = en === 'N' ? '#d8352a' : '#2f3338';
      g.font = font(0.24);
      g.fillText(en, c + s * 1.27 * px, c + k * 1.27 * px);
      g.fillStyle = '#4a4f55';
      g.font = font(0.12, '600');
      g.fillText(ko, c + s * 1.49 * px, c + k * 1.49 * px);
    }
    g.strokeStyle = '#4a4f55'; g.lineWidth = 0.012 * px;      // 10° ticks between the ring and the letters
    for (let a = 0; a < 360; a += 10) {
      if (a % 90 === 0) continue;
      const s = Math.sin(a * DEG), k = -Math.cos(a * DEG), r0 = a % 30 === 0 ? 1.11 : 1.12, r1 = a % 30 === 0 ? 1.2 : 1.16;
      g.beginPath(); g.moveTo(c + s * r0 * px, c + k * r0 * px); g.lineTo(c + s * r1 * px, c + k * r1 * px); g.stroke();
    }
  });
  if (letters) {
    letters.wrapS = letters.wrapT = THREE.ClampToEdgeWrapping;
    const m = flat(new THREE.PlaneGeometry(2 * R, 2 * R), std({ name: 'compassLetters', map: letters, transparent: true, alphaTest: 0.2, depthWrite: false }), top + 0.004);
    m.raycast = () => {};
    // Upright "N" marker that reads from any view angle.
    const nTex = canvasTex(128, 128, (g) => {
      g.fillStyle = '#d8352a'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#ffffff'; g.font = 'bold 76px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 64, 68);
    });
    nTex.wrapS = nTex.wrapT = THREE.ClampToEdgeWrapping;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nTex, depthWrite: false }));
    sprite.position.set(0, 0.55, -1.25);
    sprite.scale.setScalar(0.5);
    sprite.name = 'compassN';
    sprite.raycast = () => {};
    group.add(sprite);
  }
  return group;
}

// ---------------------------------------------------------------- 1.7 m worker (scale figure)
function buildWorker() {
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
  const M = {
    skin: std(0xd9a988, { roughness: 0.6 }), pants: std(0x2e3a4e), shirt: std(0x4f6d8f),
    vest: std(0xff6a13, { emissive: 0x3a1200, roughness: 0.7 }), strip: std(0xdfe3e6, { metalness: 0.6, roughness: 0.3 }),
    helmet: std(0xf2c318, { roughness: 0.4 }), boots: std(0x3b2f25, { roughness: 0.9 }),
  };
  const g = new THREE.Group();
  g.name = 'worker';
  const add = (geo, mat, x, y, z, rz = 0, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; m.scale.z = sz; g.add(m); return m; };

  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.11, 0.1, 0.26), M.boots, sx * 0.1, 0.05, 0.03);
    add(new THREE.CapsuleGeometry(0.068, 0.70, 4, 10), M.pants, sx * 0.1, 0.50, 0);                   // legs 0.08–0.92
    add(new THREE.CapsuleGeometry(0.05, 0.50, 4, 10), M.shirt, sx * 0.225, 1.14, 0, sx * 0.06);      // arms
    add(new THREE.SphereGeometry(0.045, 12, 8), M.skin, sx * 0.245, 0.83, 0);                          // hands
  }
  add(new THREE.CapsuleGeometry(0.16, 0.26, 4, 16), M.shirt, 0, 1.17, 0, 0, 0.62);                   // torso 0.88–1.46
  add(new THREE.CapsuleGeometry(0.168, 0.20, 4, 16), M.vest, 0, 1.2, 0, 0, 0.66);                    // safety vest
  for (const y of [1.12, 1.27]) add(new THREE.CylinderGeometry(0.172, 0.172, 0.035, 20, 1, true), M.strip, 0, y, 0, 0, 0.67);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), M.skin, 0, 1.49, 0);                          // neck
  add(new THREE.SphereGeometry(0.105, 18, 12), M.skin, 0, 1.595, 0);                                  // head (top 1.70)
  add(new THREE.SphereGeometry(0.122, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.helmet, 0, 1.62, 0); // hard hat
  add(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 20), M.helmet, 0, 1.622, 0);
  add(new THREE.BoxGeometry(0.13, 0.01, 0.07), M.helmet, 0, 1.624, 0.14);                             // peak faces +z
  return { group: shadows(g), materials: Object.values(M) };
}

// ---------------------------------------------------------------- site context (outside |x| ≤ 13, |z| ≤ 8)
function buildSite(mats) {
  const group = new THREE.Group();
  group.name = 'site';
  const std = (name, color, o = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: 0.8, metalness: 0, ...o });
  const M = {
    fence: std('fencePanel', 0xf1f1ec, { roughness: 0.6, metalness: 0.2 }),
    stripe: std('fenceStripe', 0x2e8b57, { roughness: 0.6 }),
    post: std('fencePost', 0x8c9196, { metalness: 0.6, roughness: 0.5 }),
    block: std('concreteBlock', 0xa9a59c, { roughness: 0.95 }),
    timber: std('timber', 0x8b6a45, { roughness: 0.9 }),
    pallet: std('pallet', 0xc8a26b, { roughness: 0.9 }),
    cone: std('cone', 0xf26a1b, { roughness: 0.6 }),
    coneBand: std('coneBand', 0xf4f4f4, { roughness: 0.4 }),
    concrete: std('buildingConcrete', 0xa3a19b, { roughness: 0.95 }),
    rebar: std('rebar', 0x6b4f3a, { metalness: 0.5, roughness: 0.7 }),
    crane: std('crane', 0xe5b21c, { metalness: 0.3, roughness: 0.55 }),
    cab: std('craneCab', 0xe8ecee, { metalness: 0.2, roughness: 0.5 }),
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // Temporary site fence (가설울타리): white steel panels with a green stripe, x ±30 / z ±22, gate on the south.
  const PW = 2.0, PH = 2.0, XF = 30, ZF = 22;
  const panels = [], posts = [];
  const side = (fixed, from, to, alongX, skip) => {
    const n = Math.round((to - from) / PW);
    for (let i = 0; i < n; i++) {
      const u = from + (i + 0.5) * PW;
      if (skip(u, i)) continue;
      panels.push(alongX ? { p: [u, PH / 2, fixed], r: [0, 0, 0] } : { p: [fixed, PH / 2, u], r: [0, Math.PI / 2, 0] });
    }
    for (let i = 0; i <= n; i++) { const u = from + i * PW; posts.push(alongX ? [u, fixed] : [fixed, u]); }
  };
  side(-ZF, -XF, XF, true, (u, i) => i === 17);                 // north
  side(ZF, -XF, XF, true, (u) => Math.abs(u) < 4);              // south (site gate)
  side(XF, -ZF, ZF, false, (u, i) => i === 9);                  // east
  side(-XF, -ZF, ZF, false, (u, i) => i === 14);                // west
  group.add(instanced(unitBox, M.fence, panels.map((it) => ({ ...it, s: [PW - 0.02, PH, 0.025] })), 'fencePanels'));
  group.add(instanced(unitBox, M.stripe, panels.map((it) => ({ p: [it.p[0], 1.35, it.p[2]], r: it.r, s: [PW - 0.02, 0.28, 0.031] })), 'fenceStripes'));
  const uniq = [...new Map(posts.map((p) => [p.join(','), p])).values()];
  group.add(instanced(unitBox, M.post, uniq.map(([x, z]) => ({ p: [x, 1.07, z], s: [0.06, 2.14, 0.06] })), 'fencePosts'));
  group.add(instanced(unitBox, M.block, uniq.map(([x, z]) => ({ p: [x, 0.06, z], s: [0.4, 0.12, 0.4] })), 'fenceFeet'));

  // Scaffold pipe stack (φ48.6 × 6 m) on timber sleepers.
  const px = -22, pz = -14, gap = 0.004, pitch = 2 * PIPE_R + gap;
  const pipes = [];
  [6, 5, 4, 3].forEach((n, layer) => {
    for (let i = 0; i < n; i++) {
      const z = pz + (i - (n - 1) / 2) * pitch, y = 0.1 + PIPE_R + layer * pitch * Math.sin(60 * DEG);
      pipes.push({ p: [px, y, z], r: [0, 0, Math.PI / 2] });
    }
  });
  group.add(instanced(new THREE.CylinderGeometry(PIPE_R, PIPE_R, 6, 12), mats.steelGalv, pipes, 'scaffoldPipes'));
  group.add(instanced(unitBox, M.timber, [-2.2, 0, 2.2].map((dx) => ({ p: [px + dx, 0.05, pz], s: [0.12, 0.1, 0.6] })), 'sleepers'));

  // Pallets: stack of three plus one on the ground.
  const pal = [];
  for (const z of [-0.5, 0, 0.5]) pal.push(new THREE.BoxGeometry(1.1, 0.022, 0.1).translate(0, 0.011, z));
  for (const x of [-0.5, 0, 0.5]) for (const z of [-0.5, 0, 0.5]) pal.push(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(x, 0.072, z));
  for (let i = 0; i < 7; i++) pal.push(new THREE.BoxGeometry(1.1, 0.022, 0.1).translate(0, 0.133, -0.5 + i * (1 / 6)));
  const palletGeo = mergeGeometries(pal);
  group.add(instanced(palletGeo, M.pallet, [
    { p: [20, 0, -12] }, { p: [20, 0.144, -12], r: [0, 0.05, 0] }, { p: [20.02, 0.288, -12.03], r: [0, -0.04, 0] },
    { p: [21.5, 0, -12.4], r: [0, 0.35, 0] },
  ], 'pallets'));

  // Traffic cones along the east edge of the yard and at the gate.
  const cones = [-5, -3, -1, 1, 3, 5].map((z) => [15.5, z]).concat([[-5, 20.5], [5, 20.5]]);
  group.add(instanced(unitBox, mats.rubber, cones.map(([x, z]) => ({ p: [x, 0.015, z], s: [0.36, 0.03, 0.36] })), 'coneBases'));
  group.add(instanced(new THREE.ConeGeometry(0.13, 0.62, 16), M.cone, cones.map(([x, z]) => ({ p: [x, 0.34, z] })), 'cones'));
  group.add(instanced(new THREE.CylinderGeometry(0.0475, 0.0725, 0.12, 16, 1, true), M.coneBand, cones.map(([x, z]) => ({ p: [x, 0.37, z] })), 'coneBands'));

  // Building frame under construction ~40 m north: 4 cast floors + a partial 5th level with rebar.
  const bx = [-12, -6, 0, 6, 12], bz = [-38, -45, -52], FH = 3.6, ST = 0.25;
  const cols = [], slabs = [], bars = [];
  for (let k = 0; k < 5; k++) for (const x of bx) for (const z of bz) {
    const y0 = k * FH, y1 = (k + 1) * FH - ST;
    if (k < 4 || x <= 0) cols.push({ p: [x, (y0 + y1) / 2, z], s: [0.5, y1 - y0, 0.5] });
    else for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) bars.push({ p: [x + dx, y0 + 0.6, z + dz], s: [0.025, 1.2, 0.025] });
  }
  for (let k = 1; k <= 4; k++) slabs.push({ p: [0, k * FH - ST / 2, -45], s: [25, ST, 15] });
  slabs.push({ p: [0, 0.15, -45], s: [26, 0.3, 16] });
  group.add(instanced(unitBox, M.concrete, cols.concat(slabs), 'buildingFrame'));
  group.add(instanced(unitBox, M.rebar, bars, 'rebar'));

  // Tower crane beside the building: lattice mast, jib toward −x, counter-jib, cab, hook.
  const members = [];
  const cx = 17, cz = -44, H = 32, a = 0.8, V = (x, y, z) => new THREE.Vector3(cx + x, y, cz + z);
  const corners = [[-a, -a], [a, -a], [a, a], [-a, a]];
  for (const [x, z] of corners) members.push(memberMatrix(V(x, 0.6, z), V(x, H, z), 0.14));
  for (let y = 0.6; y < H - 0.1; y += 2) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
      members.push(memberMatrix(V(x0, y, z0), V(x1, y, z1), 0.07));
      members.push(memberMatrix(V(x0, y, z0), V(x1, Math.min(H, y + 2), z1), 0.06));
    }
  }
  const JL = 40, CJ = 12, jy = H + 1.2;
  for (const dz of [-0.6, 0.6]) members.push(memberMatrix(V(-JL, jy, dz), V(CJ, jy, dz), 0.12));
  members.push(memberMatrix(V(-JL, jy + 1.4, 0), V(0, jy + 1.4, 0), 0.1));
  for (let x = -JL; x < 0; x += 2.5) for (const dz of [-0.6, 0.6]) members.push(memberMatrix(V(x, jy, dz), V(x + 1.25, jy + 1.4, 0), 0.05), memberMatrix(V(x + 1.25, jy + 1.4, 0), V(x + 2.5, jy, dz), 0.05));
  members.push(memberMatrix(V(0, H, 0), V(0, H + 7, 0), 0.25));                          // tower head
  members.push(memberMatrix(V(0, H + 7, 0), V(-24, jy + 1.4, 0), 0.04), memberMatrix(V(0, H + 7, 0), V(CJ, jy, 0), 0.04));   // pendants
  members.push(memberMatrix(V(-26, jy - 0.1, 0), V(-26, 12, 0), 0.02));                  // hoist rope
  group.add(instanced(unitBox, M.crane, members, 'crane'));
  group.add(instanced(unitBox, M.concrete, [
    { p: [cx + CJ - 2, jy - 0.6, cz], s: [3, 2.2, 2] },                                   // counterweight
    { p: [cx, 0.3, cz], s: [4, 0.6, 4] },                                                 // footing
  ], 'craneBlocks'));
  group.add(instanced(unitBox, M.cab, [{ p: [cx + 1.6, H + 0.4, cz + 1.1], s: [1.8, 2, 1.4] }], 'craneCab'));
  group.add(instanced(unitBox, M.post, [{ p: [cx - 26, 11.8, cz], s: [0.5, 0.5, 0.35] }], 'hookBlock'));

  return { group, materials: Object.values(M), geometries: [unitBox, palletGeo] };
}

// ---------------------------------------------------------------- sun path dome + sun marker
function buildSunPath() {
  const group = new THREE.Group();
  group.name = 'sunPath';
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
  const tickMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false, fog: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false, fog: false });
  const dashes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), dashMat, 512);
  const ticks = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), tickMat, 64);
  const line = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  dashes.count = 0; ticks.count = 0;
  for (const o of [dashes, ticks, line]) { o.frustumCulled = false; o.raycast = () => {}; o.renderOrder = 2; group.add(o); }

  const marker = new THREE.Group();
  marker.name = 'sunMarker';
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false, fog: false }));
  ball.raycast = () => {};
  marker.add(ball);
  const haloTex = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,230,160,0.9)'); gr.addColorStop(0.35, 'rgba(255,190,90,0.35)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  if (haloTex) {
    haloTex.wrapS = haloTex.wrapT = THREE.ClampToEdgeWrapping;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    halo.scale.setScalar(2.6);
    halo.raycast = () => {};
    marker.add(halo);
  }
  group.add(marker);
  return { group, dashes, ticks, line, marker, materials: [dashMat, tickMat, lineMat, ball.material] };
}

/** Polyline segments above the horizon (×R), inserting exact horizon crossings. */
function pathSegments(dirs, R) {
  const segs = [];
  let cur = null;
  for (let i = 0; i < dirs.length; i++) {
    const v = dirs[i], prev = dirs[i - 1];
    if (prev && (prev.y < 0) !== (v.y < 0)) {
      const t = prev.y / (prev.y - v.y);
      const h = prev.clone().lerp(v, t); h.y = 0; h.normalize().multiplyScalar(R);
      if (v.y >= 0) { cur = [h]; segs.push(cur); } else if (cur) { cur.push(h); cur = null; }
    }
    if (v.y >= 0) {
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(v.clone().multiplyScalar(R));
    } else cur = null;
  }
  return segs.filter((s) => s.length > 1);
}

/**
 * Hour-tick positions. With explicit clock hours, ticks sit on whole hours; otherwise every 15° of hour
 * angle around the fitted celestial axis, anchored at solar noon (the highest point).
 */
function hourTicks(dirs, hours, R) {
  const out = [];
  const up = dirs.filter((v) => v.y >= 0);
  if (hours) {
    for (let i = 1; i < dirs.length; i++) {
      const h0 = hours[i - 1], h1 = hours[i];
      if (!(h1 > h0)) continue;
      for (let h = Math.ceil(h0); h <= h1; h++) {
        if (h === h0 && i > 1) continue;                          // counted as the previous segment's end
        const p = dirs[i - 1].clone().lerp(dirs[i], (h - h0) / (h1 - h0)).normalize();
        if (p.y >= -1e-6) out.push({ p: p.multiplyScalar(R), noon: h === 12 });
      }
    }
    return out;
  }
  if (up.length < 4) return out;
  const axis = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i + 2 < up.length; i++) axis.add(e1.subVectors(up[i + 1], up[i]).cross(e2.subVectors(up[i + 2], up[i + 1])));
  if (axis.lengthSq() < 1e-14) return out;
  axis.normalize();
  const noon = up.reduce((a, b) => (b.y > a.y ? b : a));
  const ref = noon.clone().addScaledVector(axis, -noon.dot(axis)).normalize();
  const side = new THREE.Vector3().crossVectors(axis, ref);
  const ang = (v) => { const q = v.clone().addScaledVector(axis, -v.dot(axis)); return Math.atan2(q.dot(side), q.dot(ref)) / DEG; };
  const A = dirs.map(ang);
  for (let i = 1; i < dirs.length; i++) {
    const a0 = A[i - 1], a1 = A[i];
    if (Math.abs(a1 - a0) > 90) continue;                         // wrap-around guard
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    for (let k = Math.ceil(lo / 15); k * 15 <= hi; k++) {
      if (k * 15 === a0 && i > 1) continue;                       // counted as the previous segment's end
      const t = a1 === a0 ? 0 : (k * 15 - a0) / (a1 - a0);
      const p = dirs[i - 1].clone().lerp(dirs[i], t).normalize();
      if (p.y >= -1e-6) out.push({ p: p.multiplyScalar(R), noon: k === 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- public API
/**
 * Build sky, lights, ground and site context into `scene`.
 * @returns {{ sun, hemi, setSun, setShadowBounds, setSunPath, setSunPathVisible, update, sky, group, dispose }}
 */
export function buildEnvironment({ scene, renderer, mats }) {
  const hasRenderer = !!renderer && typeof renderer.getRenderTarget === 'function';
  if (hasRenderer && renderer.toneMapping === THREE.NoToneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.55;
  }
  if (hasRenderer && renderer.shadowMap && !renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const aniso = hasRenderer ? Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 4) : 4;

  const group = new THREE.Group();
  group.name = 'environment';
  scene.add(group);

  // --- sky (drawn additively over a night-blue background so nights are not pitch black)
  const sky = new Sky();
  sky.name = 'sky';
  sky.scale.setScalar(900);
  sky.frustumCulled = false;
  sky.raycast = () => {};
  sky.material.blending = THREE.AdditiveBlending;
  const setSkyUniforms = (u) => {
    u.turbidity.value = SKY.turbidity; u.rayleigh.value = SKY.rayleigh;
    u.mieCoefficient.value = SKY.mieCoefficient; u.mieDirectionalG.value = SKY.mieDirectionalG;
  };
  setSkyUniforms(sky.material.uniforms);
  group.add(sky);
  scene.background = new THREE.Color(0, 0, 0);
  scene.fog = new THREE.Fog(0xc8d2dc, 150, 900);

  // --- environment map from a copy of the sky (+ a ground disc so metals reflect ground, not haze)
  const envScene = new THREE.Scene();
  envScene.background = ENV_NIGHT.clone();
  const envSky = new Sky();
  envSky.material.blending = THREE.AdditiveBlending;
  setSkyUniforms(envSky.material.uniforms);
  envSky.scale.setScalar(10);
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(60, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a352e }));
  envGround.position.y = -1.5;
  envScene.add(envSky, envGround);
  const pmrem = hasRenderer ? new THREE.PMREMGenerator(renderer) : null;
  let envRT = null, envAge = Infinity, envPending = false;
  const envDir = new THREE.Vector3(0, -1, 0);

  // --- lights
  const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY_1000);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd4ee, 0x6b6357, 0.6);
  hemi.name = 'hemi';
  scene.add(hemi);

  function setShadowBounds(radius = 7) {
    const r = Math.max(1, radius), cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = Math.max(0.5, SUN_DIST - r - 12);
    cam.far = SUN_DIST + r + 12;
    cam.updateProjectionMatrix();
    const texel = (2 * r) / sun.shadow.mapSize.x;
    sun.shadow.normalBias = texel * 1.2;                 // ~3.5 mm at r=6 — no acne on 4 mm sheets
    sun.shadow.bias = -0.002 / (cam.far - cam.near);     // ≈ 2 mm toward the light, avoids peter-panning
    sun.shadow.needsUpdate = true;
  }
  setShadowBounds(7);

  // --- ground, compass, worker, site
  const ground = buildGround(aniso);
  group.add(ground.group);
  group.add(buildCompass(-12, 9));
  const worker = buildWorker();
  worker.group.position.set(2.2, 0, 2.6);        // beside the single-unit door, facing +z
  group.add(worker.group);
  const site = buildSite(mats);
  group.add(site.group);

  // --- sun path
  const path = buildSunPath();
  group.add(path.group);
  let pathVisible = true;

  // --- per-sun state
  const curDir = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  let curEl = 50;
  const rad = [0, 0, 0], acc = [0, 0, 0], disp = [0, 0, 0];

  function regenerateEnv() {
    envAge = 0; envPending = false;
    envDir.copy(curDir);
    if (!pmrem) return;
    envSky.material.uniforms.sunPosition.value.copy(curDir);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }

  function requestEnv(force = false) {
    const moved = envDir.angleTo(curDir) / DEG;
    const bothDark = curDir.y < -0.1 && envDir.y < -0.1;       // below ≈ −6°: sky is black either way
    if (!force && (moved <= ENV_MIN_DEG || bothDark)) return;
    if (force || envAge >= ENV_MIN_INTERVAL) regenerateEnv(); else envPending = true;
  }

  function setSun({ dir, elevationDeg, ghi } = {}) {
    if (dir && Number.isFinite(dir.x + dir.y + dir.z)) curDir.set(dir.x, dir.y, dir.z);
    else if (Number.isFinite(elevationDeg)) curDir.set(0, Math.sin(elevationDeg * DEG), Math.cos(elevationDeg * DEG));
    if (curDir.lengthSq() < 1e-12) curDir.set(0, 1, 0);
    curDir.normalize();
    curEl = Number.isFinite(elevationDeg) ? elevationDeg : Math.asin(clamp(curDir.y, -1, 1)) / DEG;
    const G = Math.max(0, Number.isFinite(ghi) ? ghi : 0);
    const day = smoothstep(-6, 10, curEl);                       // 0 = night … 1 = full day
    const night = 1 - smoothstep(-8, 3, curEl);

    // Direct sun
    sun.position.copy(curDir).multiplyScalar(SUN_DIST);
    sun.intensity = curEl > 0 ? (SUN_INTENSITY_1000 * G) / 1000 : 0;
    sunTint(curDir, rad);
    sun.color.setRGB(rad[0], rad[1], rad[2]);

    // Sky shader + night floor behind it
    sky.material.uniforms.sunPosition.value.copy(curDir);
    scene.background.setRGB(NIGHT_BG[0] * night, NIGHT_BG[1] * night, NIGHT_BG[2] * night, THREE.SRGBColorSpace);

    // Average sky radiance (hemisphere light colour, env ground brightness)
    acc.fill(0);
    for (const d of HEMI_DIRS) { skyRadiance(d, curDir, rad); for (let c = 0; c < 3; c++) acc[c] += rad[c] / HEMI_DIRS.length; }
    const skyLum = 0.2126 * acc[0] + 0.7152 * acc[1] + 0.0722 * acc[2];
    const m = Math.max(acc[0], acc[1], acc[2], 1e-6);
    // (desaturated: the env map already carries the sky's blue)
    hemi.color.setRGB(acc[0] / m, acc[1] / m, acc[2] / m).lerp(WHITE, 0.35).lerp(NIGHT_HEMI, 1 - day);
    hemi.groundColor.setRGB(0.42, 0.38, 0.33).multiplyScalar(0.35 + 0.65 * day);
    hemi.intensity = 0.18 + 0.72 * Math.pow(Math.min(1, G / 800), 0.8) + 0.1 * day;

    // Fog = what the sky shows just above the horizon (display space) + the night floor
    const exposure = hasRenderer ? renderer.toneMappingExposure : 0.55;
    const aces = !hasRenderer || renderer.toneMapping === THREE.ACESFilmicToneMapping;
    acc.fill(0);
    for (const d of HORIZON_DIRS) { toDisplay(skyRadiance(d, curDir, rad), exposure, aces, disp); for (let c = 0; c < 3; c++) acc[c] += disp[c] / HORIZON_DIRS.length; }
    const fc = acc.map((v, c) => Math.min(1, v + NIGHT_BG[c] * night));
    scene.fog.color.setRGB(fc[0], fc[1], fc[2], THREE.SRGBColorSpace);

    // Ground seen by the env map: albedo × (direct + sky) radiance
    const lg = (sun.intensity * Math.max(0, curDir.y)) / Math.PI + skyLum;
    envGround.material.color.setRGB(0.30 * lg + 0.01, 0.27 * lg + 0.01, 0.23 * lg + 0.012);

    // Sun marker on the dome
    path.marker.position.copy(curDir).multiplyScalar(PATH_R);
    path.marker.visible = pathVisible && curDir.y > -0.02;

    requestEnv(!envRT && !!pmrem);
  }

  function setSunPath(points = [], opts = {}) {
    const dirs = [], hours = [];
    for (const it of points || []) {
      const d = it && (it.isVector3 ? it : it.dir || it);
      if (!d || !Number.isFinite(d.x + d.y + d.z)) continue;
      dirs.push(new THREE.Vector3(d.x, d.y, d.z).normalize());
      hours.push(Number.isFinite(it.hour) ? it.hour : opts.hours?.[hours.length]);
    }
    const hasHours = hours.length > 1 && hours.every(Number.isFinite);

    // Dashes along each above-horizon segment
    const DASH = 0.42, GAP = 0.26, r = 0.045;
    const segs = pathSegments(dirs, PATH_R);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const at = (pts, cum, s, out) => {
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      return out.copy(pts[i - 1]).lerp(pts[i], clamp(t, 0, 1));
    };
    let n = 0;
    const linePos = [];
    for (const pts of segs) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) { cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1])); linePos.push(...pts[i - 1].toArray(), ...pts[i].toArray()); }
      const total = cum[cum.length - 1];
      for (let s = 0; s < total && n < path.dashes.instanceMatrix.count; s += DASH + GAP) {
        at(pts, cum, s, a); at(pts, cum, Math.min(total, s + DASH), b);
        if (a.distanceTo(b) < 1e-3) continue;
        path.dashes.setMatrixAt(n++, memberMatrix(a, b, r));
      }
    }
    path.dashes.count = n;
    path.dashes.instanceMatrix.needsUpdate = true;

    // Hour ticks
    const ticks = hourTicks(dirs, hasHours ? hours : null, PATH_R).slice(0, path.ticks.instanceMatrix.count);
    ticks.forEach((t, i) => path.ticks.setMatrixAt(i, _m4.compose(t.p, _q.identity(), _s.setScalar(t.noon ? 0.16 : 0.1))));
    path.ticks.count = ticks.length;
    path.ticks.instanceMatrix.needsUpdate = true;

    path.line.geometry.dispose();
    path.line.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
  }

  function setSunPathVisible(v) {
    pathVisible = !!v;
    path.group.visible = pathVisible;
    path.marker.visible = pathVisible && curDir.y > -0.02;
  }

  function update(dt = 0) {
    envAge += Number.isFinite(dt) ? dt : 0;
    if (envPending && envAge >= ENV_MIN_INTERVAL) regenerateEnv();
  }

  function dispose() {
    scene.remove(group, sun, sun.target, hemi);
    if (scene.environment === envRT?.texture) scene.environment = null;
    envRT?.dispose(); pmrem?.dispose();
    group.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (!Object.values(mats || {}).includes(m)) { m.map?.dispose?.(); m.dispose?.(); }
    });
    envSky.geometry.dispose(); envSky.material.dispose(); envGround.geometry.dispose(); envGround.material.dispose();
    sun.shadow.map?.dispose?.();
  }

  // Sensible defaults until main drives the sun.
  setSun({ dir: curDir, elevationDeg: curEl, ghi: 800 });

  return { sun, hemi, setSun, setShadowBounds, setSunPath, setSunPathVisible, update, sky, group, worker: worker.group, dispose };
}
