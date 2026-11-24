// kit.js — CAD geometry kit, hollow structural tube helpers, geometry batcher,
// and detailed non-penetrating crossbar-end ratchet strap assembly for B, C, and C′.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONTAINER, DESIGNS } from '../config.js';
import { hollowTubeGeometry, thickWebbing, rope, shadows, v3 } from '../parts.js';

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function ensureUvNormal(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    const clone = g.clone();
    clone.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return clone;
  }
  return g;
}

/**
 * Merges child Mesh geometries inside a Group (or array of meshes) by Material
 * to keep high CAD geometric detail at minimal WebGL draw calls.
 */
export function mergeByMaterial(root, name = 'merged') {
  const buckets = new Map();
  const invRoot = new THREE.Matrix4();
  if (root.isObject3D) {
    root.updateMatrixWorld(true);
    invRoot.copy(root.matrixWorld).invert();
  }
  const relMat = new THREE.Matrix4();

  const collect = (m) => {
    if (!m.isMesh || !m.geometry) return;
    relMat.multiplyMatrices(invRoot, m.matrixWorld);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const baseG = ensureUvNormal(m.geometry);
    const pos = baseG.attributes.position;
    const norm = baseG.attributes.normal;
    const uv = baseG.attributes.uv;
    const nVerts = pos.count;

    if (!baseG.groups.length || mats.length === 1) {
      const mat = mats[0];
      const transformed = baseG.clone().applyMatrix4(relMat);
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat).push(transformed);
    } else {
      for (const grp of baseG.groups) {
        const mat = mats[grp.materialIndex] || mats[0];
        const count = Math.min(grp.count, nVerts - grp.start);
        if (count <= 0) continue;
        const sub = new THREE.BufferGeometry();
        sub.setAttribute('position', new THREE.BufferAttribute(pos.array.slice(grp.start * 3, (grp.start + count) * 3), 3));
        sub.setAttribute('normal', new THREE.BufferAttribute(norm.array.slice(grp.start * 3, (grp.start + count) * 3), 3));
        sub.setAttribute('uv', new THREE.BufferAttribute(uv.array.slice(grp.start * 2, (grp.start + count) * 2), 2));
        sub.applyMatrix4(relMat);
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat).push(sub);
      }
    }
  };

  if (Array.isArray(root)) root.forEach(collect);
  else root.traverse(collect);

  const out = new THREE.Group();
  out.name = name;
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    out.add(shadows(mesh));
  }
  return out;
}

export function createPartKit() {
  const cache = new Map();
  const shared = (key, make) => {
    let g = cache.get(key);
    if (!g) cache.set(key, (g = make()));
    return g;
  };
  const k = (v) => Math.round(v * 1e5);
  const toV = (p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone());

  const stretched = (geo, a, b, mat) => {
    const A = toV(a), B = toV(b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(A).addScaledVector(dir, 0.5);
    if (len > 1e-7) m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.scale.set(1, len, 1);
    return shadows(m);
  };

  return {
    box(a, b, mat) {
      const lo = a.map((v, i) => Math.min(v, b[i]));
      const hi = a.map((v, i) => Math.max(v, b[i]));
      const [w, h, d] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const geo = shared(`box|${k(w)}|${k(h)}|${k(d)}`, () => new THREE.BoxGeometry(w, h, d));
      const m = new THREE.Mesh(geo, mat);
      m.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
      return shadows(m);
    },
    hollowTube(a, b, w, h, t, mat) {
      const A = toV(a), B = toV(b);
      const dir = B.clone().sub(A);
      const len = dir.length();
      const isX = Math.abs(dir.y) < 1e-5 && Math.abs(dir.z) < 1e-5 && Math.abs(dir.x) > 1e-5;
      const isZ = Math.abs(dir.x) < 1e-5 && Math.abs(dir.y) < 1e-5 && Math.abs(dir.z) > 1e-5;
      const axis = isX ? 'x' : isZ ? 'z' : 'z';
      const geo = shared(
        `htube|${k(w)}|${k(h)}|${k(t)}|${k(len)}|${axis}`,
        () => hollowTubeGeometry({ w, h, t, length: len, axis }),
      );
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(A).addScaledVector(dir, 0.5);
      if (!isX && !isZ && len > 1e-7) m.quaternion.setFromUnitVectors(Z_AXIS, dir.normalize());
      return shadows(m);
    },
    cyl(a, b, r, mat, seg = 12) {
      const geo = shared(`cyl|${k(r)}|${seg}`, () => new THREE.CylinderGeometry(r, r, 1, seg, 1, false));
      return stretched(geo, a, b, mat);
    },
    hex(pos, dir, mat, { r = 0.007, h = 0.005 } = {}) {
      const P = toV(pos), D = toV(dir).normalize();
      return this.cyl(P, P.clone().addScaledVector(D, h), r, mat, 6);
    },
    instances(geometry, mat, matrices) {
      const im = new THREE.InstancedMesh(geometry, mat, matrices.length);
      const m4 = new THREE.Matrix4();
      matrices.forEach((item, i) => {
        if (item.isMatrix4) im.setMatrixAt(i, item);
        else im.setMatrixAt(i, m4.makeTranslation(item[0], item[1], item[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      return shadows(im);
    },
  };
}

/**
 * Detailed non-penetrating crossbar-end ratchet strap assembly matching 확대 이미지.png:
 *   1) Galvanized U-collar bracket with bolts + semicircular D-ring below panel underside
 *   2) 50 mm thick twill-woven orange strap down exterior wall + coiled ratchet tensioner buckle
 *   3) Twin-wire forged steel J-hook engaged in the container's lower lashing pocket
 *
 * CRITICAL: Every vertex satisfies y <= yBarTop + 0.004 (< gap.y1), never crossing over panels.
 */
export function buildCrossbarStrap(kit, mats, { x, zSide, yBarTop, yBarBot, crossbarHalf = 1.60, crossbarW = 0.08 }) {
  const raw = new THREE.Group();
  const s = Math.sign(zSide);
  const zBarEnd = s * (crossbarHalf - 0.032); // ≈ ±1.568 m (outside container wall z = ±1.50 m)
  const zWall = s * 1.545;
  const barHalfW = crossbarW / 2;
  const colHalfW = barHalfW + 0.004;

  // 1) Crossbar-end U-collar clamp + M8 bolts + semicircular D-ring (below panel underside)
  const zc0 = zBarEnd - 0.022, zc1 = zBarEnd + 0.022;
  // Left & right vertical cheeks hugging the crossbar sides
  raw.add(kit.box([x - colHalfW, yBarBot - 0.003, zc0], [x - barHalfW, yBarTop + 0.003, zc1], mats.zinc));
  raw.add(kit.box([x + barHalfW, yBarBot - 0.003, zc0], [x + colHalfW, yBarTop + 0.003, zc1], mats.zinc));
  // Top & bottom straps of U-collar (top flush at yBarTop + 0.003)
  raw.add(kit.box([x - colHalfW, yBarTop, zc0], [x + colHalfW, yBarTop + 0.003, zc1], mats.zinc));
  raw.add(kit.box([x - colHalfW, yBarBot - 0.003, zc0], [x + colHalfW, yBarBot, zc1], mats.zinc));

  // Transverse M8 pinch bolt through collar below crossbar
  const boltY = yBarBot - 0.011;
  raw.add(kit.box([x - colHalfW, boltY - 0.012, zBarEnd - 0.015], [x - barHalfW, yBarBot, zBarEnd + 0.015], mats.zinc));
  raw.add(kit.box([x + barHalfW, boltY - 0.012, zBarEnd - 0.015], [x + colHalfW, yBarBot, zBarEnd + 0.015], mats.zinc));
  raw.add(kit.cyl([x - colHalfW - 0.006, boltY, zBarEnd], [x + colHalfW + 0.006, boltY, zBarEnd], 0.0045, mats.stainless, 8));
  raw.add(kit.hex([x + colHalfW + 0.002, boltY, zBarEnd], [1, 0, 0], mats.stainless, { r: 0.008, h: 0.005 }));
  raw.add(kit.hex([x - colHalfW - 0.002, boltY, zBarEnd], [-1, 0, 0], mats.stainless, { r: 0.008, h: 0.005 }));

  // Semicircular welded steel D-ring suspended from the pinch pin
  const dRingY = boltY - 0.026;
  const dRingZ = zBarEnd + s * 0.005;
  const dPts = [
    v3(x - 0.026, boltY, zBarEnd),
    v3(x - 0.026, dRingY + 0.009, dRingZ),
    v3(x - 0.016, dRingY, dRingZ),
    v3(x, dRingY - 0.002, dRingZ),
    v3(x + 0.016, dRingY, dRingZ),
    v3(x + 0.026, dRingY + 0.009, dRingZ),
    v3(x + 0.026, boltY, zBarEnd),
  ];
  raw.add(rope(dPts, 0.0038, mats.zinc, 18, 6));

  // 2) Upper 50mm x 3mm woven webbing wrapping collar & D-ring down to ratchet buckle
  const yb = 1.32;
  const upperPts = [
    v3(x, yBarTop + 0.002, zBarEnd - s * 0.020),
    v3(x, yBarTop + 0.002, zBarEnd + s * 0.020),
    v3(x, yBarBot + 0.006, zBarEnd + s * 0.024),
    v3(x, dRingY, zBarEnd + s * 0.008),
    v3(x, dRingY - 0.045, zWall),
    v3(x, yb + 0.048, zWall),
  ];
  raw.add(thickWebbing(upperPts, 0.050, 0.003, mats.strap, v3(1, 0, 0)));
  // Contrast lockstitch box reinforcement just below the D-ring fold
  raw.add(kit.box([x - 0.021, dRingY - 0.068, zWall + s * 0.0018], [x + 0.021, dRingY - 0.042, zWall + s * 0.0025], mats.strapStitch));

  // 3) Detailed Mechanical Ratchet Tensioner (yb = 1.32m)
  const zBack = zWall + s * 0.002;
  const zMid = zWall + s * 0.019;
  const cheekW = 0.004;
  // Twin left/right side cheek frames + back bridge plate
  for (const sx of [-1, 1]) {
    const cx = x + sx * 0.030;
    raw.add(kit.box([cx - cheekW / 2, yb - 0.065, zBack], [cx + cheekW / 2, yb + 0.062, zMid + s * 0.012], mats.ratchet));
  }
  raw.add(kit.box([x - 0.028, yb - 0.064, zBack], [x + 0.028, yb + 0.018, zBack + s * 0.004], mats.ratchet));
  raw.add(kit.cyl([x - 0.035, yb - 0.052, zBack + s * 0.010], [x + 0.035, yb - 0.052, zBack + s * 0.010], 0.0055, mats.steelDark, 8));

  // Slotted central mandrel shaft + coiled wound orange strap cylinder
  raw.add(kit.cyl([x - 0.036, yb, zMid], [x + 0.036, yb, zMid], 0.009, mats.steelDark, 10));
  raw.add(kit.cyl([x - 0.025, yb, zMid], [x + 0.025, yb, zMid], 0.0175, mats.strap, 14));

  // Twin 12-tooth ratchet gear wheels + locking pawl plate
  for (const sx of [-1, 1]) {
    const gx = x + sx * 0.027;
    raw.add(kit.cyl([gx - 0.002, yb, zMid], [gx + 0.002, yb, zMid], 0.020, mats.ratchet, 16));
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI * 2) / 12;
      const tooth = kit.box([gx - 0.002, yb - 0.0028, zMid - 0.0028], [gx + 0.002, yb + 0.0028, zMid + 0.0028], mats.ratchet);
      tooth.position.set(gx, yb + Math.cos(a) * 0.0205, zMid + Math.sin(a) * 0.0205);
      tooth.rotation.x = -a;
      raw.add(tooth);
    }
  }
  raw.add(kit.box([x - 0.028, yb - 0.032, zMid - s * 0.008], [x + 0.028, yb - 0.020, zMid + s * 0.006], mats.steelDark));

  // Stamped outer lever handle angled outward (~12 deg) + release latch plate
  const lever = new THREE.Group();
  const legA = [x - 0.034, yb, zMid], legB = [x - 0.034, yb + 0.115, zMid + s * 0.022];
  const legC = [x + 0.034, yb, zMid], legD = [x + 0.034, yb + 0.115, zMid + s * 0.022];
  lever.add(kit.box([legA[0] - 0.003, yb, zMid - 0.009], [legA[0] + 0.003, yb + 0.118, zMid + 0.009], mats.ratchet));
  lever.add(kit.box([legC[0] - 0.003, yb, zMid - 0.009], [legC[0] + 0.003, yb + 0.118, zMid + 0.009], mats.ratchet));
  lever.add(kit.box([x - 0.032, yb + 0.098, zMid - 0.007], [x + 0.032, yb + 0.125, zMid + 0.011], mats.ratchet));
  lever.add(kit.box([x - 0.022, yb + 0.052, zMid - 0.005], [x + 0.022, yb + 0.072, zMid + 0.006], mats.steelDark));
  lever.position.set(x, yb, zMid);
  lever.children.forEach((c) => c.position.sub(v3(x, yb, zMid)));
  lever.rotation.x = s * 0.18;
  raw.add(lever);

  // 4) Lower taut 50mm woven strap + folded bottom loop (y = yb - 0.055 .. 0.145)
  const lowerPts = [
    v3(x, yb - 0.052, zWall),
    v3(x, 0.72, zWall),
    v3(x, 0.148, zWall),
  ];
  raw.add(thickWebbing(lowerPts, 0.050, 0.003, mats.strap, v3(1, 0, 0)));
  raw.add(kit.box([x - 0.021, 0.165, zWall + s * 0.0018], [x + 0.021, 0.200, zWall + s * 0.0026], mats.strapStitch));

  // 5) Twin-wire forged yellow-zinc J-hook engaging lower frame lashing slot (y = 0.036 .. 0.152 m)
  raw.add(kit.cyl([x - 0.022, 0.150, zWall], [x + 0.022, 0.150, zWall], 0.0042, mats.ratchet, 8));
  for (const dx of [-0.010, 0.010]) {
    const jPts = [
      v3(x + dx, 0.150, zWall),
      v3(x + dx, 0.056, zWall),
      v3(x + dx, 0.037, s * 1.525),
      v3(x + dx, 0.044, s * 1.498),
      v3(x + dx, 0.070, s * 1.498),
    ];
    raw.add(rope(jPts, 0.0035, mats.ratchet, 18, 6));
  }
  raw.add(kit.cyl([x - 0.010, 0.070, s * 1.498], [x + 0.010, 0.070, s * 1.498], 0.0035, mats.ratchet, 8));

  return mergeByMaterial(raw, 'ratchetStrap');
}

export function finishModel({ id, group, parts, installSteps, anchors, gap, topSurfaces, windLoose, gapBox = null }) {
  const d = DESIGNS[id];
  const shadeMeshes = [];
  group.traverse((o) => {
    if (o.isMesh) {
      o.userData.transmittance = 0;
      shadeMeshes.push(o);
    }
  });
  const rr = CONTAINER.roofRect;
  const resolvedGap = gap > 0
    ? (gapBox || { y0: CONTAINER.roofY, y1: CONTAINER.roofY + gap, x0: rr.x0, x1: rr.x1, z0: rr.z0, z1: rr.z1 })
    : null;
  const yMid = gap > 0 ? CONTAINER.roofY + gap / 2 : CONTAINER.roofY + 0.02;
  return {
    id,
    group,
    parts,
    installSteps,
    callouts: d.callouts.map((c) => ({ n: c.n, text: c.text, sub: c.sub, anchor: anchors[c.n].clone() })),
    gapLabel: { text: d.gapText, anchor: new THREE.Vector3(0, yMid, 0) },
    shadeMeshes,
    topSurfaces,
    gap: resolvedGap,
    windLoose: windLoose || topSurfaces,
    update: () => {},
  };
}
