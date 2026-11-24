// flow.js — air particles streaming through the widthwise ventilated channels (4 bays between 5 crossbars).
// Ensures particles & direction arrows strictly travel through the actual ventilation channels and NEVER
// pass through crossbars or enter the container interior (§6.1, §6.2, §10.3).
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { tempToRGB } from './heatmap.js';

const R = CONTAINER.roofRect;
const BARE_BOX = { x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, y0: CONTAINER.roofY + 0.02, y1: CONTAINER.roofY + 0.30 };
const ARROW_COLOR = 0x2eaa4f;
const CHANNELS_COUNT = 4;
const FADE = 0.08;
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

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
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function visualSpeed(v) { return 0.6 + 0.9 * Math.tanh(Math.max(0, v) / 1.2); }

export function createGapFlow({ count = 700, additive = false } = {}) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const chanIdx = new Uint8Array(count);
  const phase = new Float32Array(count);
  const jitter = new Float32Array(count);
  const rand = rng(0x6b726f66);
  for (let i = 0; i < count; i++) {
    phase[i] = rand() * Math.PI * 2;
    jitter[i] = 0.85 + 0.3 * rand();
  }

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
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.raycast = () => {};

  const arrows = new THREE.Group();
  arrows.name = 'windArrows';
  const arrowMat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, toneMapped: false, transparent: true, opacity: 0.92 });
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const headGeo = new THREE.ConeGeometry(1, 1, 14, 1);
  const arrowList = [];
  for (let i = 0; i < CHANNELS_COUNT * 2; i++) {
    const shaft = new THREE.Mesh(shaftGeo, arrowMat);
    const head = new THREE.Mesh(headGeo, arrowMat);
    for (const m of [shaft, head]) { m.raycast = () => {}; m.castShadow = false; m.receiveShadow = false; arrows.add(m); }
    arrowList.push({ shaft, head });
  }
  points.add(arrows);

  let box = { ...BARE_BOX };
  let channels = [BARE_BOX];
  let channelMode = false;
  let bare = true;
  let time = 0;
  const dir = new THREE.Vector3(0, 0, 1);

  function seed() {
    for (let i = 0; i < count; i++) {
      const ci = i % channels.length;
      chanIdx[i] = ci;
      const ch = channels[ci];
      pos[i * 3] = ch.x0 + rand() * (ch.x1 - ch.x0);
      pos[i * 3 + 1] = ch.y0 + (0.12 + 0.76 * rand()) * (ch.y1 - ch.y0);
      pos[i * 3 + 2] = ch.z0 + rand() * (ch.z1 - ch.z0);
    }
    posAttr.needsUpdate = true;
  }

  function respawn(i) {
    const ch = channels[chanIdx[i]] || box;
    if (channelMode) {
      // Widthwise channel inlet (z0 if moving +z, z1 if moving -z)
      pos[i * 3] = ch.x0 + (0.06 + 0.88 * rand()) * (ch.x1 - ch.x0);
      pos[i * 3 + 1] = ch.y0 + (0.12 + 0.76 * rand()) * (ch.y1 - ch.y0);
      pos[i * 3 + 2] = dir.z >= 0 ? ch.z0 : ch.z1;
      return;
    }
    const x = ch.x0 + rand() * (ch.x1 - ch.x0);
    const z = ch.z0 + rand() * (ch.z1 - ch.z0);
    const tx = dir.x > 1e-9 ? (x - ch.x0) / dir.x : dir.x < -1e-9 ? (x - ch.x1) / dir.x : Infinity;
    const tz = dir.z > 1e-9 ? (z - ch.z0) / dir.z : dir.z < -1e-9 ? (z - ch.z1) / dir.z : Infinity;
    const t = Math.max(0, Math.min(tx, tz) - 1e-3);
    pos[i * 3] = clamp(x - dir.x * t, ch.x0, ch.x1);
    pos[i * 3 + 2] = clamp(z - dir.z * t, ch.z0, ch.z1);
    pos[i * 3 + 1] = ch.y0 + (0.12 + 0.76 * rand()) * (ch.y1 - ch.y0);
  }

  function setGap(gapBox) {
    bare = !gapBox;
    const g = gapBox || BARE_BOX;
    box = {
      x0: Math.min(g.x0, g.x1), x1: Math.max(g.x0, g.x1),
      y0: Math.min(g.y0, g.y1), y1: Math.max(g.y0, g.y1),
      z0: Math.min(g.z0, g.z1), z1: Math.max(g.z0, g.z1),
    };
    channelMode = Array.isArray(g.channels) && g.channels.length > 0;
    channels = channelMode ? g.channels : [box];
    const h = box.y1 - box.y0;
    material.size = clamp(h * 0.72, 0.055, 0.14);
    seed();
  }

  function placeArrows(windSpeed) {
    const cy = (box.y0 + box.y1) / 2;
    const len = clamp(0.42 + 0.18 * windSpeed, 0.42, 1.3);
    const r = clamp(0.016 + 0.003 * windSpeed, 0.016, 0.028);
    const headLen = Math.min(len * 0.4, r * 8);
    const pulse = 0.08 * Math.sin(time * Math.PI * 1.4);
    const q = _q.setFromUnitVectors(UP, dir);
    const gap = 0.18;

    if (channelMode) {
      // Strictly align 1 inlet + 1 outlet arrow per real ventilation channel (never crossing crossbars)
      arrowList.forEach(({ shaft, head }, k) => {
        const ci = k % channels.length;
        const side = k < channels.length ? -1 : 1;
        const ch = channels[ci];
        const cx = (ch.x0 + ch.x1) / 2;
        const hz = (ch.z1 - ch.z0) / 2;
        const cz = (ch.z0 + ch.z1) / 2;
        const s0 = side < 0 ? -(hz + gap + len) : hz + gap;
        const zBase = cz + dir.z * (s0 + pulse);
        const sl = len - headLen;
        shaft.position.set(cx, cy, zBase + dir.z * (sl / 2));
        shaft.quaternion.copy(q);
        shaft.scale.set(r, sl, r);
        head.position.set(cx, cy, zBase + dir.z * (len - headLen / 2));
        head.quaternion.copy(q);
        head.scale.set(r * 2.6, headLen, r * 2.6);
        shaft.visible = head.visible = true;
      });
      return;
    }

    const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
    const hx = (box.x1 - box.x0) / 2, hz = (box.z1 - box.z0) / 2;
    const px = -dir.z, pz = dir.x;
    const hd = Math.abs(dir.x) * hx + Math.abs(dir.z) * hz;
    const hp = Math.abs(px) * hx + Math.abs(pz) * hz;
    arrowList.forEach(({ shaft, head }, k) => {
      const idx = k % CHANNELS_COUNT;
      if (idx >= 3) { shaft.visible = head.visible = false; return; }
      shaft.visible = head.visible = true;
      const side = k < CHANNELS_COUNT ? -1 : 1;
      const off = ((idx + 0.5) / 3 * 2 - 1) * hp * 0.72;
      const s0 = side < 0 ? -(hd + gap + len) : hd + gap;
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

  function update(dt, { windSpeed = 1.5, windDirDeg = 270, gapVelocity, Tin, Tout } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    time += dt;
    if (!points.visible && dt > 0) return;
    const ws = Number.isFinite(windSpeed) ? Math.max(0, windSpeed) : 0;

    if (channelMode) {
      // Strictly widthwise flow along z (between crossbars)
      dir.set(0, 0, 1);
    } else {
      const rad = ((Number.isFinite(windDirDeg) ? windDirDeg : 270) * Math.PI) / 180;
      dir.set(-Math.sin(rad), 0, Math.cos(rad));
    }

    const vPhys = !bare && Number.isFinite(gapVelocity) && gapVelocity > 0 ? gapVelocity : 0.4 * ws;
    const spd = visualSpeed(vPhys);
    const t0 = Number.isFinite(Tin) ? Tin : 30;
    let t1 = Number.isFinite(Tout) ? Tout : t0 + (bare ? 15 : 6);
    if (bare) t1 = Math.max(t1, t0 + 4);

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const ch = channels[chanIdx[i]] || box;
      const h = ch.y1 - ch.y0, m = Math.min(0.004, h * 0.05);
      const ph = phase[i], w = time * 1.9 + ph;
      const s = spd * jitter[i];
      const latAmp = 0.03 * spd, vertAmp = Math.min(0.10, h * 0.45) * spd;
      const px = -dir.z, pz = dir.x;
      const lat = latAmp * Math.sin(w);

      let x = pos[o] + (dir.x * s + px * lat) * dt;
      let z = pos[o + 2] + (dir.z * s + pz * lat) * dt;
      let y = pos[o + 1] + vertAmp * Math.cos(w * 1.37 + ph) * dt;
      if (x < ch.x0 || x > ch.x1 || z < ch.z0 || z > ch.z1) {
        respawn(i);
        x = pos[o]; y = pos[o + 1]; z = pos[o + 2];
      }
      x = clamp(x, ch.x0 + 0.02, ch.x1 - 0.02);
      y = clamp(y, ch.y0 + m, ch.y1 - m);
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;

      const sMin = dir.z * (dir.z >= 0 ? ch.z0 : ch.z1) + dir.x * (dir.x >= 0 ? ch.x0 : ch.x1);
      const sMax = dir.z * (dir.z >= 0 ? ch.z1 : ch.z0) + dir.x * (dir.x >= 0 ? ch.x1 : ch.x0);
      const sLen = Math.max(0.1, Math.abs(sMax - sMin));
      const u = clamp((dir.x * x + dir.z * z - Math.min(sMin, sMax)) / sLen, 0, 1);
      const yn = (y - ch.y0) / (h || 1);
      const heat = bare ? u * (1.25 - 0.5 * yn) : u;
      tempToRGB(t0 + (t1 - t0) * heat, col, i * 4);
      col[i * 4] = col[i * 4] * 0.8 + 0.2;
      col[i * 4 + 1] = col[i * 4 + 1] * 0.8 + 0.2;
      col[i * 4 + 2] = col[i * 4 + 2] * 0.8 + 0.2;
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
