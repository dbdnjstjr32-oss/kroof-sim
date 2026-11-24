// container.js — 6.0m × 3.0m × 2.8m construction-site container rest room (컨테이너 휴게실).
//
// Built in container-local coordinates (origin = footprint centre at ground level, +x East, +y Up, +z South).
// Top surface of roof steel plate and perimeter top frame sits at y = 2.80 m (CONTAINER.roofY).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONTAINER as C } from './config.js';
import { shadows } from './parts.js';

const hasDOM = typeof document !== 'undefined';
const UP = new THREE.Vector3(0, 1, 0);

const HX = C.L / 2;                 // 3.0
const HZ = C.W / 2;                 // 1.5
const POST = C.cornerPost;          // 0.15
const TUBE = C.frameTube;           // 100×100 top frame tube (2.70..2.80)
const BASE_H = 0.10;                // base channel height = finished floor = door sill
const RIB = 0.010;                  // wall corrugation rib protrusion
const RIB_W = 0.03;
const WALL_T = 0.05;
const WALL_OUT_X = HX - RIB, WALL_IN_X = WALL_OUT_X - WALL_T;
const WALL_OUT_Z = HZ - RIB, WALL_IN_Z = WALL_OUT_Z - WALL_T;
const ROOF_T = 0.005;               // drawn 1.2T steel roof plate thickness
const INS_T = 0.05;                 // 50 mm glass wool insulation (shown when insulationMm > 0)
const CEIL_Y = 2.58, CEIL_T = 0.02;

const FACE = { south: { axis: 'z', s: 1 }, north: { axis: 'z', s: -1 }, east: { axis: 'x', s: 1 }, west: { axis: 'x', s: -1 } };

const LOCAL = new WeakMap();
const MAT_LABEL = new WeakMap();

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
    core: std({ name: 'panelCore', color: 0xe8e3d6, roughness: 0.95, side: DS }),
    steelCut: std({ name: 'steelCut', color: 0x6e747b, roughness: 0.5, metalness: 0.5, side: DS }),
    insulation: std({ name: 'insulation', color: 0xe2c25c, roughness: 1, side: DS }),
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

const boxG = (x0, y0, z0, x1, y1, z1) =>
  new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

const capAxis = (axis, main, cap) =>
  axis === 'x' ? [cap, cap, main, main, main, main]
    : axis === 'y' ? [main, main, cap, cap, main, main]
      : [main, main, main, main, cap, cap];

function faceBox(face, u0, u1, y0, y1, o0, o1) {
  const { axis, s } = FACE[face];
  const a = s * o0, b = s * o1, lo = Math.min(a, b), hi = Math.max(a, b);
  return axis === 'z' ? boxG(u0, y0, lo, u1, y1, hi) : boxG(lo, y0, u0, hi, y1, u1);
}

const _q = new THREE.Quaternion();
function alongG(geo, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  geo.applyQuaternion(_q.setFromUnitVectors(UP, dir.clone().normalize()));
  return geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const beamG = (a, b, w, d = w) => alongG(new THREE.BoxGeometry(w, a.distanceTo(b), d), a, b);
const cylG = (a, b, r, seg = 12) => alongG(new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg), a, b);

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

function openingsOf(face) {
  const list = C.windows.filter((w) => w.face === face);
  if (C.door.face === face) list.push(C.door);
  return list;
}

const wallSpan = (face) => (FACE[face].axis === 'z' ? [-(HX - POST), HX - POST] : [-(HZ - POST), HZ - POST]);

function wallGeo(face) {
  const [u0, u1] = wallSpan(face);
  const y0 = BASE_H, y1 = C.wallTopY;
  const ops = openingsOf(face);
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
  const m = new THREE.Matrix4();
  if (face === 'south') m.makeTranslation(0, 0, WALL_IN_Z);
  else if (face === 'north') m.makeTranslation(0, 0, -WALL_OUT_Z);
  else if (face === 'east') m.makeRotationY(-Math.PI / 2).setPosition(WALL_OUT_X, 0, 0);
  else m.makeRotationY(Math.PI / 2).setPosition(-WALL_OUT_X, 0, 0);
  return g.applyMatrix4(m);
}

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

function makeTrapRibGeometry() {
  // Unit trapezoidal prism: X width = 1.0 base -> 0.56 crest, Y height = 1.0, Z protrusion = 0..1
  const s = new THREE.Shape([
    new THREE.Vector2(-0.5, 0),
    new THREE.Vector2(0.5, 0),
    new THREE.Vector2(0.28, 1),
    new THREE.Vector2(-0.28, 1),
  ]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.5);
  // Rotate +90° around X so trapezoid cross-section protrudes outward along +Z (0..1) and spans Y (-0.5..+0.5)
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function buildRibs(mat) {
  const faces = ['south', 'north', 'east', 'west'];
  const layout = faces.flatMap((f) => ribLayout(f).map((r) => ({ ...r, face: f })));
  const mesh = new THREE.InstancedMesh(makeTrapRibGeometry(), mat, layout.length);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
  const faceYaw = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };
  const trapW = 0.088, trapD = 0.012;
  layout.forEach((r, i) => {
    const { axis, s: sg } = FACE[r.face];
    const baseOut = sg * (axis === 'z' ? WALL_OUT_Z : WALL_OUT_X);
    const h = r.y1 - r.y0, yc = (r.y0 + r.y1) / 2;
    if (axis === 'z') p.set(r.u, yc, baseOut);
    else p.set(baseOut, yc, r.u);
    q.setFromAxisAngle(UP, faceYaw[r.face]);
    s.set(trapW, h, trapD);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'wallRibs';
  return shadows(mesh);
}

function addShell(b, mats, L) {
  const frame = mats.containerFrame;
  const tw = 0.008, fl = 0.047;
  for (const sz of [-1, 1]) {
    const zw0 = sz * (HZ - tw), zw1 = sz * HZ, zf = sz * (HZ - tw - fl);
    const x0 = -(HX - POST), x1 = HX - POST;
    b.add(boxG(x0, 0, Math.min(zw0, zw1), x1, BASE_H, Math.max(zw0, zw1)), capAxis('x', frame, L.steelCut));
    for (const [y0, y1] of [[0, tw], [BASE_H - tw, BASE_H]]) {
      b.add(boxG(x0, y0, Math.min(zf, zw0), x1, y1, Math.max(zf, zw0)), capAxis('x', frame, L.steelCut));
    }
  }
  for (const sx of [-1, 1]) {
    const xw0 = sx * (HX - tw), xw1 = sx * HX, xf = sx * (HX - tw - fl);
    const z0 = -(HZ - POST), z1 = HZ - POST;
    b.add(boxG(Math.min(xw0, xw1), 0, z0, Math.max(xw0, xw1), BASE_H, z1), capAxis('z', frame, L.steelCut));
    for (const [y0, y1] of [[0, tw], [BASE_H - tw, BASE_H]]) {
      b.add(boxG(Math.min(xf, xw0), y0, z0, Math.max(xf, xw0), y1, z1), capAxis('z', frame, L.steelCut));
    }
  }

  // Corner posts 150×150 up to wallTopY (2.70) + 8 ISO corner castings with twist-lock apertures
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const xa = sx * (HX - POST), xb = sx * HX, za = sz * (HZ - POST), zb = sz * HZ;
    b.add(boxG(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), C.wallTopY, Math.max(za, zb)), frame);

    const cx0 = sx > 0 ? HX - 0.162 : -HX - 0.004, cx1 = sx > 0 ? HX + 0.004 : -HX + 0.162;
    const cz0 = sz > 0 ? HZ - 0.162 : -HZ - 0.004, cz1 = sz > 0 ? HZ + 0.004 : -HZ + 0.162;
    for (const [cy0, cy1] of [[0, 0.118], [C.roofY - 0.118, C.roofY]]) {
      b.add(boxG(cx0, cy0, cz0, cx1, cy1, cz1), mats.steelDark);
      const yMid = (cy0 + cy1) / 2;
      // Dark recessed twist-lock oval apertures on end/side/top-bottom faces
      const exX = sx > 0 ? cx1 : cx0 - 0.002;
      b.add(boxG(exX, yMid - 0.024, (cz0 + cz1) / 2 - 0.032, exX + 0.002, yMid + 0.024, (cz0 + cz1) / 2 + 0.032), mats.containerTrim);
      const exZ = sz > 0 ? cz1 : cz0 - 0.002;
      b.add(boxG((cx0 + cx1) / 2 - 0.032, yMid - 0.024, exZ, (cx0 + cx1) / 2 + 0.032, yMid + 0.024, exZ + 0.002), mats.containerTrim);
    }
  }

  for (const f of ['south', 'north', 'east', 'west']) b.add(wallGeo(f), [mats.containerWall, L.core]);

  // Forklift pockets along base side channels (north & south)
  for (const x of [-0.95, 0.95]) {
    for (const sz of [-1, 1]) {
      const z0 = sz > 0 ? HZ - 0.02 : -HZ - 0.004;
      const z1 = sz > 0 ? HZ + 0.004 : -HZ + 0.02;
      b.add(boxG(x - 0.16, 0.016, z0, x + 0.16, 0.084, z1), mats.containerTrim);
      b.add(boxG(x - 0.175, 0.082, z0, x + 0.175, 0.094, z1 + sz * 0.004), frame);
    }
  }

  // Perimeter top frame tube 100×100 (2.70..2.80, flush with roofY = 2.80)
  const ty0 = TUBE.bottomY, ty1 = TUBE.topY, t = 0.005;
  for (const sz of [-1, 1]) {
    const za = sz * TUBE.innerZ, zb = sz * HZ;
    b.add(boxG(-HX, ty0, Math.min(za, zb), HX, ty1, Math.max(za, zb)), frame);
  }
  for (const sx of [-1, 1]) {
    const xi = sx * TUBE.innerX, xo = sx * HX, lo = Math.min(xi, xo), hi = Math.max(xi, xo);
    const z0 = -TUBE.innerZ, z1 = TUBE.innerZ, cut = capAxis('z', frame, L.steelCut);
    b.add(boxG(lo, ty1 - t, z0, hi, ty1, z1), cut);
    b.add(boxG(lo, ty0, z0, hi, ty0 + t, z1), cut);
    b.add(boxG(hi - t, ty0 + t, z0, hi, ty1 - t, z1), cut);
    b.add(boxG(lo, ty0 + t, z0, lo + t, ty1 - t, z1), cut);
  }

  // Lower slotted steel lashing anchor lugs on base channel for twin J-hooks
  for (const x of [-2.95, -1.50, 0, 1.50, 2.95]) {
    for (const sz of [-1, 1]) {
      if (sz > 0 && x > 1.2 && x < 2.3) continue; // skip south door opening
      const zFace = sz * HZ;
      const zOut = zFace + sz * 0.022;
      const zLo = Math.min(zFace, zOut), zHi = Math.max(zFace, zOut);
      // U-bracket housing + bottom catch lip + dark pocket recess + horizontal engagement pin
      b.add(boxG(x - 0.032, 0.025, zLo, x - 0.018, 0.088, zHi), mats.steelDark);
      b.add(boxG(x + 0.018, 0.025, zLo, x + 0.032, 0.088, zHi), mats.steelDark);
      b.add(boxG(x - 0.032, 0.025, zLo, x + 0.032, 0.042, zHi), mats.steelDark);
      b.add(boxG(x - 0.018, 0.042, zLo, x + 0.018, 0.085, zFace + sz * 0.005), mats.containerTrim);
      b.add(cylG(V(x - 0.026, 0.072, zFace + sz * 0.014), V(x + 0.026, 0.072, zFace + sz * 0.014), 0.0055, 8), mats.zinc);
    }
  }

  // Roof bows (40×40) under roof/insulation cavity
  const rr = C.innerRoofRect;
  for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) {
    const y1 = C.roofY - ROOF_T - INS_T;
    b.add(boxG(x - 0.02, y1 - 0.04, rr.z0, x + 0.02, y1, rr.z1), capAxis('z', frame, L.steelCut));
  }

  b.add(boxG(-WALL_IN_X, CEIL_Y, -WALL_IN_Z, WALL_IN_X, CEIL_Y + CEIL_T, WALL_IN_Z),
    [L.core, L.core, L.core, L.ceiling, L.core, L.core]);
  b.add(boxG(-WALL_IN_X, 0.02, -WALL_IN_Z, WALL_IN_X, BASE_H, WALL_IN_Z),
    [L.plywood, L.plywood, L.vinyl, L.plywood, L.plywood, L.plywood]);
}

function addDoor(b, glass, mats) {
  const d = C.door, f = d.face;
  const O0 = WALL_IN_Z - 0.005, O1 = HZ + 0.005;
  const jw = 0.04;
  b.add(faceBox(f, d.x0, d.x0 + jw, d.y0, d.y1, O0, O1), mats.containerTrim);
  b.add(faceBox(f, d.x1 - jw, d.x1, d.y0, d.y1, O0, O1), mats.containerTrim);
  b.add(faceBox(f, d.x0 + jw, d.x1 - jw, d.y1 - jw, d.y1, O0, O1), mats.containerTrim);
  b.add(faceBox(f, d.x0, d.x1, d.y0, d.y0 + 0.008, O0, O1), mats.aluminum);
  // Door rain drip flashing hood
  b.add(faceBox(f, d.x0 - 0.04, d.x1 + 0.04, d.y1 + 0.01, d.y1 + 0.032, HZ, HZ + 0.048), mats.containerFrame);

  const lx0 = d.x0 + jw + 0.005, lx1 = d.x1 - jw - 0.005, ly0 = d.y0 + 0.01, ly1 = d.y1 - jw - 0.005;
  const vx0 = (lx0 + lx1) / 2 - 0.13, vx1 = vx0 + 0.26, vy0 = 1.40, vy1 = 1.85;
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const leaf = new THREE.Shape([V2(lx0, ly0), V2(lx1, ly0), V2(lx1, ly1), V2(lx0, ly1)]);
  leaf.holes.push(new THREE.Path([V2(vx0, vy0), V2(vx0, vy1), V2(vx1, vy1), V2(vx1, vy0)]));
  const leafT = 0.035, leafIn = WALL_IN_Z + 0.015;
  b.add(new THREE.ExtrudeGeometry(leaf, { depth: leafT, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, leafIn), mats.door);
  const leafOut = leafIn + leafT;
  glass.add(faceBox(f, vx0, vx1, vy0, vy1, leafIn + leafT / 2 - 0.0025, leafIn + leafT / 2 + 0.0025), mats.glass);

  const tw = 0.02;
  b.add(faceBox(f, vx0 - tw, vx1 + tw, vy0 - tw, vy0, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, vx0 - tw, vx1 + tw, vy1, vy1 + tw, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, vx0 - tw, vx0, vy0, vy1, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, vx1, vx1 + tw, vy0, vy1, leafOut, leafOut + 0.004), mats.aluminum);
  b.add(faceBox(f, lx0 + 0.02, lx1 - 0.02, ly0 + 0.01, ly0 + 0.21, leafOut, leafOut + 0.0035), mats.aluminum);

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
  b.add(faceBox(f, w.x0, w.x0 + fw, w.y0, w.y1, O0, O1), mats.aluminum);
  b.add(faceBox(f, w.x1 - fw, w.x1, w.y0, w.y1, O0, O1), mats.aluminum);
  b.add(faceBox(f, w.x0 + fw, w.x1 - fw, w.y0, w.y0 + fw, O0, O1), mats.aluminum);
  b.add(faceBox(f, w.x0 + fw, w.x1 - fw, w.y1 - fw, w.y1, O0, O1), mats.aluminum);
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
  b.add(faceBox(f, w.x0 - 0.04, w.x1 + 0.04, w.y0 - 0.025, w.y0, WALL_OUT_Z, HZ + 0.04), mats.aluminum);
  // Window upper rain drip hood
  b.add(faceBox(f, w.x0 - 0.04, w.x1 + 0.04, w.y1 + 0.006, w.y1 + 0.026, WALL_OUT_Z, HZ + 0.038), mats.aluminum);
}

function addSignAndStair(b, group, mats, L) {
  const d = C.door, xc = (d.x0 + d.x1) / 2;
  b.add(faceBox(d.face, xc - 0.32, xc + 0.32, 2.22, 2.48, HZ, HZ + 0.012), mats.containerTrim);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.60, 0.225), L.sign);
  face.position.set(xc, 2.35, HZ + 0.0125);
  face.name = 'signFace';
  group.add(shadows(face, false, true));

  const z0 = HZ + 0.005, zMid = 1.87, z1 = 2.13, sx0 = d.x0 - 0.10, sx1 = d.x1 + 0.10, pt = 0.008;
  const prof = new THREE.Shape([[z0, 0], [z1, 0], [z1, 0.047], [zMid, 0.047], [zMid, 0.094], [z0, 0.094]].map(([u, v]) => new THREE.Vector2(u, v)));
  const m = new THREE.Matrix4();
  for (const xr of [sx0 + pt, sx1]) {
    b.add(new THREE.ExtrudeGeometry(prof, { depth: pt, bevelEnabled: false }).applyMatrix4(m.makeRotationY(-Math.PI / 2).setPosition(xr, 0, 0)), mats.steelGalv);
  }
  b.add(boxG(sx0 + pt, 0.094, z0, sx1 - pt, BASE_H, zMid), mats.steelGalv);
  b.add(boxG(sx0 + pt, 0.047, zMid, sx1 - pt, 0.053, z1), mats.steelGalv);
}

function addEastWallEquipment(b, mats, L) {
  const zc = C.acUnit.z;
  const x0 = HX + 0.06, x1 = HX + 0.31, y0 = 0.62, y1 = 1.16, z0 = zc - 0.39, z1 = zc + 0.39;
  b.add(boxG(x0, y0, z0, x1, y1, z1), L.appliance);

  for (const zb of [zc - 0.28, zc + 0.28]) {
    b.add(boxG(HX, 0.56, zb - 0.02, HX + 0.36, 0.60, zb + 0.02), mats.steelGalv);
    b.add(boxG(HX, 0.25, zb - 0.03, HX + 0.008, 0.60, zb + 0.03), mats.steelGalv);
    b.add(beamG(V(HX + 0.01, 0.29, zb), V(HX + 0.33, 0.575, zb), 0.03), mats.steelGalv);
    b.add(boxG(x0 + 0.02, 0.60, zb - 0.03, x1 - 0.02, y0, zb + 0.03), mats.rubber);
  }

  const fy = (y0 + y1) / 2, fz = zc - 0.12, fr = 0.2;
  b.add(new THREE.CircleGeometry(fr + 0.005, 28).rotateY(Math.PI / 2).translate(x1 + 0.0015, fy, fz), L.dark);
  b.add(new THREE.TorusGeometry(fr + 0.012, 0.008, 6, 32).rotateY(Math.PI / 2).translate(x1 + 0.002, fy, fz), L.appliance);
  for (const r of [0.07, 0.13, 0.19]) b.add(new THREE.TorusGeometry(r, 0.0035, 4, 32).rotateY(Math.PI / 2).translate(x1 + 0.025, fy, fz), mats.containerTrim);
  b.add(boxG(x1 + 0.022, fy - 0.005, fz - fr, x1 + 0.028, fy + 0.005, fz + fr), mats.containerTrim);
  b.add(boxG(x1 + 0.022, fy - fr, fz - 0.005, x1 + 0.028, fy + fr, fz + 0.005), mats.containerTrim);
  b.add(cylG(V(x1 + 0.02, fy, fz), V(x1 + 0.03, fy, fz), 0.03, 12), mats.containerTrim);

  for (let i = 0; i < 9; i++) {
    const y = y0 + 0.07 + i * 0.047;
    b.add(boxG(x1, y, zc + 0.12, x1 + 0.008, y + 0.012, z1 - 0.04), mats.containerTrim);
  }

  b.add(boxG(x0 + 0.02, 0.68, z1, x0 + 0.14, 0.86, z1 + 0.015), L.appliance);
  const ya = 0.74, zs = z1 + 0.015;
  const pa = V(x0 + 0.055, ya, zs), pb = V(x0 + 0.105, ya, zs);
  b.add(cylG(pa, V(pa.x, ya, zs + 0.025), 0.008, 8), L.copper);
  b.add(cylG(pb, V(pb.x, ya, zs + 0.025), 0.006, 8), L.copper);
  const xr = HX + 0.035, yIn = 2.05;
  b.add(bentPipeG([V(pa.x, ya, zs + 0.02), V(pa.x, ya, zc + 0.47), V(xr, ya, zc + 0.47), V(xr, yIn, zc + 0.47), V(WALL_OUT_X, yIn, zc + 0.47)], 0.013), L.pipeWrap);
  b.add(bentPipeG([V(pb.x, ya, zs + 0.02), V(pb.x, ya, zc + 0.505), V(xr, ya, zc + 0.505), V(xr, yIn, zc + 0.505), V(WALL_OUT_X, yIn, zc + 0.505)], 0.010), L.pipeWrap);
  b.add(bentPipeG([V(WALL_OUT_X, yIn - 0.025, zc + 0.54), V(HX + 0.06, yIn - 0.025, zc + 0.54), V(HX + 0.06, 0.06, zc + 0.54), V(HX + 0.20, 0.02, zc + 0.54)], 0.008, 0.08), mats.rubber);
  b.add(cylG(V(HX, yIn - 0.01, zc + 0.495), V(HX + 0.012, yIn - 0.01, zc + 0.495), 0.058, 20), L.appliance);

  const ez = 0.72;
  b.add(boxG(HX, 1.28, ez - 0.2, HX + 0.13, 1.70, ez + 0.2), L.panelGrey);
  b.add(boxG(HX + 0.13, 1.30, ez - 0.18, HX + 0.134, 1.68, ez - 0.17), mats.containerTrim);
  b.add(new THREE.BoxGeometry(0.002, 0.07, 0.07).rotateX(Math.PI / 4).translate(HX + 0.131, 1.60, ez), L.warn);
  b.add(cylG(V(HX + 0.065, 1.28, ez), V(HX + 0.065, -0.02, ez), 0.013, 10), mats.steelDark);
}

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

function buildInterior(mats, L) {
  const interior = new THREE.Group();
  interior.name = 'interior';
  const b = new Batch();
  const fy = BASE_H;
  const steel = mats.steelDark;

  const tx0 = -1.62, tx1 = -0.42, tz = 0.36, ty = 0.82;
  b.add(boxG(tx0, ty - 0.025, -tz, tx1, ty, tz), L.laminate);
  for (const x of [tx0 + 0.05, tx1 - 0.05]) for (const z of [-tz + 0.05, tz - 0.05]) b.add(boxG(x - 0.0175, fy, z - 0.0175, x + 0.0175, ty - 0.025, z + 0.0175), steel);
  for (const z of [-tz + 0.05, tz - 0.05]) b.add(boxG(tx0 + 0.05, 0.24, z - 0.0125, tx1 - 0.05, 0.265, z + 0.0125), steel);

  for (const zc of [-0.66, 0.66]) {
    b.add(boxG(-1.72, 0.44, zc - 0.15, -0.32, 0.475, zc + 0.15), L.wood);
    for (const x of [-1.62, -0.42]) {
      for (const dz of [-0.1, 0.1]) b.add(boxG(x - 0.015, fy, zc + dz - 0.015, x + 0.015, 0.44, zc + dz + 0.015), steel);
      b.add(boxG(x - 0.015, fy, zc - 0.13, x + 0.015, fy + 0.025, zc + 0.13), steel);
    }
  }

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

  const az = C.acUnit.z;
  b.add(boxG(WALL_IN_X - 0.22, 2.15, az - 0.42, WALL_IN_X, 2.45, az + 0.42), L.appliance);
  b.add(boxG(WALL_IN_X - 0.226, 2.17, az - 0.38, WALL_IN_X - 0.22, 2.21, az + 0.38), L.dark);
  b.add(boxG(WALL_IN_X - 0.223, 2.27, az + 0.34, WALL_IN_X - 0.22, 2.28, az + 0.36), L.led);

  const lz = -0.26;
  b.add(boxG(-1.64, CEIL_Y - 0.045, lz - 0.09, -0.36, CEIL_Y, lz + 0.09), L.appliance);
  for (const dz of [-0.04, 0.04]) b.add(cylG(V(-1.60, CEIL_Y - 0.06, lz + dz), V(-0.40, CEIL_Y - 0.06, lz + dz), 0.014, 10), L.lamp);

  const ex = C.door.x0 - 0.25, ez = WALL_IN_Z - 0.12;
  b.add(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16).translate(ex, fy + 0.21, ez), L.red);
  b.add(new THREE.SphereGeometry(0.075, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(ex, fy + 0.42, ez), L.red);
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 10).translate(ex, fy + 0.53, ez), L.dark);

  b.build(interior, 'interior');
  return interior;
}

export function buildContainer({ mats }) {
  const L = localMaterials(mats);
  const group = new THREE.Group();
  group.name = 'container';

  const shell = new Batch();
  const glass = new Batch();
  addShell(shell, mats, L);
  addDoor(shell, glass, mats);
  for (const w of C.windows) addWindow(shell, glass, mats, w);
  addSignAndStair(shell, group, mats, L);
  addEastWallEquipment(shell, mats, L);
  shell.build(group, 'shell');
  glass.build(group, 'glass', { castShadow: false });
  group.add(buildRibs(mats.containerWall));

  // Existing 1.2T steel roof plate (base trough at 2.793m, trapezoidal ribs crest at roofY = 2.800m)
  const rr = C.innerRoofRect;
  const roofMesh = new THREE.Mesh(
    new THREE.BoxGeometry(rr.x1 - rr.x0, ROOF_T, rr.z1 - rr.z0).translate((rr.x0 + rr.x1) / 2, C.roofY - ROOF_T / 2 - 0.003, (rr.z0 + rr.z1) / 2),
    mats.containerRoof,
  );
  roofMesh.name = 'roofPlate';
  group.add(shadows(roofMesh));

  // Trapezoidal steel roof corrugation ribs on the roof plate (crest flush with roofY = 2.800m)
  const beadPitch = 0.20;
  const nBeads = Math.floor((rr.x1 - rr.x0 - 0.16) / beadPitch) + 1;
  const ribShape = new THREE.Shape([
    new THREE.Vector2(-0.045, 0),
    new THREE.Vector2(0.045, 0),
    new THREE.Vector2(0.025, 0.006),
    new THREE.Vector2(-0.025, 0.006),
  ]);
  const ribGeo = new THREE.ExtrudeGeometry(ribShape, { depth: rr.z1 - rr.z0, bevelEnabled: false, curveSegments: 1 });
  ribGeo.translate(0, 0, -(rr.z1 - rr.z0) / 2);
  ribGeo.computeVertexNormals();
  const roofBeads = new THREE.InstancedMesh(ribGeo, mats.containerRoof, nBeads);
  const bm = new THREE.Matrix4();
  for (let i = 0; i < nBeads; i++) {
    const x = (rr.x0 + rr.x1) / 2 + (i - (nBeads - 1) / 2) * beadPitch;
    roofBeads.setMatrixAt(i, bm.makeTranslation(x, C.roofY - 0.006, (rr.z0 + rr.z1) / 2));
  }
  roofBeads.instanceMatrix.needsUpdate = true;
  roofBeads.name = 'roofBeads';
  group.add(shadows(roofBeads));

  // Optional 50 mm roof insulation layer (toggled via setInsulation)
  const insMesh = new THREE.Mesh(
    boxG(rr.x0, C.roofY - ROOF_T - INS_T, rr.z0, rr.x1, C.roofY - ROOF_T, rr.z1),
    L.insulation,
  );
  insMesh.name = 'roofInsulation';
  insMesh.visible = false;
  group.add(shadows(insMesh));

  const fan = buildFan(L);
  group.add(fan);

  const interior = buildInterior(mats, L);
  group.add(interior);

  return {
    group,
    roofMesh,
    insulationMesh: insMesh,
    interior,
    setInsulation(mm) { insMesh.visible = Number(mm) > 0; },
    update(t) {
      if (Number.isFinite(t)) fan.rotation.x = (t * 14) % (Math.PI * 2);
    },
  };
}
