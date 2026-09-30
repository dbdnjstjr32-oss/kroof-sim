// flow.js — air particles streaming through the ventilated gap (the green arrows of the source figures).
// DOM-free: the round sprite is a DataTexture. Coordinates are container-local (add `object` to the unit root).
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { tempToRGB } from './heatmap.js';

const R = CONTAINER.roofRect;
// Without a design the air skims over the bare, hot roof plate.
const BARE_BOX = { x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, y0: 2.62, y1: 2.90 };
const ARROW_COLOR = 0x2eaa4f;
const ARROWS_PER_SIDE = 3;
const FADE = 0.08;             // fraction of the path used to fade particles in/out
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

// Deterministic PRNG (mulberry32) so the flow looks the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Soft round sprite: bright core, slightly darker rim (reads on same-coloured backgrounds), soft alpha edge.
let SPRITE = null;
function spriteTexture() {
  if (SPRITE) return SPRITE;
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = r >= 1 ? 0 : 1 - smoothstep(0.55, 1.0, r);
      const l = 1 - 0.45 * smoothstep(0.35, 0.85, r);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(255 * l);
      data[i + 3] = Math.round(255 * a);
    }
  }
  SPRITE = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  SPRITE.magFilter = THREE.LinearFilter;
  SPRITE.minFilter = THREE.LinearMipmapLinearFilter;
  SPRITE.generateMipmaps = true;
  SPRITE.needsUpdate = true;
  return SPRITE;
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Screen speed (m/s) for a physical air speed: always readable, monotonic, capped at 1.5.
function visualSpeed(v) { return 0.6 + 0.9 * Math.tanh(Math.max(0, v) / 1.2); }

/**
 * createGapFlow({ count, additive }) → { object, setGap, update, setVisible, arrows }
 * additive: use additive blending (default false — normal blending stays legible over white panels and bright sky).
 */
export function createGapFlow({ count = 700, additive = false } = {}) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);   // RGBA (vertex alpha fades particles at inlet/outlet)
  const phase = new Float32Array(count);
  const jitter = new Float32Array(count);
  const rand = rng(0x6b726f66);
  for (let i = 0; i < count; i++) { phase[i] = rand() * Math.PI * 2; jitter[i] = 0.85 + 0.3 * rand(); }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);

  const material = new THREE.PointsMaterial({
    size: 0.08,
    sizeAttenuation: true,
    map: spriteTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.02,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'gapFlow';
  points.frustumCulled = false;   // positions change every frame
  points.renderOrder = 3;
  points.raycast = () => {};

  // ---- green wind arrows outside the upwind / downwind faces
  const arrows = new THREE.Group();
  arrows.name = 'windArrows';
  const arrowMat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, toneMapped: false, transparent: true, opacity: 0.92 });
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const headGeo = new THREE.ConeGeometry(1, 1, 14, 1);
  const arrowList = [];
  for (let i = 0; i < ARROWS_PER_SIDE * 2; i++) {
    const shaft = new THREE.Mesh(shaftGeo, arrowMat);
    const head = new THREE.Mesh(headGeo, arrowMat);
    for (const m of [shaft, head]) { m.raycast = () => {}; m.castShadow = false; m.receiveShadow = false; arrows.add(m); }
    arrowList.push({ shaft, head });
  }
  points.add(arrows);

  let box = { ...BARE_BOX };
  let bare = true;
  let time = 0;
  const dir = new THREE.Vector3(1, 0, 0);   // direction the air moves (downwind)

  function seed() {
    const h = box.y1 - box.y0;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.x0 + rand() * (box.x1 - box.x0);
      pos[i * 3 + 1] = box.y0 + (0.1 + 0.8 * rand()) * h;
      pos[i * 3 + 2] = box.z0 + rand() * (box.z1 - box.z0);
    }
    posAttr.needsUpdate = true;
  }

  // Respawn particle i on the upwind boundary (uniform over the inflow cross-section).
  function respawn(i) {
    const x = box.x0 + rand() * (box.x1 - box.x0);
    const z = box.z0 + rand() * (box.z1 - box.z0);
    const tx = dir.x > 1e-9 ? (x - box.x0) / dir.x : dir.x < -1e-9 ? (x - box.x1) / dir.x : Infinity;
    const tz = dir.z > 1e-9 ? (z - box.z0) / dir.z : dir.z < -1e-9 ? (z - box.z1) / dir.z : Infinity;
    const t = Math.max(0, Math.min(tx, tz) - 1e-3);
    pos[i * 3] = clamp(x - dir.x * t, box.x0, box.x1);
    pos[i * 3 + 2] = clamp(z - dir.z * t, box.z0, box.z1);
    pos[i * 3 + 1] = box.y0 + (0.1 + 0.8 * rand()) * (box.y1 - box.y0);
  }

  function setGap(gapBox) {
    bare = !gapBox;
    const g = gapBox || BARE_BOX;
    box = {
      x0: Math.min(g.x0, g.x1), x1: Math.max(g.x0, g.x1),
      y0: Math.min(g.y0, g.y1), y1: Math.max(g.y0, g.y1),
      z0: Math.min(g.z0, g.z1), z1: Math.max(g.z0, g.z1),
    };
    const h = box.y1 - box.y0;
    // PointsMaterial size ≈ world size / tan(fov/2): ~2.5 cm dots in an 8–10 cm gap, ~6 cm in open canopies
    material.size = clamp(h * 0.75, 0.06, 0.16);
    seed();
  }

  function placeArrows(windSpeed) {
    const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2, cy = (box.y0 + box.y1) / 2;
    const hx = (box.x1 - box.x0) / 2, hz = (box.z1 - box.z0) / 2;
    const px = -dir.z, pz = dir.x;                           // horizontal perpendicular
    const hd = Math.abs(dir.x) * hx + Math.abs(dir.z) * hz;  // half extent along the flow
    const hp = Math.abs(px) * hx + Math.abs(pz) * hz;        // half extent across the flow
    const len = clamp(0.45 + 0.22 * windSpeed, 0.45, 1.8);
    const r = clamp(0.018 + 0.004 * windSpeed, 0.018, 0.035);
    const headLen = Math.min(len * 0.4, r * 8);
    const pulse = 0.08 * Math.sin(time * Math.PI * 1.4);
    const q = _q.setFromUnitVectors(UP, dir);
    arrowList.forEach(({ shaft, head }, k) => {
      const side = k < ARROWS_PER_SIDE ? -1 : 1;             // upwind / downwind
      const j = k % ARROWS_PER_SIDE;
      const off = ((j + 0.5) / ARROWS_PER_SIDE * 2 - 1) * hp * 0.75;
      const gap = 0.25;
      const s0 = side < 0 ? -(hd + gap + len) : hd + gap;   // tail position along the flow axis
      const tx = cx + dir.x * (s0 + pulse) + px * off;
      const tz = cz + dir.z * (s0 + pulse) + pz * off;
      const sl = len - headLen;
      shaft.position.set(tx + dir.x * sl / 2, cy, tz + dir.z * sl / 2);
      shaft.quaternion.copy(q);
      shaft.scale.set(r, sl, r);
      head.position.set(tx + dir.x * (len - headLen / 2), cy, tz + dir.z * (len - headLen / 2));
      head.quaternion.copy(q);
      head.scale.set(r * 2.6, headLen, r * 2.6);
    });
  }

  /**
   * dt (s); windSpeed (m/s), windDirDeg (FROM, meteorological: 270 → toward +x),
   * gapVelocity (m/s, falls back to 0.4·windSpeed), Tin = inlet (ambient) °C, Tout = outlet (gap) °C.
   */
  function update(dt, { windSpeed = 1.5, windDirDeg = 270, gapVelocity, Tin, Tout } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    time += dt;
    if (!points.visible && dt > 0) return;   // hidden: skip the particle work
    const ws = Number.isFinite(windSpeed) ? Math.max(0, windSpeed) : 0;
    const rad = ((Number.isFinite(windDirDeg) ? windDirDeg : 270) * Math.PI) / 180;
    dir.set(-Math.sin(rad), 0, Math.cos(rad));   // blowing TOWARD (opposite of FROM)

    const vPhys = !bare && Number.isFinite(gapVelocity) && gapVelocity > 0 ? gapVelocity : 0.4 * ws;
    const spd = visualSpeed(vPhys);
    const t0 = Number.isFinite(Tin) ? Tin : 30;
    let t1 = Number.isFinite(Tout) ? Tout : t0 + (bare ? 15 : 6);
    if (bare) t1 = Math.max(t1, t0 + 4);         // bare roof: air visibly picks up heat

    const h = box.y1 - box.y0, m = Math.min(0.004, h * 0.05);
    const px = -dir.z, pz = dir.x;
    // projection range of the box on the flow axis → normalised path coordinate
    const c0 = dir.x * box.x0 + dir.z * box.z0, c1 = dir.x * box.x1 + dir.z * box.z0;
    const c2 = dir.x * box.x0 + dir.z * box.z1, c3 = dir.x * box.x1 + dir.z * box.z1;
    const sMin = Math.min(c0, c1, c2, c3), sLen = Math.max(c0, c1, c2, c3) - sMin || 1;
    const latAmp = 0.05 * spd, vertAmp = Math.min(0.12, h * 0.5) * spd;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const ph = phase[i], w = time * 1.9 + ph;
      const s = spd * jitter[i];
      const lat = latAmp * Math.sin(w);
      let x = pos[o] + (dir.x * s + px * lat) * dt;
      let z = pos[o + 2] + (dir.z * s + pz * lat) * dt;
      let y = pos[o + 1] + vertAmp * Math.cos(w * 1.37 + ph) * dt;
      if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) {
        respawn(i);
        x = pos[o]; y = pos[o + 1]; z = pos[o + 2];
      }
      y = clamp(y, box.y0 + m, box.y1 - m);
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;

      // colour: inlet → outlet temperature along the path; bare roof air is hottest near the plate
      const u = clamp((dir.x * x + dir.z * z - sMin) / sLen, 0, 1);
      const yn = (y - box.y0) / (h || 1);
      const heat = bare ? u * (1.25 - 0.5 * yn) : u;
      tempToRGB(t0 + (t1 - t0) * heat, col, i * 4);
      // lift colours slightly toward white so particles read over the heat map
      col[i * 4] = col[i * 4] * 0.8 + 0.2; col[i * 4 + 1] = col[i * 4 + 1] * 0.8 + 0.2; col[i * 4 + 2] = col[i * 4 + 2] * 0.8 + 0.2;
      col[i * 4 + 3] = 0.95 * Math.min(1, u / FADE, (1 - u) / FADE);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    placeArrows(ws);
  }

  function setVisible(v) { points.visible = !!v; }

  setGap(null);
  update(0, {});
  return { object: points, setGap, update, setVisible, arrows, getBox: () => ({ ...box }) };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
