// shade.js — ray-cast shading of the roof plate by a design's shadeMeshes.
// DOM-free; safe to import in Node.
//
// Cell layout (shared with heatmap.js): index = iz * nx + ix, ix along +x (west → east),
// iz along +z (north → south), cells tiling CONTAINER.roofRect; samples at cell centres.
//
// Implementation notes
// * A ray from a roof sample toward the sun multiplies userData.transmittance (undefined → 0)
//   of every DISTINCT mesh (or instance) it passes through; it stops as soon as the product is 0.
// * Triangles are tested two-sided and materials are ignored (alphaMap / side / visibility),
//   so FrontSide planes seen from below and alpha-mapped DoubleSide nets are both hit.
// * Fast path: an any-hit Möller–Trumbore kernel on cached geometry data, with a uniform grid
//   for dense meshes and a world-AABB pre-test. No allocations per ray. Skinned / morphed
//   meshes fall back to THREE.Raycaster.
import * as THREE from 'three';
import { CONTAINER } from '../config.js';

const T_EPS = 1e-7;          // min ray parameter for a valid hit (m)
const T_ZERO = 1e-6;         // transmittance below this counts as fully blocked
const GRID_MIN_TRIS = 48;    // meshes with more triangles get a uniform grid
const GRID_MAX_RES = 96;
const SAMPLE_LIFT = 0.002;   // sample height above the roof plate (m)

// ---------------------------------------------------------------- geometry cache
const geoCache = new WeakMap();

function getGeoData(geometry) {
  const posAttr = geometry && geometry.getAttribute && geometry.getAttribute('position');
  if (!posAttr) return null;
  const index = geometry.getIndex();
  const c = geoCache.get(geometry);
  if (c && c.posAttr === posAttr && c.ver === posAttr.version &&
      c.index === index && c.iver === (index ? index.version : -1)) return c;

  const nV = posAttr.count;
  const pos = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    pos[i * 3] = posAttr.getX(i); pos[i * 3 + 1] = posAttr.getY(i); pos[i * 3 + 2] = posAttr.getZ(i);
  }
  const dr = geometry.drawRange;
  const total = index ? index.count : nV;
  const start = Math.max(0, dr.start), end = Math.min(total, dr.start + dr.count);
  const triCount = Math.max(0, Math.floor((end - start) / 3));
  const tri = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount * 3; i++) tri[i] = index ? index.getX(start + i) : start + i;

  // local AABB of the referenced vertices
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i++) {
    const o = tri[i] * 3;
    for (let a = 0; a < 3; a++) {
      const v = pos[o + a];
      if (v < box[a]) box[a] = v;
      if (v > box[a + 3]) box[a + 3] = v;
    }
  }
  const data = {
    posAttr, ver: posAttr.version, index, iver: index ? index.version : -1,
    pos, tri, triCount, box,
    grid: triCount > GRID_MIN_TRIS ? buildGrid(pos, tri, triCount, box) : null,
  };
  geoCache.set(geometry, data);
  return data;
}

// Grid resolution with ~`target` cells, proportional to the extents; thin axes collapse to 1.
function gridRes(ext, target) {
  const maxE = Math.max(ext[0], ext[1], ext[2], 1e-9);
  const e = ext.map((v) => Math.max(v, maxE * 1e-4));
  const r = [1, 1, 1];
  let active = [0, 1, 2];
  while (active.length) {
    let vol = 1;
    for (const i of active) vol *= e[i];
    const dens = Math.pow(target / vol, 1 / active.length);
    const keep = active.filter((i) => e[i] * dens >= 1);
    if (keep.length === active.length) {
      for (const i of active) r[i] = Math.min(GRID_MAX_RES, Math.max(1, Math.round(e[i] * dens)));
      break;
    }
    active = keep;
  }
  return r;
}

function buildGrid(pos, tri, n, box) {
  const pad = 1e-6 * Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1e-3);
  const min = [box[0] - pad, box[1] - pad, box[2] - pad];
  const ext = [box[3] - box[0] + 2 * pad, box[4] - box[1] + 2 * pad, box[5] - box[2] + 2 * pad];
  const [rx, ry, rz] = gridRes(ext, Math.min(Math.max(n, 8), 65536));
  const cs = [ext[0] / rx, ext[1] / ry, ext[2] / rz];
  const res = [rx, ry, rz];
  const cells = rx * ry * rz;
  const counts = new Uint32Array(cells + 1);
  const lo = [0, 0, 0], hi = [0, 0, 0];

  const cellRange = (t) => {
    for (let a = 0; a < 3; a++) {
      const v0 = pos[tri[t * 3] * 3 + a], v1 = pos[tri[t * 3 + 1] * 3 + a], v2 = pos[tri[t * 3 + 2] * 3 + a];
      const mn = Math.min(v0, v1, v2), mx = Math.max(v0, v1, v2);
      lo[a] = Math.min(res[a] - 1, Math.max(0, Math.floor((mn - min[a]) / cs[a])));
      hi[a] = Math.min(res[a] - 1, Math.max(0, Math.floor((mx - min[a]) / cs[a])));
    }
  };
  for (let t = 0; t < n; t++) {
    cellRange(t);
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) counts[(z * ry + y) * rx + x + 1]++;
  }
  for (let i = 1; i <= cells; i++) counts[i] += counts[i - 1];
  const items = new Uint32Array(counts[cells]);
  const fill = counts.slice(0, cells);
  for (let t = 0; t < n; t++) {
    cellRange(t);
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) items[fill[(z * ry + y) * rx + x]++] = t;
  }
  return { min, cs, rx, ry, rz, offsets: counts, items, stamp: new Uint32Array(n), ray: 0 };
}

// Two-sided Möller–Trumbore; true if the ray hits triangle t at parameter > T_EPS.
function triHit(pos, tri, t, ox, oy, oz, dx, dy, dz) {
  const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
  const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
  const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
  const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-15 && det < 1e-15) return false;
  const inv = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  return (e2x * qx + e2y * qy + e2z * qz) * inv > T_EPS;
}

// Slab test of a ray against an AABB [minX,minY,minZ,maxX,maxY,maxZ] stored at b[o..o+5].
// Writes the entry/exit parameters to `out` (if given). No allocations.
let _t0 = 0, _t1 = 0;
function slab(mn, mx, oa, da) {
  if (da > -1e-15 && da < 1e-15) return oa >= mn && oa <= mx;
  let ta = (mn - oa) / da, tb = (mx - oa) / da;
  if (ta > tb) { const s = ta; ta = tb; tb = s; }
  if (ta > _t0) _t0 = ta;
  if (tb < _t1) _t1 = tb;
  return _t0 <= _t1;
}
function rayBox(b, o, ox, oy, oz, dx, dy, dz, out) {
  _t0 = 0; _t1 = Infinity;
  if (!slab(b[o], b[o + 3], ox, dx) || !slab(b[o + 1], b[o + 4], oy, dy) || !slab(b[o + 2], b[o + 5], oz, dz)) return false;
  if (out) { out[0] = _t0; out[1] = _t1; }
  return true;
}

const _seg = [0, 0];

// Any-hit of a LOCAL-space ray against cached geometry data.
function geoAnyHit(g, ox, oy, oz, dx, dy, dz) {
  if (!rayBox(g.box, 0, ox, oy, oz, dx, dy, dz, _seg)) return false;
  const { pos, tri } = g;
  const G = g.grid;
  if (!G) {
    for (let t = 0; t < g.triCount; t++) if (triHit(pos, tri, t, ox, oy, oz, dx, dy, dz)) return true;
    return false;
  }
  // 3D-DDA through the uniform grid, mailboxing to test each triangle once per ray.
  if (++G.ray >= 0xffffffff) { G.stamp.fill(0); G.ray = 1; }
  const ray = G.ray, stamp = G.stamp, offs = G.offsets, items = G.items;
  const { rx, ry, rz } = G;
  const t0 = _seg[0], t1 = _seg[1];
  const px = ox + dx * t0, py = oy + dy * t0, pz = oz + dz * t0;
  const cx = G.cs[0], cy = G.cs[1], cz = G.cs[2];
  let ix = Math.min(rx - 1, Math.max(0, Math.floor((px - G.min[0]) / cx)));
  let iy = Math.min(ry - 1, Math.max(0, Math.floor((py - G.min[1]) / cy)));
  let iz = Math.min(rz - 1, Math.max(0, Math.floor((pz - G.min[2]) / cz)));
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx ? cx / Math.abs(dx) : Infinity, tdy = sy ? cy / Math.abs(dy) : Infinity, tdz = sz ? cz / Math.abs(dz) : Infinity;
  let tmx = sx ? t0 + (G.min[0] + (ix + (sx > 0 ? 1 : 0)) * cx - px) / dx : Infinity;
  let tmy = sy ? t0 + (G.min[1] + (iy + (sy > 0 ? 1 : 0)) * cy - py) / dy : Infinity;
  let tmz = sz ? t0 + (G.min[2] + (iz + (sz > 0 ? 1 : 0)) * cz - pz) / dz : Infinity;
  for (;;) {
    const cell = (iz * ry + iy) * rx + ix;
    for (let k = offs[cell], e = offs[cell + 1]; k < e; k++) {
      const t = items[k];
      if (stamp[t] === ray) continue;
      stamp[t] = ray;
      if (triHit(pos, tri, t, ox, oy, oz, dx, dy, dz)) return true;
    }
    if (tmx <= tmy && tmx <= tmz) {
      if (tmx > t1) break; ix += sx; if (ix < 0 || ix >= rx) break; tmx += tdx;
    } else if (tmy <= tmz) {
      if (tmy > t1) break; iy += sy; if (iy < 0 || iy >= ry) break; tmy += tdy;
    } else {
      if (tmz > t1) break; iz += sz; if (iz < 0 || iz >= rz) break; tmz += tdz;
    }
  }
  return false;
}

// ---------------------------------------------------------------- scene entries (per call)
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();
const _box = new THREE.Box3();
const _raycaster = new THREE.Raycaster();
const _hits = [];
let RAY_MAT = null;   // DoubleSide stand-in material for the Raycaster fallback

function transmittanceOf(o) {
  const t = o.userData ? o.userData.transmittance : undefined;
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

// Store inverse affine rows (12 numbers) of m at arr[o..o+11].
function storeInverse(m, arr, o) {
  _mi.copy(m).invert();
  const e = _mi.elements;
  arr[o] = e[0]; arr[o + 1] = e[4]; arr[o + 2] = e[8]; arr[o + 3] = e[12];
  arr[o + 4] = e[1]; arr[o + 5] = e[5]; arr[o + 6] = e[9]; arr[o + 7] = e[13];
  arr[o + 8] = e[2]; arr[o + 9] = e[6]; arr[o + 10] = e[10]; arr[o + 11] = e[14];
}

function storeBox(localBox, m, arr, o) {
  _box.min.set(localBox[0], localBox[1], localBox[2]);
  _box.max.set(localBox[3], localBox[4], localBox[5]);
  _box.applyMatrix4(m);
  arr[o] = _box.min.x; arr[o + 1] = _box.min.y; arr[o + 2] = _box.min.z;
  arr[o + 3] = _box.max.x; arr[o + 4] = _box.max.y; arr[o + 5] = _box.max.z;
}

/** Snapshot the occluders (world matrices must be current). Meshes with transmittance 1 are skipped. */
function prepareEntries(shadeMeshes) {
  const entries = [];
  const seen = new Set();
  const add = (mesh, tauFallback) => {
    if (seen.has(mesh) || !mesh.isMesh) return;
    seen.add(mesh);
    const tau = mesh.userData && Number.isFinite(mesh.userData.transmittance) ? transmittanceOf(mesh) : tauFallback;
    if (tau >= 1) return;
    const geo = mesh.geometry;
    const fallback = mesh.isSkinnedMesh || !!(geo && geo.morphAttributes && geo.morphAttributes.position);
    const data = fallback ? null : getGeoData(geo);
    if (!fallback && (!data || data.triCount === 0)) return;
    const e = { mesh, tau, data, fallback, n: 1, inv: null, boxes: null };
    if (fallback) {
      mesh.updateMatrixWorld();
      if (!geo.boundingBox) geo.computeBoundingBox();
      e.boxes = new Float64Array(6);
      storeBox([geo.boundingBox.min.x, geo.boundingBox.min.y, geo.boundingBox.min.z,
        geo.boundingBox.max.x, geo.boundingBox.max.y, geo.boundingBox.max.z], mesh.matrixWorld, e.boxes, 0);
      if (mesh.isSkinnedMesh) e.boxes.set([-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity]);
    } else if (mesh.isInstancedMesh) {
      e.n = mesh.count;
      e.inv = new Float64Array(e.n * 12);
      e.boxes = new Float64Array(e.n * 6);
      for (let i = 0; i < e.n; i++) {
        mesh.getMatrixAt(i, _m);
        _m.premultiply(mesh.matrixWorld);
        storeInverse(_m, e.inv, i * 12);
        storeBox(data.box, _m, e.boxes, i * 6);
      }
    } else {
      e.inv = new Float64Array(12);
      e.boxes = new Float64Array(6);
      storeInverse(mesh.matrixWorld, e.inv, 0);
      storeBox(data.box, mesh.matrixWorld, e.boxes, 0);
    }
    entries.push(e);
  };
  for (const obj of shadeMeshes || []) {
    if (!obj) continue;
    if (obj.isMesh) add(obj, 0);
    else if (obj.traverse) {
      const tauG = transmittanceOf(obj);
      obj.traverse((o) => { if (o.isMesh) add(o, tauG); });
    }
  }
  return entries;
}

// Number of distinct hits (instances) of a world-space ray on entry e.
function entryHits(e, ox, oy, oz, dx, dy, dz) {
  if (e.fallback) {
    if (!rayBox(e.boxes, 0, ox, oy, oz, dx, dy, dz, null)) return 0;
    if (!RAY_MAT) RAY_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    _raycaster.ray.origin.set(ox, oy, oz);
    _raycaster.ray.direction.set(dx, dy, dz);
    _hits.length = 0;
    const saved = e.mesh.material;
    e.mesh.material = RAY_MAT;
    try { e.mesh.raycast(_raycaster, _hits); } finally { e.mesh.material = saved; }
    for (let i = 0; i < _hits.length; i++) if (_hits[i].distance > T_EPS) return 1;
    return 0;
  }
  let count = 0;
  const inv = e.inv, boxes = e.boxes, g = e.data;
  for (let i = 0; i < e.n; i++) {
    if (!rayBox(boxes, i * 6, ox, oy, oz, dx, dy, dz, null)) continue;
    const o = i * 12;
    const lox = inv[o] * ox + inv[o + 1] * oy + inv[o + 2] * oz + inv[o + 3];
    const loy = inv[o + 4] * ox + inv[o + 5] * oy + inv[o + 6] * oz + inv[o + 7];
    const loz = inv[o + 8] * ox + inv[o + 9] * oy + inv[o + 10] * oz + inv[o + 11];
    const ldx = inv[o] * dx + inv[o + 1] * dy + inv[o + 2] * dz;
    const ldy = inv[o + 4] * dx + inv[o + 5] * dy + inv[o + 6] * dz;
    const ldz = inv[o + 8] * dx + inv[o + 9] * dy + inv[o + 10] * dz;
    if (geoAnyHit(g, lox, loy, loz, ldx, ldy, ldz)) count++;
  }
  return count;
}

// ---------------------------------------------------------------- sampling helpers
function cellCentres(nx, nz) {
  const R = CONTAINER.roofRect;
  const out = new Float64Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = (iz * nx + ix) * 3;
      out[i] = R.x0 + ((ix + 0.5) / nx) * (R.x1 - R.x0);
      out[i + 1] = R.y + SAMPLE_LIFT;
      out[i + 2] = R.z0 + ((iz + 0.5) / nz) * (R.z1 - R.z0);
    }
  }
  return out;
}

// Local points → world with m (Matrix4), into out.
function toWorld(local, m, out) {
  const e = m.elements;
  for (let i = 0; i < local.length; i += 3) {
    const x = local[i], y = local[i + 1], z = local[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

// Cosine-weighted hemisphere directions (+y up): Vogel spiral on the unit disk lifted to the hemisphere.
const dirCache = new Map();
function hemisphereDirs(n) {
  let d = dirCache.get(n);
  if (d) return d;
  d = new Float64Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), phi = i * golden;
    d[i * 3] = r * Math.cos(phi);
    d[i * 3 + 1] = Math.sqrt(Math.max(0, 1 - r * r));
    d[i * 3 + 2] = r * Math.sin(phi);
  }
  dirCache.set(n, d);
  return d;
}

// ---------------------------------------------------------------- public API
export function createShadeAnalyzer({ nx = 24, nz = 12 } = {}) {
  const nxc = Math.max(1, Math.round(nx / 2)), nzc = Math.max(1, Math.round(nz / 2));
  const localFine = cellCentres(nx, nz);
  const localCoarse = cellCentres(nxc, nzc);
  const worldFine = new Float64Array(localFine.length);
  const worldCoarse = new Float64Array(localCoarse.length);
  const scratch = new Float32Array(nx * nz);
  const R = CONTAINER.roofRect;
  const skyLocal = new Float64Array(27);
  for (let j = 0, k = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++, k += 3) {
      skyLocal[k] = R.x0 + ((i + 0.5) / 3) * (R.x1 - R.x0);
      skyLocal[k + 1] = R.y + SAMPLE_LIFT;
      skyLocal[k + 2] = R.z0 + ((j + 0.5) / 3) * (R.z1 - R.z0);
    }
  }
  const skyWorld = new Float64Array(27);
  const sun = new THREE.Vector3();
  let lastBlocker = -1;   // coherence: test the previous full blocker first

  function rayTransmittance(entries, ox, oy, oz, dx, dy, dz) {
    let t = 1;
    const n = entries.length;
    const first = lastBlocker >= 0 && lastBlocker < n ? lastBlocker : -1;
    for (let k = first >= 0 ? -1 : 0; k < n; k++) {
      const i = k < 0 ? first : k;
      if (k >= 0 && i === first) continue;
      const e = entries[i];
      const hits = entryHits(e, ox, oy, oz, dx, dy, dz);
      if (hits > 0) {
        t *= hits === 1 ? e.tau : Math.pow(e.tau, hits);
        if (t <= T_ZERO) { lastBlocker = i; return 0; }
      }
    }
    return t;
  }

  function readSun(sunDir) {
    if (!sunDir) return false;
    sun.set(sunDir.x, sunDir.y, sunDir.z);
    const len = sun.length();
    if (!(len > 0) || !(sun.y > 0)) return false;
    sun.divideScalar(len);
    return true;
  }

  function sampleGrid(entries, world, count, out) {
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      out[i] = entries.length ? rayTransmittance(entries, world[o], world[o + 1], world[o + 2], sun.x, sun.y, sun.z) : 1;
    }
    return out;
  }

  /** Per-cell fraction (0..1) of the direct beam reaching the roof. */
  function gridTransmittance(unitRoot, shadeMeshes, sunDir, out = new Float32Array(nx * nz)) {
    if (!readSun(sunDir)) return out.fill(0);
    unitRoot.updateWorldMatrix(true, true);
    const entries = prepareEntries(shadeMeshes);
    toWorld(localFine, unitRoot.matrixWorld, worldFine);
    return sampleGrid(entries, worldFine, nx * nz, out);
  }

  /** Area-averaged direct-beam fraction. */
  function meanTransmittance(unitRoot, shadeMeshes, sunDir) {
    const g = gridTransmittance(unitRoot, shadeMeshes, sunDir, scratch);
    let s = 0;
    for (let i = 0; i < g.length; i++) s += g[i];
    return s / g.length;
  }

  /** Roof's (transmittance-weighted) view factor to the sky: cosine-weighted rays from 9 roof points. */
  function skyView(unitRoot, shadeMeshes, samples = 128) {
    samples = Math.max(1, Math.round(samples));
    unitRoot.updateWorldMatrix(true, true);
    const entries = prepareEntries(shadeMeshes);
    if (!entries.length) return 1;
    toWorld(skyLocal, unitRoot.matrixWorld, skyWorld);
    const dirs = hemisphereDirs(samples);
    // Roof frame axes in world (the unit may be rotated).
    const e = unitRoot.matrixWorld.elements;
    const ax = new THREE.Vector3(e[0], e[1], e[2]).normalize();
    const ay = new THREE.Vector3(e[4], e[5], e[6]).normalize();
    const az = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    let sum = 0;
    for (let p = 0; p < 9; p++) {
      const rot = p * 2.399963;   // decorrelate the spiral between points (golden angle)
      const c = Math.cos(rot), s = Math.sin(rot);
      const ox = skyWorld[p * 3], oy = skyWorld[p * 3 + 1], oz = skyWorld[p * 3 + 2];
      for (let i = 0; i < samples; i++) {
        const lx0 = dirs[i * 3], ly = dirs[i * 3 + 1], lz0 = dirs[i * 3 + 2];
        const lx = lx0 * c - lz0 * s, lz = lx0 * s + lz0 * c;
        const dx = ax.x * lx + ay.x * ly + az.x * lz;
        const dy = ax.y * lx + ay.y * ly + az.y * lz;
        const dz = ax.z * lx + ay.z * ly + az.z * lz;
        sum += rayTransmittance(entries, ox, oy, oz, dx, dy, dz);
      }
    }
    return sum / (9 * samples);
  }

  /** Daily beam-transmittance profile on a coarse (nx/2 × nz/2) grid. sunDirAtHour(h) → Vector3|null. */
  function profile(unitRoot, shadeMeshes, sunDirAtHour, hours) {
    unitRoot.updateWorldMatrix(true, true);
    const entries = prepareEntries(shadeMeshes);
    toWorld(localCoarse, unitRoot.matrixWorld, worldCoarse);
    const n = nxc * nzc;
    const buf = new Float32Array(n);
    const hs = Array.from(hours || []);
    const beamTrans = hs.map((h) => {
      if (!readSun(sunDirAtHour(h))) return 0;
      sampleGrid(entries, worldCoarse, n, buf);
      let s = 0;
      for (let i = 0; i < n; i++) s += buf[i];
      return s / n;
    });
    return { hours: hs, beamTrans };
  }

  return { nx, nz, gridTransmittance, meanTransmittance, skyView, profile };
}
