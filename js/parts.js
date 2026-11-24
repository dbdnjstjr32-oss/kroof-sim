// parts.js — CAD geometry helpers shared by the container and design builders.
// Everything here is plain three.js and runs in Node (no DOM).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Standard scaffold / crossbar / pole pipe radius (φ48.6 mm)
export const PIPE_R = 0.0243;

/** Enable cast+receive shadows on every mesh under obj. Returns obj. */
export function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

/**
 * Tag an object as (part of) a named part kind.
 * explode: offset (m) applied in exploded view, e.g. [0, 1.2, 0].
 */
export function tag(obj, { partKey, name, explode = [0, 0, 0], transmittance } = {}) {
  obj.userData.partKey = partKey;
  obj.userData.partName = name;
  obj.userData.explode = new THREE.Vector3(...explode);
  if (transmittance !== undefined) obj.traverse((o) => { if (o.isMesh) o.userData.transmittance = transmittance; });
  return shadows(obj);
}

/** Axis-aligned box centred at (x,y,z). */
export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return shadows(m);
}

/** Box spanning from min corner to max corner (both [x,y,z]). */
export function boxMinMax(min, max, mat) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  return box(w, h, d, mat, (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
}

function roundedRectPath(path, x, y, w, h, r, clockwise = false) {
  const hw = w / 2, hh = h / 2;
  const cr = Math.max(0, Math.min(r, hw * 0.45, hh * 0.45));
  const x0 = x - hw, x1 = x + hw, y0 = y - hh, y1 = y + hh;
  if (!clockwise) {
    path.moveTo(x0 + cr, y0);
    path.lineTo(x1 - cr, y0);
    path.quadraticCurveTo(x1, y0, x1, y0 + cr);
    path.lineTo(x1, y1 - cr);
    path.quadraticCurveTo(x1, y1, x1 - cr, y1);
    path.lineTo(x0 + cr, y1);
    path.quadraticCurveTo(x0, y1, x0, y1 - cr);
    path.lineTo(x0, y0 + cr);
    path.quadraticCurveTo(x0, y0, x0 + cr, y0);
  } else {
    path.moveTo(x0 + cr, y0);
    path.quadraticCurveTo(x0, y0, x0, y0 + cr);
    path.lineTo(x0, y1 - cr);
    path.quadraticCurveTo(x0, y1, x0 + cr, y1);
    path.lineTo(x1 - cr, y1);
    path.quadraticCurveTo(x1, y1, x1, y1 - cr);
    path.lineTo(x1, y0 + cr);
    path.quadraticCurveTo(x1, y0, x1 - cr, y0);
    path.lineTo(x0 + cr, y0);
  }
}

/**
 * True hollow rectangular steel tube (중공 각관) with rounded outer/inner corners.
 * Cross-section dimensions `w × h`, wall thickness `t`, extruded along `axis` ('z' | 'x' | 'y').
 */
export function hollowTubeGeometry({ w, h, t = 0.0029, length = 1, r, axis = 'z' }) {
  const wall = Math.max(0.0008, Math.min(t, Math.min(w, h) * 0.35));
  const rOut = Math.min(r ?? wall * 1.8, w * 0.18, h * 0.18);
  const iw = Math.max(0.002, w - 2 * wall);
  const ih = Math.max(0.002, h - 2 * wall);
  const rIn = Math.max(0.0004, rOut - wall);

  const shape = new THREE.Shape();
  roundedRectPath(shape, 0, 0, w, h, rOut, false);
  const hole = new THREE.Path();
  roundedRectPath(hole, 0, 0, iw, ih, rIn, true);
  shape.holes.push(hole);

  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 4, steps: 1 });
  g.translate(0, 0, -length / 2);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  else if (axis === 'y') g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Round pipe (cylinder) between two points a,b (Vector3 or [x,y,z]). */
export function pipeBetween(a, b, radius, mat, radialSegments = 16) {
  a = Array.isArray(a) ? v3(...a) : a; b = Array.isArray(b) ? v3(...b) : b;
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1, false), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return shadows(m);
}

/** Square/rectangular tube between two points. */
export function tubeBetween(a, b, w, h, mat) {
  a = Array.isArray(a) ? v3(...a) : a; b = Array.isArray(b) ? v3(...b) : b;
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, h), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return shadows(m);
}

/**
 * Flat panel with different top/bottom materials.
 * BoxGeometry material order: +x, -x, +y, -y, +z, -z.
 */
export function twoFacePanel(w, d, t, matTop, matBottom, matEdge) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), [matEdge, matEdge, matTop, matBottom, matEdge, matEdge]);
  return shadows(m);
}

/**
 * 3-layer ACP sandwich panel (top PVDF skin + slightly recessed black PE core + mill aluminum bottom skin).
 * Merged into one multi-material Mesh so raycasting & instancing behave identically to twoFacePanel.
 */
export function acpSandwichPanel(w, d, t, matTop, matBottom, matCore, matEdge) {
  const skinT = t * 0.22;
  const coreT = t - 2 * skinT;
  const recess = 0.0008;

  const prep = (geom, matIdxList) => {
    const g = geom.index ? geom.toNonIndexed() : geom;
    g.clearGroups();
    const count = g.attributes.position.count;
    const perFace = count / 6;
    for (let f = 0; f < 6; f++) g.addGroup(f * perFace, perFace, matIdxList[f]);
    return g;
  };

  // Materials palette: [0: matTop, 1: matBottom, 2: matCore, 3: matEdge]
  const gTop = prep(new THREE.BoxGeometry(w, skinT, d).translate(0, t / 2 - skinT / 2, 0), [3, 3, 0, 2, 3, 3]);
  const gCore = prep(
    new THREE.BoxGeometry(Math.max(0.01, w - recess), coreT, Math.max(0.01, d - recess)),
    [2, 2, 2, 2, 2, 2],
  );
  const gBot = prep(new THREE.BoxGeometry(w, skinT, d).translate(0, -t / 2 + skinT / 2, 0), [3, 3, 2, 1, 3, 3]);

  // NOTE: mergeGeometries(..., false) drops groups, and a multi-material Mesh without groups renders NOTHING.
  // Concatenate the pieces manually and keep one group per face with its material index.
  const pieces = [gTop, gCore, gBot];
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const itemSize = gTop.attributes[name].itemSize;
    const total = pieces.reduce((n, g) => n + g.attributes[name].count, 0);
    const arr = new Float32Array(total * itemSize);
    let off = 0;
    for (const g of pieces) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  let start = 0;
  for (const g of pieces) {
    for (const grp of g.groups) merged.addGroup(start + grp.start, grp.count, grp.materialIndex);
    start += g.attributes.position.count;
  }
  const mats = [matTop, matBottom, matCore || matEdge, matEdge || matBottom];
  return shadows(new THREE.Mesh(merged, mats));
}

/**
 * Closed-edge corrugated steel sheet (C-76 profile). Ribs run along x (length), sinusoidal wave across z (width).
 * Stitches perimeter walls around all 4 boundaries so there are zero open gaps.
 */
export function corrugatedSheet({ length, width, pitch = 0.076, depth = 0.018, thickness = 0.0035, matTop, matBottom, matEdge, segPerPitch = 16 }) {
  const nz = Math.max(4, Math.round((width / pitch) * segPerPitch));
  const pos = [], uv = [], idx = [];
  const prof = (z) => (depth / 2) * Math.sin((2 * Math.PI * (z + width / 2)) / pitch);

  const addSurface = (dy, flip) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nz; i++) {
      const z = -width / 2 + (width * i) / nz;
      const y = prof(z) + dy;
      pos.push(-length / 2, y, z, length / 2, y, z);
      uv.push(0, i / nz, 1, i / nz);
    }
    for (let i = 0; i < nz; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (!flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    return nz * 6;
  };

  const addWallQuad = (p0, p1, p2, p3) => {
    const base = pos.length / 3;
    pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return 6;
  };

  const nTop = addSurface(thickness / 2, false);
  const nBot = addSurface(-thickness / 2, true);
  let nEdge = 0;
  const x0 = -length / 2, x1 = length / 2;
  for (let i = 0; i < nz; i++) {
    const za = -width / 2 + (width * i) / nz;
    const zb = -width / 2 + (width * (i + 1)) / nz;
    const yaT = prof(za) + thickness / 2, ybT = prof(zb) + thickness / 2;
    const yaB = prof(za) - thickness / 2, ybB = prof(zb) - thickness / 2;
    // West cut face (x = -length/2)
    nEdge += addWallQuad([x0, yaB, za], [x0, yaT, za], [x0, ybT, zb], [x0, ybB, zb]);
    // East cut face (x = +length/2)
    nEdge += addWallQuad([x1, yaB, za], [x1, ybB, zb], [x1, ybT, zb], [x1, yaT, za]);
  }
  const zMin = -width / 2, zMax = width / 2;
  const y0 = prof(zMin), y1 = prof(zMax);
  nEdge += addWallQuad([x0, y0 - thickness / 2, zMin], [x1, y0 - thickness / 2, zMin], [x1, y0 + thickness / 2, zMin], [x0, y0 + thickness / 2, zMin]);
  nEdge += addWallQuad([x0, y1 - thickness / 2, zMax], [x0, y1 + thickness / 2, zMax], [x1, y1 + thickness / 2, zMax], [x1, y1 - thickness / 2, zMax]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, nTop, 0);
  g.addGroup(nTop, nBot, 1);
  g.addGroup(nTop + nBot, nEdge, 2);
  g.computeVertexNormals();
  return shadows(new THREE.Mesh(g, [matTop, matBottom, matEdge || matBottom]));
}

/**
 * Watertight 3D woven webbing strap with real width & thickness plus calibrated UVs for edge lockstitching.
 */
export function thickWebbing(points, width, thickness, mat, side = v3(1, 0, 0)) {
  const P = points.map((p) => (Array.isArray(p) ? v3(...p) : p));
  const corners = [];
  const dists = [0];
  for (let i = 0; i < P.length; i++) {
    if (i > 0) dists[i] = dists[i - 1] + P[i].distanceTo(P[i - 1]);
    const t = new THREE.Vector3().subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]);
    if (t.lengthSq() < 1e-10) t.set(0, -1, 0); else t.normalize();
    const s = side.clone().addScaledVector(t, -side.dot(t));
    if (s.lengthSq() < 1e-10) s.set(1, 0, 0); else s.normalize();
    const n = new THREE.Vector3().crossVectors(t, s).normalize();
    const sw = s.multiplyScalar(width / 2);
    const nh = n.multiplyScalar(thickness / 2);
    corners.push([
      P[i].clone().sub(sw).add(nh), // A: outer left
      P[i].clone().add(sw).add(nh), // B: outer right
      P[i].clone().add(sw).sub(nh), // C: inner right
      P[i].clone().sub(sw).sub(nh), // D: inner left
    ]);
  }

  const pos = [];
  const uv = [];
  const pushTri = (p0, p1, p2, uv0, uv1, uv2) => {
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    uv.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
  };
  const pushQuad = (a, b, c, d, uva, uvb, uvc, uvd) => {
    pushTri(a, b, c, uva, uvb, uvc);
    pushTri(a, c, d, uva, uvc, uvd);
  };

  for (let i = 0; i < P.length - 1; i++) {
    const c0 = corners[i], c1 = corners[i + 1];
    const v0 = dists[i] / 0.05, v1 = dists[i + 1] / 0.05;
    // Outer wide face (A0-B0-B1-A1), normal +N
    pushQuad(c0[0], c0[1], c1[1], c1[0], [0, v0], [1, v0], [1, v1], [0, v1]);
    // Inner wide face (C0-D0-D1-C1), normal -N
    pushQuad(c0[2], c0[3], c1[3], c1[2], [1, v0], [0, v0], [0, v1], [1, v1]);
    // Left edge (D0-A0-A1-D1)
    pushQuad(c0[3], c0[0], c1[0], c1[3], [0, v0], [0.05, v0], [0.05, v1], [0, v1]);
    // Right edge (B0-C0-C1-B1)
    pushQuad(c0[1], c0[2], c1[2], c1[1], [0.95, v0], [1, v0], [1, v1], [0.95, v1]);
  }
  if (corners.length >= 2) {
    const first = corners[0], last = corners[corners.length - 1];
    pushQuad(first[0], first[3], first[2], first[1], [0, 0], [0, 0.1], [1, 0.1], [1, 0]);
    pushQuad(last[0], last[1], last[2], last[3], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return shadows(new THREE.Mesh(g, mat));
}

/** Flat ribbon (strap/webbing) following a polyline. Kept for backwards compatibility. */
export function ribbon(points, width, mat, side = v3(0, 0, 1)) {
  const P = points.map((p) => (Array.isArray(p) ? v3(...p) : p));
  const pos = [], idx = [];
  for (let i = 0; i < P.length; i++) {
    const t = new THREE.Vector3().subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]).normalize();
    const s = side.clone().addScaledVector(t, -side.dot(t)).normalize().multiplyScalar(width / 2);
    pos.push(P[i].x - s.x, P[i].y - s.y, P[i].z - s.z, P[i].x + s.x, P[i].y + s.y, P[i].z + s.z);
    if (i < P.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return shadows(new THREE.Mesh(g, mat));
}

/** Thin rope/cable/rod through points (tube). */
export function rope(points, radius, mat, tubularSegments = 32, radialSegments = 8) {
  const P = points.map((p) => (Array.isArray(p) ? v3(...p) : p));
  const curve = P.length === 2 ? new THREE.LineCurve3(P[0], P[1]) : new THREE.CatmullRomCurve3(P);
  return shadows(new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false), mat));
}

/** Right-angle scaffold coupler (직교 클램프) at pos. */
export function rightAngleClamp(pos, mat, boltMat) {
  const g = new THREE.Group();
  g.add(box(0.075, 0.03, 0.075, mat, 0, 0.018, 0));
  g.add(box(0.075, 0.03, 0.075, mat, 0, -0.018, 0));
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8), boltMat || mat);
  b1.rotation.z = Math.PI / 2; b1.position.set(0, 0.018, 0.045);
  const b2 = b1.clone(); b2.position.set(0, -0.018, -0.045);
  g.add(b1, b2);
  g.position.copy(Array.isArray(pos) ? v3(...pos) : pos);
  return shadows(g);
}

/** U-bolt wrapped around a bar whose axis is `axis` ('x' | 'z'), centred at pos, opening downward. */
export function uBolt(pos, { r = 0.03, leg = 0.08, rod = 0.005, axis = 'x', mat } = {}) {
  const g = new THREE.Group();
  const arc = new THREE.Mesh(new THREE.TorusGeometry(r, rod, 6, 16, Math.PI), mat);
  g.add(arc);
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(rod, rod, leg, 6), mat);
    l.position.set(sx * r, -leg / 2, 0);
    g.add(l);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(rod * 2.4, rod * 2.4, rod * 2.4, 6), mat);
    nut.position.set(sx * r, -leg + rod, 0);
    g.add(nut);
  }
  if (axis === 'x') g.rotation.y = Math.PI / 2;
  g.position.copy(Array.isArray(pos) ? v3(...pos) : pos);
  return shadows(g);
}

/** Hex bolt head + shank, pointing down from pos. */
export function bolt(pos, mat, { d = 0.01, len = 0.04 } = {}) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.95, d * 0.95, d * 0.6, 6), mat);
  head.position.y = d * 0.3;
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, len, 8), mat);
  shank.position.y = -len / 2;
  g.add(head, shank);
  g.position.copy(Array.isArray(pos) ? v3(...pos) : pos);
  return shadows(g);
}

/** Dispose all geometries/materials created for an object tree (materials in `keep` are shared and kept). */
export function disposeTree(obj, keep = new Set()) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) if (!keep.has(m)) m.dispose?.();
  });
}
