// parts.js — small geometry helpers shared by the container and design builders.
// Everything here is plain three.js and runs in Node (no DOM).
import * as THREE from 'three';

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

/** Square/rectangular hollow-looking tube (rendered solid) between two points. */
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
 * Flat panel with different top/bottom materials (e.g. matte-white top, silver-foil bottom).
 * Size: w along x, d along z, thickness t along y. Centred at origin.
 * BoxGeometry material order: +x, -x, +y, -y, +z, -z.
 */
export function twoFacePanel(w, d, t, matTop, matBottom, matEdge) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), [matEdge, matEdge, matTop, matBottom, matEdge, matEdge]);
  return shadows(m);
}

/**
 * Corrugated sheet (골판). Ribs run along x (length). Profile varies across z (width).
 * Centred at origin, mid-plane at y = 0. Top surface uses matTop, bottom uses matBottom.
 * Visual thickness is exaggerated (default 4 mm) so both faces render without z-fighting.
 */
export function corrugatedSheet({ length, width, pitch = 0.076, depth = 0.018, thickness = 0.004, matTop, matBottom, segPerPitch = 8 }) {
  const nz = Math.max(2, Math.round((width / pitch) * segPerPitch));
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
  const nTop = addSurface(thickness / 2, false);
  const nBot = addSurface(-thickness / 2, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, nTop, 0);
  g.addGroup(nTop, nBot, 1);
  g.computeVertexNormals();
  return shadows(new THREE.Mesh(g, [matTop, matBottom]));
}

/**
 * Flat ribbon (strap/webbing) following a polyline.
 * side: a vector roughly along the strap's width direction (made orthogonal to the path).
 */
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

/** Thin rope/cable through points (tube). */
export function rope(points, radius, mat, tubularSegments = 32) {
  const P = points.map((p) => (Array.isArray(p) ? v3(...p) : p));
  const curve = P.length === 2 ? new THREE.LineCurve3(P[0], P[1]) : new THREE.CatmullRomCurve3(P);
  return shadows(new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, radius, 6, false), mat));
}

/** Right-angle scaffold coupler (직교 클램프) at pos: two half-shells + bolts. Decorative. */
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

/**
 * U-bolt wrapped around a bar whose axis is `axis` ('x' | 'z'), centred at pos, opening downward.
 * r = inner radius of the U, leg = leg length below the centre.
 */
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
