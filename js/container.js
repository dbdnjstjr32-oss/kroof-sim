// container.js — the 3×6 m construction-site container rest room (컨테이너 휴게실).
//
// Built in container-local coordinates (origin = footprint centre at ground level, +x East, +y Up,
// +z South) and honours every dimension in CONTAINER, because the design builders attach to those
// coordinates without importing this file. Nothing sticks above y = 2.62 except the lifting rings.
//
// Static parts are merged per material (one draw call per material) to keep 6 units cheap.
// Faces that a section clipping plane can expose use DoubleSide "cut" materials, so walls, floor,
// ceiling, insulation and the east/west frame tubes read as solid when cut at z = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONTAINER as C } from './config.js';
import { shadows } from './parts.js';

const hasDOM = typeof document !== 'undefined';
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- derived dimensions
const HX = C.L / 2;                 // 3.0  outer half length (x)
const HZ = C.W / 2;                 // 1.5  outer half width (z)
const POST = C.cornerPost;          // 0.15 corner post section
const TUBE = C.frameTube;           // 100×100 perimeter top tube
const BASE_H = 0.10;                // base channel height = finished floor = door sill
const RIB = 0.010;                  // rib protrusion; rib tops are flush with the frame line
const RIB_W = 0.03;                 // rib width
const WALL_T = 0.05;                // sandwich panel thickness
const WALL_OUT_X = HX - RIB, WALL_IN_X = WALL_OUT_X - WALL_T;   // 2.99 / 2.94
const WALL_OUT_Z = HZ - RIB, WALL_IN_Z = WALL_OUT_Z - WALL_T;   // 1.49 / 1.44
const ROOF_T = 0.005;               // drawn roof plate thickness (real: 1.2 mm)
const INS_T = 0.05;                 // insulation under the roof plate
const CEIL_Y = 2.40, CEIL_T = 0.02; // interior ceiling panel (underside at 2.40)

// Outward-facing wall faces: `axis` is the wall normal axis, `s` its sign.
const FACE = { south: { axis: 'z', s: 1 }, north: { axis: 'z', s: -1 }, east: { axis: 'x', s: 1 }, west: { axis: 'x', s: -1 } };

// ---------------------------------------------------------------- local materials (shared per `mats`)
const LOCAL = new WeakMap();
const MAT_LABEL = new WeakMap();    // shared palette material → its key in `mats` (for mesh names)

function signTexture() {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#1d4f91'; g.fillRect(0, 0, 512, 192);
  g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(14, 14, 484, 164);
  g.fillStyle = '#ffffff';
  g.font = 'bold 112px "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('휴게실', 256, 102);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function localMaterials(mats) {
  let m = LOCAL.get(mats);
  if (m) return m;
  for (const [k, v] of Object.entries(mats)) if (v && v.isMaterial) MAT_LABEL.set(v, k);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const DS = THREE.DoubleSide;
  const map = signTexture();
  m = {
    core: std({ name: 'panelCore', color: 0xe8e3d6, roughness: 0.95, side: DS }),         // EPS core / cut faces
    steelCut: std({ name: 'steelCut', color: 0x6e747b, roughness: 0.5, metalness: 0.5, side: DS }),
    insulation: std({ name: 'insulation', color: 0xe2c25c, roughness: 1, side: DS }),      // glass wool 50 mm
    ceiling: std({ name: 'ceiling', color: 0xf2f0ea, roughness: 0.9 }),
    vinyl: std({ name: 'floorVinyl', color: 0x7f8a80, roughness: 0.65 }),
    plywood: std({ name: 'plywood', color: 0xa98457, roughness: 0.9, side: DS }),
    appliance: std({ name: 'appliance', color: 0xeceeed, roughness: 0.45, metalness: 0.1 }),
    pipeWrap: std({ name: 'pipeWrap', color: 0xe9e7df, roughness: 0.8 }),
    copper: std({ name: 'copper', color: 0xb8733d, roughness: 0.35, metalness: 0.9 }),
    dark: std({ name: 'darkPlastic', color: 0x24272c, roughness: 0.7, metalness: 0.2 }),
    panelGrey: std({ name: 'panelGrey', color: 0xaeb3b7, roughness: 0.55, metalness: 0.35 }),
    warn: std({ name: 'warnYellow', color: 0xf2c200, roughness: 0.6 }),
    sign: std({ name: 'sign', color: map ? 0xffffff : 0x1d4f91, map, roughness: 0.6 }),
    laminate: std({ name: 'laminate', color: 0xd9cfbd, roughness: 0.6, side: DS }),
    wood: std({ name: 'benchWood', color: 0xb58450, roughness: 0.75 }),
    bottle: std({ name: 'bottle', color: 0x78b6e6, roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false }),
    red: std({ name: 'red', color: 0xc9302c, roughness: 0.45, metalness: 0.1 }),
    blue: std({ name: 'blue', color: 0x2f6fd6, roughness: 0.45 }),
    lamp: std({ name: 'lamp', color: 0xffffff, emissive: 0xf5f8ff, emissiveIntensity: 1.6, roughness: 0.4 }),
    led: std({ name: 'led', color: 0x1b8fd6, emissive: 0x39c6ff, emissiveIntensity: 2 }),
  };
  LOCAL.set(mats, m);
  return m;
}

// ---------------------------------------------------------------- geometry helpers
/** Box geometry spanning [x0,x1]×[y0,y1]×[z0,z1]. BoxGeometry face order: +x −x +y −y +z −z. */
const boxG = (x0, y0, z0, x1, y1, z1) =>
  new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

/** Per-face material list for a box whose two faces normal to `axis` are section/cut faces. */
const capAxis = (axis, main, cap) =>
  axis === 'x' ? [cap, cap, main, main, main, main]
    : axis === 'y' ? [main, main, cap, cap, main, main]
      : [main, main, main, main, cap, cap];

/** Box on a wall face: u = along-wall coordinate (x for N/S, z for E/W), o = outward distance from centre. */
function faceBox(face, u0, u1, y0, y1, o0, o1) {
  const { axis, s } = FACE[face];
  const a = s * o0, b = s * o1, lo = Math.min(a, b), hi = Math.max(a, b);
  return axis === 'z' ? boxG(u0, y0, lo, u1, y1, hi) : boxG(lo, y0, u0, hi, y1, u1);
}

const _q = new THREE.Quaternion();
/** Geometry `geo` (built along +y, centred) stretched between points a and b. */
function alongG(geo, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  geo.applyQuaternion(_q.setFromUnitVectors(UP, dir.clone().normalize()));
  return geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const beamG = (a, b, w, d = w) => alongG(new THREE.BoxGeometry(w, a.distanceTo(b), d), a, b);
const cylG = (a, b, r, seg = 12) => alongG(new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg), a, b);

/** Round pipe through a polyline with rounded bends of radius `bend`. */
function bentPipeG(pts, r, bend = 0.05, radial = 8) {
  const path = new THREE.CurvePath();
  let prev = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const rb = Math.min(bend, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
    const p0 = b.clone().addScaledVector(b.clone().sub(a).normalize(), -rb);
    const p1 = b.clone().addScaledVector(c.clone().sub(b).normalize(), rb);
    if (prev.distanceTo(p0) > 1e-5) path.add(new THREE.LineCurve3(prev, p0));
    path.add(new THREE.QuadraticBezierCurve3(p0, b.clone(), p1));
    prev = p1;
  }
  path.add(new THREE.LineCurve3(prev, pts[pts.length - 1].clone()));
  const segs = Math.max(16, Math.round(path.getLength() / 0.03));
  return new THREE.TubeGeometry(path, segs, r, radial, false);
}

/**
 * Collects geometries per material and emits one merged mesh per material.
 * `mat` may be an array indexed by the geometry's groups (e.g. per-face box materials);
 * a null entry drops that face.
 */
class Batch {
  constructor() { this.parts = new Map(); }

  add(geo, mat) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count;
    if (!Array.isArray(mat)) this._push(mat, g, 0, n);
    else if (!g.groups.length) this._push(mat[0], g, 0, n);
    else for (const grp of g.groups) this._push(mat[grp.materialIndex], g, grp.start, Math.min(grp.count, n - grp.start));
    return this;
  }

  _push(mat, g, start, count) {
    if (!mat || count <= 0) return;
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = g.attributes[name];
      out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
    }
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(out);
  }

  /** Adds one merged mesh per material to `parent`. Returns the meshes. */
  build(parent, name, { castShadow = true } = {}) {
    const meshes = [];
    for (const [mat, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.name = `${name}:${mat.name || MAT_LABEL.get(mat) || 'mat'}`;
      shadows(mesh, castShadow, true);
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

// ---------------------------------------------------------------- walls
/** Openings (door/window rectangles) that belong to a wall face, in that face's (u, y) coordinates. */
function openingsOf(face) {
  const list = C.windows.filter((w) => w.face === face);
  if (C.door.face === face) list.push(C.door);
  return list;
}

/** Wall span (u range between the corner posts) for a face. */
const wallSpan = (face) => (FACE[face].axis === 'z' ? [-(HX - POST), HX - POST] : [-(HZ - POST), HZ - POST]);

/**
 * 50 mm sandwich wall with openings, as an extrusion. Openings that start at the wall bottom
 * (doors) become notches in the outline; the others become holes.
 */
function wallGeo(face) {
  const [u0, u1] = wallSpan(face);
  const y0 = BASE_H, y1 = C.wallTopY;
  const ops = openingsOf(face);
  // East/west faces use u = z; the west extrusion mirrors u (see matrix below) — no openings there.
  const shape = new THREE.Shape();
  shape.moveTo(u0, y0);
  for (const d of ops.filter((o) => o.y0 <= y0 + 1e-6).sort((a, b) => a.x0 - b.x0)) {
    shape.lineTo(d.x0, y0); shape.lineTo(d.x0, d.y1); shape.lineTo(d.x1, d.y1); shape.lineTo(d.x1, y0);
  }
  shape.lineTo(u1, y0); shape.lineTo(u1, y1); shape.lineTo(u0, y1); shape.lineTo(u0, y0);
  for (const w of ops.filter((o) => o.y0 > y0 + 1e-6)) {
    const h = new THREE.Path();
    h.moveTo(w.x0, w.y0); h.lineTo(w.x1, w.y0); h.lineTo(w.x1, w.y1); h.lineTo(w.x0, w.y1); h.lineTo(w.x0, w.y0);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false, curveSegments: 1 });
  // Local (u, y, w ∈ [0, WALL_T]) → container-local.
  const m = new THREE.Matrix4();
  if (face === 'south') m.makeTranslation(0, 0, WALL_IN_Z);                         // z ∈ [1.44, 1.49]
  else if (face === 'north') m.makeTranslation(0, 0, -WALL_OUT_Z);                  // z ∈ [−1.49, −1.44]
  else if (face === 'east') m.makeRotationY(-Math.PI / 2).setPosition(WALL_OUT_X, 0, 0);  // x = 2.99 − w, z = u
  else m.makeRotationY(Math.PI / 2).setPosition(-WALL_OUT_X, 0, 0);                  // x = −2.99 + w, z = −u
  return g.applyMatrix4(m);
}

/** Vertical rib segments on a face, skipping openings (with frame margin). → [{u, y0, y1}] */
function ribLayout(face) {
  const [u0, u1] = wallSpan(face);
  const pitch = 0.2, edge = 0.08, margin = 0.07;
  const n = Math.floor((u1 - u0 - 2 * edge) / pitch) + 1;
  const start = (u0 + u1) / 2 - ((n - 1) * pitch) / 2;
  const ops = openingsOf(face);
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = start + i * pitch;
    let spans = [[BASE_H + 0.03, C.wallTopY - 0.02]];
    for (const o of ops) {
      if (u + RIB_W / 2 < o.x0 - margin || u - RIB_W / 2 > o.x1 + margin) continue;
      const c0 = o.y0 - margin, c1 = o.y1 + margin;
      spans = spans.flatMap(([a, b]) => [[a, Math.min(b, c0)], [Math.max(a, c1), b]]).filter(([a, b]) => b - a > 0.05);
    }
    for (const [a, b] of spans) out.push({ u, y0: a, y1: b });
  }
  return out;
}

function buildRibs(mat) {
  const faces = ['south', 'north', 'east', 'west'];
  const layout = faces.flatMap((f) => ribLayout(f).map((r) => ({ ...r, face: f })));
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, layout.length);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
  layout.forEach((r, i) => {
    const { axis, s: sg } = FACE[r.face];
    const o = sg * (axis === 'z' ? WALL_OUT_Z : WALL_OUT_X) + (sg * RIB) / 2;
    const h = r.y1 - r.y0, yc = (r.y0 + r.y1) / 2;
    if (axis === 'z') { p.set(r.u, yc, o); s.set(RIB_W, h, RIB); } else { p.set(o, yc, r.u); s.set(RIB, h, RIB_W); }
    mesh.setMatrixAt(i, m.compose(p, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'wallRibs';
  return shadows(mesh);
}

// ---------------------------------------------------------------- shell: frame, walls, roof build-up
function addShell(b, mats, L) {
  const frame = mats.containerFrame;

  // Base channel (C-section, web outside, flanges pointing in) between the corner posts.
  const tw = 0.008, fl = 0.047;
  for (const sz of [-1, 1]) {           // north / south
    const zw0 = sz * (HZ - tw), zw1 = sz * HZ, zf = sz * (HZ - tw - fl);
    const x0 = -(HX - POST), x1 = HX - POST;
    b.add(boxG(x0, 0, Math.min(zw0, zw1), x1, BASE_H, Math.max(zw0, zw1)), capAxis('x', frame, L.steelCut));
    for (const [y0, y1] of [[0, tw], [BASE_H - tw, BASE_H]]) {
      b.add(boxG(x0, y0, Math.min(zf, zw0), x1, y1, Math.max(zf, zw0)), capAxis('x', frame, L.steelCut));
    }
  }
  for (const sx of [-1, 1]) {           // west / east (cut by a z = 0 section)
    const xw0 = sx * (HX - tw), xw1 = sx * HX, xf = sx * (HX - tw - fl);
    const z0 = -(HZ - POST), z1 = HZ - POST;
    b.add(boxG(Math.min(xw0, xw1), 0, z0, Math.max(xw0, xw1), BASE_H, z1), capAxis('z', frame, L.steelCut));
    for (const [y0, y1] of [[0, tw], [BASE_H - tw, BASE_H]]) {
      b.add(boxG(Math.min(xf, xw0), y0, z0, Math.max(xf, xw0), y1, z1), capAxis('z', frame, L.steelCut));
    }
  }

  // Corner posts 150×150 from the ground to the underside of the top tube.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const xa = sx * (HX - POST), xb = sx * HX, za = sz * (HZ - POST), zb = sz * HZ;
    b.add(boxG(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), C.wallTopY, Math.max(za, zb)), frame);
  }

  // Sandwich walls (outer/inner skins ivory, cut edges show the core).
  for (const f of ['south', 'north', 'east', 'west']) b.add(wallGeo(f), [mats.containerWall, L.core]);

  // Perimeter top tube 100×100: long sides solid, short (E/W) sides hollow so a z = 0 cut shows the section.
  const ty0 = TUBE.bottomY, ty1 = TUBE.topY, t = 0.005;
  for (const sz of [-1, 1]) {
    const za = sz * TUBE.innerZ, zb = sz * HZ;
    b.add(boxG(-HX, ty0, Math.min(za, zb), HX, ty1, Math.max(za, zb)), frame);
  }
  for (const sx of [-1, 1]) {
    const xi = sx * TUBE.innerX, xo = sx * HX, lo = Math.min(xi, xo), hi = Math.max(xi, xo);
    const z0 = -TUBE.innerZ, z1 = TUBE.innerZ, cut = capAxis('z', frame, L.steelCut);
    b.add(boxG(lo, ty1 - t, z0, hi, ty1, z1), cut);                                 // top plate
    b.add(boxG(lo, ty0, z0, hi, ty0 + t, z1), cut);                                 // bottom plate
    b.add(boxG(hi - t, ty0 + t, z0, hi, ty1 - t, z1), cut);                         // +x plate
    b.add(boxG(lo, ty0 + t, z0, lo + t, ty1 - t, z1), cut);                         // −x plate
  }

  // Insulation (glass wool) directly under the roof plate.
  const rr = C.roofRect;
  b.add(boxG(rr.x0, C.roofY - ROOF_T - INS_T, rr.z0, rr.x1, C.roofY - ROOF_T, rr.z1), L.insulation);

  // Roof bows (40×40) under the insulation, spanning the width between the long tubes.
  for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) {
    const y1 = C.roofY - ROOF_T - INS_T;
    b.add(boxG(x - 0.02, y1 - 0.04, rr.z0, x + 0.02, y1, rr.z1), capAxis('z', frame, L.steelCut));
  }

  // Interior ceiling panel (white underside) and floor deck (vinyl on plywood).
  b.add(boxG(-WALL_IN_X, CEIL_Y, -WALL_IN_Z, WALL_IN_X, CEIL_Y + CEIL_T, WALL_IN_Z),
    [L.core, L.core, L.core, L.ceiling, L.core, L.core]);
  b.add(boxG(-WALL_IN_X, 0.02, -WALL_IN_Z, WALL_IN_X, BASE_H, WALL_IN_Z),
    [L.plywood, L.plywood, L.vinyl, L.plywood, L.plywood, L.plywood]);
}

// ---------------------------------------------------------------- lifting rings (인양고리)
function addLiftingRings(b, mats) {
  const torus = () => new THREE.TorusGeometry(C.ringR, C.ringBarR, 10, 28);
  const m = new THREE.Matrix4();
  for (const r of C.liftingRings) {
    const sx = Math.sign(r.x), sz = Math.sign(r.z);
    // Base pad welded on the tube corner (axis-aligned so it stays on the tube).
    b.add(boxG(r.x - 0.03, C.ringBaseY, r.z - 0.03, r.x + 0.03, C.ringBaseY + 0.012, r.z + 0.03), mats.containerFrame);
    // Ring plane turned 45° so its hole faces diagonally outward (normal ∥ (sx, 0, sz)).
    m.makeRotationY(Math.atan2(sx, sz)).setPosition(r.x, 0, r.z);
    // Keeper lug: thin across the ring's tangent; the ring's lower bar passes through it.
    b.add(boxG(-0.006, C.ringBaseY + 0.012, -0.022, 0.006, C.ringBaseY + 0.042, 0.022).applyMatrix4(m), mats.liftingRing);
    b.add(torus().translate(0, C.ringCenterY, 0).applyMatrix4(m), mats.liftingRing);
  }
}

// ---------------------------------------------------------------- door, windows, sign, stair
// Door, sign and stair are laid out for the south face (CONTAINER.door.face); windows use faceBox on any long face.
function addDoor(b, glass, mats, L) {
  const d = C.door, f = d.face;
  const O0 = WALL_IN_Z - 0.005, O1 = HZ + 0.005;         // frame depth (in → just proud of the ribs)
  const jw = 0.04;
  // Steel frame + aluminium threshold.
  b.add(faceBox(f, d.x0, d.x0 + jw, d.y0, d.y1, O0, O1), mats.containerTrim);
  b.add(faceBox(f, d.x1 - jw, d.x1, d.y0, d.y1, O0, O1), mats.containerTrim);
  b.add(faceBox(f, d.x0 + jw, d.x1 - jw, d.y1 - jw, d.y1, O0, O1), mats.containerTrim);
  b.add(faceBox(f, d.x0, d.x1, d.y0, d.y0 + 0.008, O0, O1), mats.aluminum);

  // Leaf (40 mm) with a vision window hole; hinges on the east edge, handle on the west edge.
  const lx0 = d.x0 + jw + 0.005, lx1 = d.x1 - jw - 0.005, ly0 = d.y0 + 0.01, ly1 = d.y1 - jw - 0.005;
  const vx0 = (lx0 + lx1) / 2 - 0.13, vx1 = vx0 + 0.26, vy0 = 1.40, vy1 = 1.85;
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const leaf = new THREE.Shape([V2(lx0, ly0), V2(lx1, ly0), V2(lx1, ly1), V2(lx0, ly1)]);
  leaf.holes.push(new THREE.Path([V2(vx0, vy0), V2(vx0, vy1), V2(vx1, vy1), V2(vx1, vy0)]));
  const leafT = 0.035, leafIn = WALL_IN_Z + 0.015;          // leaf spans o ∈ [1.455, 1.49]
  b.add(new THREE.ExtrudeGeometry(leaf, { depth: leafT, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, leafIn), mats.door);
  const leafOut = leafIn + leafT;
  glass.add(faceBox(f, vx0, vx1, vy0, vy1, leafIn + leafT / 2 - 0.0025, leafIn + leafT / 2 + 0.0025), mats.glass);
  // Vision window trim, kick plate.
  const tw = 0.02;
  b.add(faceBox(f, vx0 - tw, vx1 + tw, vy0 - tw, vy0, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, vx0 - tw, vx1 + tw, vy1, vy1 + tw, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, vx0 - tw, vx0, vy0, vy1, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, vx1, vx1 + tw, vy0, vy1, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, lx0 + 0.02, lx1 - 0.02, ly0 + 0.01, ly0 + 0.21, leafOut, leafOut + 0.0035), mats.aluminum);

  // Lever handles (outside + inside), key cylinder, three hinges.
  const hx = lx0 + 0.085, hy = 1.02;
  for (const side of [1, -1]) {
    const base = side > 0 ? leafOut : leafIn;
    b.add(cylG(V(hx, hy, base), V(hx, hy, base + side * 0.012), 0.028, 16), mats.zinc);
    b.add(cylG(V(hx, hy, base + side * 0.012), V(hx, hy, base + side * 0.032), 0.009, 10), mats.zinc);
    const zl = base + side * 0.032;
    b.add(boxG(hx - 0.01, hy - 0.009, Math.min(zl, zl + side * 0.018), hx + 0.12, hy + 0.009, Math.max(zl, zl + side * 0.018)), mats.zinc);
  }
  b.add(cylG(V(hx, 0.93, leafOut), V(hx, 0.93, leafOut + 0.008), 0.014, 12), mats.zinc);
  for (const y of [0.30, 1.08, 1.86]) b.add(cylG(V(lx1 + 0.01, y - 0.05, leafOut + 0.006), V(lx1 + 0.01, y + 0.05, leafOut + 0.006), 0.011, 10), mats.zinc);
}

function addWindow(b, glass, mats, w) {
  const f = w.face, fw = 0.045, sw = 0.035, xm = (w.x0 + w.x1) / 2;
  const O0 = WALL_IN_Z - 0.005, O1 = HZ + 0.002;
  // Outer aluminium frame covering the wall reveal.
  b.add(faceBox(f, w.x0, w.x0 + fw, w.y0, w.y1, O0, O1), mats.aluminum);
  b.add(faceBox(f, w.x1 - fw, w.x1, w.y0, w.y1, O0, O1), mats.aluminum);
  b.add(faceBox(f, w.x0 + fw, w.x1 - fw, w.y0, w.y0 + fw, O0, O1), mats.aluminum);
  b.add(faceBox(f, w.x0 + fw, w.x1 - fw, w.y1 - fw, w.y1, O0, O1), mats.aluminum);
  // Two sliding sashes on separate tracks, overlapping at the middle.
  const ys0 = w.y0 + fw, ys1 = w.y1 - fw;
  const sashes = [
    { u0: w.x0 + fw, u1: xm + 0.02, o0: 1.476, o1: 1.496 },
    { u0: xm - 0.02, u1: w.x1 - fw, o0: 1.452, o1: 1.472 },
  ];
  for (const s of sashes) {
    b.add(faceBox(f, s.u0, s.u0 + sw, ys0, ys1, s.o0, s.o1), mats.aluminumAnod);
    b.add(faceBox(f, s.u1 - sw, s.u1, ys0, ys1, s.o0, s.o1), mats.aluminumAnod);
    b.add(faceBox(f, s.u0 + sw, s.u1 - sw, ys0, ys0 + sw, s.o0, s.o1), mats.aluminumAnod);
    b.add(faceBox(f, s.u0 + sw, s.u1 - sw, ys1 - sw, ys1, s.o0, s.o1), mats.aluminumAnod);
    const oc = (s.o0 + s.o1) / 2;
    glass.add(faceBox(f, s.u0 + sw, s.u1 - sw, ys0 + sw, ys1 - sw, oc - 0.0025, oc + 0.0025), mats.glass);
  }
  // Drip sill below the window.
  b.add(faceBox(f, w.x0 - 0.04, w.x1 + 0.04, w.y0 - 0.025, w.y0, WALL_OUT_Z, HZ + 0.04), mats.aluminum);
}

function addSignAndStair(b, group, mats, L) {
  const d = C.door, xc = (d.x0 + d.x1) / 2;
  // Sign plate "휴게실" above the door (front face carries the canvas texture when a DOM exists).
  b.add(faceBox(d.face, xc - 0.32, xc + 0.32, 2.18, 2.44, HZ, HZ + 0.012), mats.containerTrim);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.60, 0.225), L.sign);
  face.position.set(xc, 2.31, HZ + 0.0125);
  face.name = 'signFace';
  group.add(shadows(face, false, true));

  // Two-step steel stair: stepped side stringers + checker-plate treads (upper tread = door sill level).
  const z0 = HZ + 0.005, zMid = 1.87, z1 = 2.13, sx0 = d.x0 - 0.10, sx1 = d.x1 + 0.10, pt = 0.008;
  const prof = new THREE.Shape([[z0, 0], [z1, 0], [z1, 0.047], [zMid, 0.047], [zMid, 0.094], [z0, 0.094]].map(([u, v]) => new THREE.Vector2(u, v)));
  const m = new THREE.Matrix4();
  for (const xr of [sx0 + pt, sx1]) {
    // local (u, y, w) → x = xr − w, z = u
    b.add(new THREE.ExtrudeGeometry(prof, { depth: pt, bevelEnabled: false }).applyMatrix4(m.makeRotationY(-Math.PI / 2).setPosition(xr, 0, 0)), mats.steelGalv);
  }
  b.add(boxG(sx0 + pt, 0.094, z0, sx1 - pt, BASE_H, zMid), mats.steelGalv);
  b.add(boxG(sx0 + pt, 0.047, zMid, sx1 - pt, 0.053, z1), mats.steelGalv);
}

// ---------------------------------------------------------------- outdoor AC condenser + electrical box (east wall)
function addEastWallEquipment(b, mats, L) {
  const zc = C.acUnit.z;                               // −0.5
  const x0 = HX + 0.06, x1 = HX + 0.31, y0 = 0.62, y1 = 1.16, z0 = zc - 0.39, z1 = zc + 0.39;
  b.add(boxG(x0, y0, z0, x1, y1, z1), L.appliance);

  // Wall brackets: arm, wall plate, diagonal strut; rubber pads under the unit.
  for (const zb of [zc - 0.28, zc + 0.28]) {
    b.add(boxG(HX, 0.56, zb - 0.02, HX + 0.36, 0.60, zb + 0.02), mats.steelGalv);
    b.add(boxG(HX, 0.25, zb - 0.03, HX + 0.008, 0.60, zb + 0.03), mats.steelGalv);
    b.add(beamG(V(HX + 0.01, 0.29, zb), V(HX + 0.33, 0.575, zb), 0.03), mats.steelGalv);
    b.add(boxG(x0 + 0.02, 0.60, zb - 0.03, x1 - 0.02, y0, zb + 0.03), mats.rubber);
  }

  // Fan side: dark opening, bezel, grille rings and bars (the blades are a separate animated mesh).
  const fy = (y0 + y1) / 2, fz = zc - 0.12, fr = 0.2;
  b.add(new THREE.CircleGeometry(fr + 0.005, 28).rotateY(Math.PI / 2).translate(x1 + 0.0015, fy, fz), L.dark);
  b.add(new THREE.TorusGeometry(fr + 0.012, 0.008, 6, 32).rotateY(Math.PI / 2).translate(x1 + 0.002, fy, fz), L.appliance);
  for (const r of [0.07, 0.13, 0.19]) b.add(new THREE.TorusGeometry(r, 0.0035, 4, 32).rotateY(Math.PI / 2).translate(x1 + 0.025, fy, fz), mats.containerTrim);
  b.add(boxG(x1 + 0.022, fy - 0.005, fz - fr, x1 + 0.028, fy + 0.005, fz + fr), mats.containerTrim);
  b.add(boxG(x1 + 0.022, fy - fr, fz - 0.005, x1 + 0.028, fy + fr, fz + 0.005), mats.containerTrim);
  b.add(cylG(V(x1 + 0.02, fy, fz), V(x1 + 0.03, fy, fz), 0.03, 12), mats.containerTrim);

  // Coil side: horizontal louvres.
  for (let i = 0; i < 9; i++) {
    const y = y0 + 0.07 + i * 0.047;
    b.add(boxG(x1, y, zc + 0.12, x1 + 0.008, y + 0.012, z1 - 0.04), mats.containerTrim);
  }

  // Service valves on the south side, insulated refrigerant pipes + drain hose into the wall.
  b.add(boxG(x0 + 0.02, 0.68, z1, x0 + 0.14, 0.86, z1 + 0.015), L.appliance);
  const ya = 0.74, zs = z1 + 0.015;
  const pa = V(x0 + 0.055, ya, zs), pb = V(x0 + 0.105, ya, zs);
  b.add(cylG(pa, V(pa.x, ya, zs + 0.025), 0.008, 8), L.copper);
  b.add(cylG(pb, V(pb.x, ya, zs + 0.025), 0.006, 8), L.copper);
  const xr = HX + 0.035, yIn = 1.93;
  b.add(bentPipeG([V(pa.x, ya, zs + 0.02), V(pa.x, ya, zc + 0.47), V(xr, ya, zc + 0.47), V(xr, yIn, zc + 0.47), V(WALL_OUT_X, yIn, zc + 0.47)], 0.013), L.pipeWrap);
  b.add(bentPipeG([V(pb.x, ya, zs + 0.02), V(pb.x, ya, zc + 0.505), V(xr, ya, zc + 0.505), V(xr, yIn, zc + 0.505), V(WALL_OUT_X, yIn, zc + 0.505)], 0.010), L.pipeWrap);
  b.add(bentPipeG([V(WALL_OUT_X, yIn - 0.025, zc + 0.54), V(HX + 0.06, yIn - 0.025, zc + 0.54), V(HX + 0.06, 0.06, zc + 0.54), V(HX + 0.20, 0.02, zc + 0.54)], 0.008, 0.08), mats.rubber);
  b.add(cylG(V(HX, yIn - 0.01, zc + 0.495), V(HX + 0.012, yIn - 0.01, zc + 0.495), 0.058, 20), L.appliance);   // wall sleeve cap

  // Electrical box (분전함) with warning label and a conduit down to the ground.
  const ez = 0.72;
  b.add(boxG(HX, 1.28, ez - 0.2, HX + 0.13, 1.70, ez + 0.2), L.panelGrey);
  b.add(boxG(HX + 0.13, 1.30, ez - 0.18, HX + 0.134, 1.68, ez - 0.17), mats.containerTrim);   // door hinge line
  b.add(new THREE.BoxGeometry(0.002, 0.07, 0.07).rotateX(Math.PI / 4).translate(HX + 0.131, 1.60, ez), L.warn);
  b.add(cylG(V(HX + 0.065, 1.28, ez), V(HX + 0.065, -0.02, ez), 0.013, 10), mats.steelDark);
}

/** Condenser fan blades (animated about +x). */
function buildFan(L) {
  const parts = [new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14).rotateZ(Math.PI / 2)];
  for (let i = 0; i < 3; i++) {
    parts.push(new THREE.BoxGeometry(0.006, 0.15, 0.075).translate(0, 0.105, 0).rotateY(0.35).rotateX((i * 2 * Math.PI) / 3));
  }
  const fan = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), L.dark);
  fan.name = 'acFan';
  fan.position.set(HX + 0.31 + 0.011, (0.62 + 1.16) / 2, C.acUnit.z - 0.12);
  return shadows(fan);
}

// ---------------------------------------------------------------- interior furniture
function buildInterior(mats, L) {
  const interior = new THREE.Group();
  interior.name = 'interior';
  const b = new Batch();
  const fy = BASE_H;
  const steel = mats.steelDark;

  // Table 1.2 × 0.72 (top at 0.82 m).
  const tx0 = -1.62, tx1 = -0.42, tz = 0.36, ty = 0.82;
  b.add(boxG(tx0, ty - 0.025, -tz, tx1, ty, tz), L.laminate);
  for (const x of [tx0 + 0.05, tx1 - 0.05]) for (const z of [-tz + 0.05, tz - 0.05]) b.add(boxG(x - 0.0175, fy, z - 0.0175, x + 0.0175, ty - 0.025, z + 0.0175), steel);
  for (const z of [-tz + 0.05, tz - 0.05]) b.add(boxG(tx0 + 0.05, 0.24, z - 0.0125, tx1 - 0.05, 0.265, z + 0.0125), steel);

  // Two benches along the table.
  for (const zc of [-0.66, 0.66]) {
    b.add(boxG(-1.72, 0.44, zc - 0.15, -0.32, 0.475, zc + 0.15), L.wood);
    for (const x of [-1.62, -0.42]) {
      for (const dz of [-0.1, 0.1]) b.add(boxG(x - 0.015, fy, zc + dz - 0.015, x + 0.015, 0.44, zc + dz + 0.015), steel);
      b.add(boxG(x - 0.015, fy, zc - 0.13, x + 0.015, fy + 0.025, zc + 0.13), steel);
    }
  }

  // Water dispenser (NW corner, facing +x) with a translucent bottle.
  const dx0 = -2.90, dx1 = -2.58, dz0 = -1.30, dz1 = -0.98, dxc = (dx0 + dx1) / 2, dzc = (dz0 + dz1) / 2;
  b.add(boxG(dx0, fy, dz0, dx1, 1.06, dz1), L.appliance);
  b.add(boxG(dx1, 0.62, dz0 + 0.06, dx1 + 0.005, 0.86, dz1 - 0.06), L.dark);
  b.add(boxG(dx1 + 0.005, 0.79, dzc - 0.075, dx1 + 0.03, 0.82, dzc - 0.035), L.red);
  b.add(boxG(dx1 + 0.005, 0.79, dzc + 0.035, dx1 + 0.03, 0.82, dzc + 0.075), L.blue);
  b.add(boxG(dx1 + 0.005, 0.62, dzc - 0.08, dx1 + 0.04, 0.635, dzc + 0.08), steel);
  const bottle = [
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).translate(0, 1.075, 0),
    new THREE.CylinderGeometry(0.135, 0.05, 0.05, 20).translate(0, 1.115, 0),
    new THREE.CylinderGeometry(0.135, 0.135, 0.28, 20).translate(0, 1.28, 0),
    new THREE.CylinderGeometry(0.11, 0.135, 0.03, 20).translate(0, 1.435, 0),
  ];
  for (const g of bottle) b.add(g.translate(dxc, 0, dzc), L.bottle);

  // Wall-mounted indoor AC unit on the east wall (in line with the outdoor unit).
  const az = C.acUnit.z;
  b.add(boxG(WALL_IN_X - 0.22, 2.03, az - 0.42, WALL_IN_X, 2.33, az + 0.42), L.appliance);
  b.add(boxG(WALL_IN_X - 0.226, 2.05, az - 0.38, WALL_IN_X - 0.22, 2.09, az + 0.38), L.dark);
  b.add(boxG(WALL_IN_X - 0.223, 2.15, az + 0.34, WALL_IN_X - 0.22, 2.16, az + 0.36), L.led);

  // Fluorescent ceiling light over the table (north of centre so a z = 0 cut keeps it whole).
  const lz = -0.26;
  b.add(boxG(-1.64, CEIL_Y - 0.045, lz - 0.09, -0.36, CEIL_Y, lz + 0.09), L.appliance);
  for (const dz of [-0.04, 0.04]) b.add(cylG(V(-1.60, CEIL_Y - 0.06, lz + dz), V(-0.40, CEIL_Y - 0.06, lz + dz), 0.014, 10), L.lamp);

  // Fire extinguisher by the door.
  const ex = C.door.x0 - 0.25, ez = WALL_IN_Z - 0.12;
  b.add(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16).translate(ex, fy + 0.21, ez), L.red);
  b.add(new THREE.SphereGeometry(0.075, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(ex, fy + 0.42, ez), L.red);
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 10).translate(ex, fy + 0.53, ez), L.dark);

  b.build(interior, 'interior');
  return interior;
}

// ---------------------------------------------------------------- public API
/**
 * Build one container rest room.
 * @returns {{ group: THREE.Group, roofMesh: THREE.Mesh, interior: THREE.Group, update(t:number):void }}
 */
export function buildContainer({ mats }) {
  const L = localMaterials(mats);
  const group = new THREE.Group();
  group.name = 'container';

  const shell = new Batch();
  const glass = new Batch();
  addShell(shell, mats, L);
  addLiftingRings(shell, mats);
  addDoor(shell, glass, mats, L);
  for (const w of C.windows) addWindow(shell, glass, mats, w);
  addSignAndStair(shell, group, mats, L);
  addEastWallEquipment(shell, mats, L);
  shell.build(group, 'shell');
  glass.build(group, 'glass', { castShadow: false });   // glass lets sun into the room
  group.add(buildRibs(mats.containerWall));

  // Roof plate: top surface exactly at roofY, spanning the inside of the top tube.
  const rr = C.roofRect;
  const roofMesh = new THREE.Mesh(
    new THREE.BoxGeometry(rr.x1 - rr.x0, ROOF_T, rr.z1 - rr.z0).translate((rr.x0 + rr.x1) / 2, C.roofY - ROOF_T / 2, (rr.z0 + rr.z1) / 2),
    mats.containerRoof,
  );
  roofMesh.name = 'roofPlate';
  group.add(shadows(roofMesh));

  const fan = buildFan(L);
  group.add(fan);

  const interior = buildInterior(mats, L);
  group.add(interior);

  return {
    group,
    roofMesh,
    interior,
    /** t = elapsed seconds; spins the condenser fan. */
    update(t) {
      if (Number.isFinite(t)) fan.rotation.x = (t * 14) % (Math.PI * 2);
    },
  };
}
