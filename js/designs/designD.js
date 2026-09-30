// designD.js — Design D 타프·차광막형 (camping tarp + agricultural shade net).
//
// Six φ48.6 poles stand on the long-side top tubes: the four corner poles sit on base plates and are
// U-bolted to the adjacent lifting rings, the two mid poles clamp the top tube. Four guy lines brace
// the corner poles. A perimeter cord runs between the pole tops; an aluminet shade net 3.5 × 6.5 m
// drapes over it (pinned at the pole tops) and 24 ball bungees tie the net edge back to the cord.
//
// params.gap   = clear height roof top (2.60) → net underside at the pole tops
// params.shade = shading ratio of the net (net transmittance = 1 − shade)
import * as THREE from 'three';
import { DESIGNS, CONTAINER } from '../config.js';
import { makeNetAlphaTexture } from '../materials.js';
import { tag, rope, PIPE_R } from '../parts.js';

const DES = DESIGNS.D;
const ROOF_Y = CONTAINER.roofY;                 // 2.60 roof plate top
const TUBE = CONTAINER.frameTube;               // perimeter top tube 2.52–2.62
const RING_Y = CONTAINER.ringCenterY;
const RING_R = CONTAINER.ringR;
const UP = new THREE.Vector3(0, 1, 0);

// Pole line (pole centres) and net size
const PX = 2.85, PZ = 1.45;
const NET_HX = 3.25, NET_HZ = 1.75;             // 6.5 × 3.5 m
// Pole tops in loop order (the perimeter cord follows this path)
const POLES = [[-PX, -PZ], [0, -PZ], [PX, -PZ], [PX, PZ], [0, PZ], [-PX, PZ]];

// Net sag model (m): catenary-like sag between supports, drooping overhang outside the pole line
const SAG_LONG = 0.05;      // long-side cord, mid-span between poles
const SAG_SHORT = 0.06;     // short-side cord, mid-span
const SAG_CENTRE = 0.08;    // net centre line (z = 0) at x = 0
const SAG_EXTRA = 0.02;     // extra centre-line sag mid-way between pole pairs
const CORD_R = 0.004;
const BASE_TOP = TUBE.topY + 0.008;             // pole base plate top (8 mm plate on the tube)
const GUY_ALONG = 0.9;                          // guy anchor distance along the tube from the corner pole
const BUNGEE_W = 0.014;                         // loop width (two strands)

// Flutter (update): ≈ 4 mm per m/s, capped, travelling waves ~1–2 Hz
const FLUTTER_PER_MS = 0.004, FLUTTER_MAX = 0.06;
const K1 = (2 * Math.PI) / 1.6, W1 = 2 * Math.PI * 1.2;
const K2 = (2 * Math.PI) / 0.9, W2 = 2 * Math.PI * 1.8;
const SKEW_C = Math.cos(0.6), SKEW_S = Math.sin(0.6);

// Net grid lines: vertices land exactly on the pole lines (66 × 36 segments, ≈ 0.1 m)
const XS = gridLines([-NET_HX, -PX, 0, PX, NET_HX], [4, 29, 29, 4]);
const ZS = gridLines([-NET_HZ, -PZ, PZ, NET_HZ], [3, 30, 3]);

// ---------------------------------------------------------------- small local helpers

function gridLines(stops, segs) {
  const out = [];
  segs.forEach((n, k) => { for (let i = 0; i < n; i++) out.push(stops[k] + ((stops[k + 1] - stops[k]) * i) / n); });
  out.push(stops[stops.length - 1]);
  return out;
}

function readParam(params, key) {
  const p = DES.params[key];
  const v = Number(params?.[key]);
  return Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const vec = (a) => (Array.isArray(a) ? new THREE.Vector3(...a) : a);

/** Box geometry spanning [x0,x1]×[y0,y1]×[z0,z1] (bounds in any order). */
function boxSpan([x0, x1], [y0, y1], [z0, z1]) {
  return new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))
    .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Cylinder geometry between two points. */
function cylBetween(a, b, r, seg = 12) {
  a = vec(a); b = vec(b);
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Matrix4().compose(
    a.clone().addScaledVector(d, 0.5),
    new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()),
    new THREE.Vector3(1, 1, 1));
  return new THREE.CylinderGeometry(r, r, d.length(), seg).applyMatrix4(m);
}

/**
 * Merge indexed geometries into one, grouping triangles by material slot (one draw call per slot).
 * items: [{ g, slot }] or [{ g, slots }] where slots maps g's own groups (materialIndex) → slot.
 */
function mergeBySlot(items, nSlots) {
  let nVert = 0;
  for (const { g } of items) nVert += g.attributes.position.count;
  const pos = new Float32Array(nVert * 3), nor = new Float32Array(nVert * 3), uv = new Float32Array(nVert * 2);
  const tris = Array.from({ length: nSlots }, () => []);
  let base = 0;
  for (const { g, slot = 0, slots } of items) {
    const P = g.attributes.position;
    pos.set(P.array, base * 3);
    nor.set(g.attributes.normal.array, base * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, base * 2);
    const index = g.index.array;
    const groups = slots && g.groups.length ? g.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
    for (const gr of groups) {
      const s = slots ? slots[gr.materialIndex] : slot;
      const end = Math.min(index.length, gr.start + gr.count);
      for (let k = gr.start; k < end; k++) tris[s].push(index[k] + base);
    }
    base += P.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const flat = [];
  tris.forEach((t, s) => {
    if (!t.length) return;
    out.addGroup(flat.length, t.length, s);
    for (const v of t) flat.push(v);
  });
  out.setIndex(flat);
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- net shape

const droop = (d) => (d > 0 ? 0.12 * d + 0.35 * d * d : 0);

/** Sag below the pole-top level at (x, z): 0 at the six pole tops. */
function sagAt(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  const u = Math.min(ax, PX) / PX, v = Math.min(az, PZ) / PZ;
  const s = Math.sin(Math.PI * u);                                   // 0 at x = 0 and x = ±PX
  const cord = SAG_LONG * s;                                         // long-side cord line
  const mid = SAG_CENTRE + SAG_EXTRA * s - (SAG_CENTRE - SAG_SHORT) * u ** 4;   // centre line z = 0
  return cord + (mid - cord) * (1 - v * v) + droop(ax - PX) + droop(az - PZ);
}

/** Horizontal distance from (x, z) to the pole-line rectangle outline (the cord). */
function distToCord(x, z) {
  const dx = Math.abs(x) - PX, dz = Math.abs(z) - PZ;
  if (dx <= 0 && dz <= 0) return Math.min(-dx, -dz);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

function netGeometry(Ys) {
  const nx = XS.length, nz = ZS.length, n = nx * nz;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), weight = new Float32Array(n);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = XS[i], z = ZS[j];
      pos[k * 3] = x; pos[k * 3 + 1] = Ys - sagAt(x, z); pos[k * 3 + 2] = z;
      uv[k * 2] = (x + NET_HX) / (2 * NET_HX); uv[k * 2 + 1] = 1 - (z + NET_HZ) / (2 * NET_HZ);
      // flutter weight: pinned at pole tops, calmer along the cord, free at the overhang
      let dPole = Infinity;
      for (const [px, pz] of POLES) dPole = Math.min(dPole, Math.hypot(x - px, z - pz));
      weight[k] = smooth(dPole / 0.9) * (0.35 + 0.65 * smooth(distToCord(x, z) / 0.4));
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);                                    // +y facing
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // bounds must include the flutter (raycasts / frustum culling use them)
  g.computeBoundingSphere(); g.boundingSphere.radius += FLUTTER_MAX;
  g.computeBoundingBox(); g.boundingBox.expandByScalar(FLUTTER_MAX);
  return { geometry: g, weight };
}

// 24 bungee anchor pairs: net-edge grommet e → cord point c (plan coords)
function bungeeAnchors() {
  const out = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ e: [sx * NET_HX, sz * NET_HZ], c: [sx * PX, sz * PZ] });
  for (const sz of [-1, 1]) {
    for (let k = 1; k <= 7; k++) { const x = -NET_HX + (k * 2 * NET_HX) / 8; out.push({ e: [x, sz * NET_HZ], c: [x, sz * PZ] }); }
  }
  for (const sx of [-1, 1]) {
    for (let k = 1; k <= 3; k++) { const z = -NET_HZ + (k * 2 * NET_HZ) / 4; out.push({ e: [sx * NET_HX, z], c: [sx * PX, z] }); }
  }
  return out;                                                         // 4 + 14 + 6 = 24
}

/** Closed stadium path: two strands E→C, wrapping around the cord at C and the grommet at E. */
function loopPath(E, C, w) {
  const dir = new THREE.Vector3().subVectors(C, E).normalize();
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize().multiplyScalar(w / 2);
  const pts = [];
  for (let i = 0; i <= 4; i++) pts.push(E.clone().lerp(C, i / 4).add(side));
  for (let k = 1; k < 4; k++) {
    const a = (Math.PI * k) / 4;
    pts.push(C.clone().addScaledVector(side, Math.cos(a)).addScaledVector(dir, (w / 2) * Math.sin(a)));
  }
  for (let i = 0; i <= 4; i++) pts.push(C.clone().lerp(E, i / 4).sub(side));
  for (let k = 1; k < 4; k++) {
    const a = (Math.PI * k) / 4;
    pts.push(E.clone().addScaledVector(side, -Math.cos(a)).addScaledVector(dir, -(w / 2) * Math.sin(a)));
  }
  return pts;
}

// ---------------------------------------------------------------- hardware

/**
 * Horizontal in-plane axis of a lifting ring. container.js turns each ring so its hole faces
 * diagonally outward (plane normal ∥ (sx, 0, sz)); CONTRACT §1 describes an x-y plane ring
 * (axis (1, 0, 0)). Only this function encodes that choice — the U-bolt adapts to either.
 */
function ringAxis(sx, sz) {
  return new THREE.Vector3(sz, 0, -sx).normalize();
}

/** Corner pole base: base plate + socket collar on the tube, U-bolt around the lifting ring bar. */
function cornerBaseGeometry(sx, sz) {
  const ring = CONTAINER.liftingRings.find((r) => Math.sign(r.x) === sx && Math.sign(r.z) === sz);
  const px = sx * PX, pz = sz * PZ;
  const pole = new THREE.Vector3(px, RING_Y, pz);
  // the ring's vertical side bar (at ring-centre height) nearest to the pole
  const t = ringAxis(sx, sz).multiplyScalar(RING_R);
  const bar = [1, -1].map((s) => new THREE.Vector3(ring.x, RING_Y, ring.z).addScaledVector(t, s))
    .reduce((a, b) => (a.distanceTo(pole) <= b.distanceTo(pole) ? a : b));
  const u = new THREE.Vector3().subVectors(bar, pole).setY(0);
  const dist = u.length();
  u.normalize();
  const side = new THREE.Vector3().crossVectors(UP, u);               // horizontal, ⟂ pole→bar
  const atPole = new THREE.Matrix4().makeBasis(side, UP, u).setPosition(pole);   // local +z → bar
  const atBar = atPole.clone().setPosition(bar);
  const uR = 0.016, rod = 0.0035;
  const lugOuter = dist - CONTAINER.ringBarR - 0.004;                 // keep 4 mm off the ring bar
  const lugInner = Math.min(0.018, lugOuter - 0.008);
  const legEnd = lugOuter - 0.004 - dist;                             // leg ends inside the lug (bar frame)
  return mergeBySlot([
    { g: boxSpan([px - 0.035, px + 0.035], [TUBE.topY, BASE_TOP], [pz - 0.045, pz + 0.045]), slot: 0 },
    { g: cylBetween([px, BASE_TOP, pz], [px, RING_Y + 0.0225, pz], 0.030, 16), slot: 0 },   // socket + collar
    // saddle lug welded on the collar, facing the ring; takes the U-bolt legs
    { g: boxSpan([-0.024, 0.024], [-0.018, 0.018], [lugInner, lugOuter]).applyMatrix4(atPole), slot: 1 },
    // U-bolt: arc wraps the ring bar on its far side, legs run back into the lug
    { g: new THREE.TorusGeometry(uR, rod, 6, 12, Math.PI).rotateX(Math.PI / 2).applyMatrix4(atBar), slot: 1 },
    { g: cylBetween([uR, 0, 0], [uR, 0, legEnd], rod, 6).applyMatrix4(atBar), slot: 1 },
    { g: cylBetween([-uR, 0, 0], [-uR, 0, legEnd], rod, 6).applyMatrix4(atBar), slot: 1 },
  ], 2);
}

/** Mid pole base: inverted-U clamp over the top tube, clamping bolts on the outer face. */
function midClampGeometry(sz) {
  const pz = sz * PZ, zo = sz * (CONTAINER.W / 2), zi = sz * TUBE.innerZ;   // outer / inner tube faces
  const items = [
    { g: boxSpan([-0.07, 0.07], [TUBE.topY, BASE_TOP], [zi - sz * 0.006, zo + sz * 0.006]), slot: 0 },
    { g: boxSpan([-0.07, 0.07], [2.548, BASE_TOP], [zo, zo + sz * 0.006]), slot: 0 },           // outer jaw
    { g: boxSpan([-0.07, 0.07], [ROOF_Y + 0.006, BASE_TOP], [zi, zi - sz * 0.006]), slot: 0 },  // inner jaw (above roof)
    { g: cylBetween([0, BASE_TOP, pz], [0, 2.70, pz], 0.031, 16), slot: 0 },                    // pole socket
  ];
  for (const bx of [-0.045, 0.045]) {
    items.push({ g: cylBetween([bx, 2.572, zo + sz * 0.006], [bx, 2.572, zo + sz * 0.008], 0.011, 12), slot: 1 });
    items.push({ g: cylBetween([bx, 2.572, zo + sz * 0.008], [bx, 2.572, zo + sz * 0.0145], 0.0095, 6), slot: 1 });
  }
  return mergeBySlot(items, 2);
}

/** Guy line hardware: pole collar ring + tube clamp with eye (zinc). Returns { geometry, A, B }. */
function guyHardware(sx, sz, Ys) {
  const px = sx * PX, pz = sz * PZ, xg = sx * (PX - GUY_ALONG);
  const zo = sz * (CONTAINER.W / 2), zi = sz * TUBE.innerZ;
  const plateTop = TUBE.topY + 0.006, eyeY = plateTop + 0.0125;
  const collarY = Ys - 0.06;
  const geometry = mergeBySlot([
    { g: new THREE.TorusGeometry(PIPE_R + 0.0035, 0.003, 6, 20).rotateX(Math.PI / 2).translate(px, collarY, pz) },
    { g: boxSpan([xg - 0.025, xg + 0.025], [TUBE.topY, plateTop], [zi - sz * 0.006, zo + sz * 0.006]) },
    { g: boxSpan([xg - 0.025, xg + 0.025], [2.555, plateTop], [zo, zo + sz * 0.006]) },
    { g: boxSpan([xg - 0.025, xg + 0.025], [ROOF_Y + 0.006, plateTop], [zi, zi - sz * 0.006]) },
    { g: cylBetween([xg, 2.575, zo + sz * 0.006], [xg, 2.575, zo + sz * 0.012], 0.008, 6) },
    { g: new THREE.TorusGeometry(0.010, 0.0025, 6, 16).translate(xg, eyeY, pz) },   // eye, in the line's plane
  ], 1);
  return {
    geometry,
    A: new THREE.Vector3(px - sx * (PIPE_R + 0.0065), collarY, pz),
    B: new THREE.Vector3(xg, eyeY + 0.0075, pz),
  };
}

// ---------------------------------------------------------------- builder

export function build({ mats, params = {} } = {}) {
  const gap = readParam(params, 'gap');
  const shade = readParam(params, 'shade');
  const Ys = ROOF_Y + gap;                                            // net underside at the pole tops
  const netY = (x, z) => Ys - sagAt(x, z);
  const cordY = (x, z) => netY(x, z) - CORD_R - 0.0005;               // cord runs just under the net

  const group = new THREE.Group();
  group.name = 'design-D';

  // --- poles: pipe + end cap, grommet pin, rubber ball (one shared geometry)
  const poleGeom = mergeBySlot([
    { g: cylBetween([0, BASE_TOP, 0], [0, Ys - 0.010, 0], PIPE_R, 16), slot: 0 },
    { g: cylBetween([0, Ys - 0.010, 0], [0, Ys - 0.004, 0], PIPE_R + 0.002, 16), slot: 0 },
    { g: cylBetween([0, Ys - 0.004, 0], [0, Ys + 0.032, 0], 0.005, 8), slot: 1 },
    { g: new THREE.SphereGeometry(0.016, 12, 8).translate(0, Ys + 0.042, 0), slot: 2 },
  ], 3);
  const poleMats = [mats.steelGalv, mats.zinc, mats.rubber];
  const poles = POLES.map(([x, z]) => {
    const m = new THREE.Mesh(poleGeom, poleMats);
    m.position.set(x, 0, z);
    m.name = x === 0 ? 'pole-mid' : 'pole-corner';
    return tag(m, { partKey: 'pole', name: '폴 φ48.6', explode: [0, 0.6, 0], transmittance: 0 });
  });

  // --- pole bases: corner = base plate + U-bolt to lifting ring, mid = tube clamp
  const baseMats = [mats.steelGalv, mats.zinc];
  const bases = [];
  for (const [x, z] of POLES) {
    const sx = Math.sign(x), sz = Math.sign(z);
    const corner = x !== 0;
    const m = new THREE.Mesh(corner ? cornerBaseGeometry(sx, sz) : midClampGeometry(sz), baseMats);
    m.name = corner ? 'pole-base-ring' : 'pole-base-clamp';
    bases.push(tag(m, {
      partKey: 'base',
      name: corner ? '폴 하단 베이스판 + U볼트(인양고리 결속)' : '폴 하단 각관 클램프(U볼트)',
      explode: [0, 0.2, 0],
    }));
  }

  // --- guy lines: corner pole top → top tube 0.9 m inward, with tensioner + clamp
  const guys = [];
  const tensionerGeom = new THREE.BoxGeometry(0.016, 0.045, 0.007);
  for (const [x, z] of POLES) {
    if (x === 0) continue;
    const sx = Math.sign(x), sz = Math.sign(z);
    const { geometry, A, B } = guyHardware(sx, sz, Ys);
    const g = new THREE.Group();
    g.name = 'guy-line';
    g.add(new THREE.Mesh(geometry, mats.zinc));
    g.add(rope([A, B], 0.004, mats.guyLine, 4));
    const dir = new THREE.Vector3().subVectors(A, B).normalize();
    const t = new THREE.Mesh(tensionerGeom, mats.aluminum);
    t.position.copy(B).addScaledVector(dir, 0.15);
    t.quaternion.setFromUnitVectors(UP, dir);
    g.add(t);
    guys.push(tag(g, { partKey: 'base', name: '가이라인 + 텐셔너', explode: [0, 0.35, 0] }));
  }

  // --- shade net (own material: alpha openness follows 1 − shade)
  const netMat = mats.net.clone();
  const tex = makeNetAlphaTexture(1 - shade);                         // null without a DOM (Node)
  if (tex) {
    netMat.alphaMap = tex;
    netMat.addEventListener('dispose', () => tex.dispose());
  }
  const { geometry: netGeom, weight } = netGeometry(Ys);
  const net = new THREE.Mesh(netGeom, netMat);
  net.name = 'shade-net';
  net.userData.shade = shade;
  tag(net, { partKey: 'net', name: '알루미늄 차광망(알루미넷) 3.5×6.5m', explode: [0, 1.4, 0], transmittance: 1 - shade });

  // --- perimeter cord between the pole tops (closed loop, sagging)
  const cordPts = [];
  POLES.forEach(([x0, z0], k) => {
    const [x1, z1] = POLES[(k + 1) % POLES.length];
    for (let i = 0; i < 16; i++) {
      const x = x0 + ((x1 - x0) * i) / 16, z = z0 + ((z1 - z0) * i) / 16;
      cordPts.push(new THREE.Vector3(x, cordY(x, z), z));
    }
  });
  const cord = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts, true, 'centripetal'), 192, CORD_R, 5, true),
    mats.guyLine);
  cord.name = 'perimeter-cord';
  tag(cord, { partKey: 'net', name: '차광망 테두리 로프', explode: [0, 1.2, 0] });

  // --- 24 ball bungees: loop from the net-edge grommet to the cord, ball at the grommet
  const loops = [];
  const ballPos = [];
  for (const { e, c } of bungeeAnchors()) {
    const E = new THREE.Vector3(e[0], netY(e[0], e[1]) - 0.006, e[1]);    // through the edge grommet, under the hem
    const C = new THREE.Vector3(c[0], cordY(c[0], c[1]) - 0.010, c[1]);   // hooks under the cord
    loops.push({ g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loopPath(E, C, BUNGEE_W), true, 'centripetal'), 36, 0.0025, 4, true) });
    const out = new THREE.Vector3(E.x - C.x, 0, E.z - C.z).normalize();
    ballPos.push(E.clone().addScaledVector(out, 0.022).add(new THREE.Vector3(0, -0.004, 0)));
  }
  const bungees = new THREE.Group();
  bungees.name = 'bungees';
  bungees.add(new THREE.Mesh(mergeBySlot(loops, 1), mats.bungee));
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 10, 8), mats.bungee, ballPos.length);
  const mtx = new THREE.Matrix4();
  ballPos.forEach((p, i) => balls.setMatrixAt(i, mtx.makeTranslation(p.x, p.y, p.z)));
  balls.instanceMatrix.needsUpdate = true;
  balls.computeBoundingSphere();
  bungees.add(balls);
  tag(bungees, { partKey: 'bungee', name: '번지볼·후크 24개', explode: [0, 1.0, 0] });

  // Net + cord + bungees blow away together (bungees act as the fuse)
  const netAssembly = new THREE.Group();
  netAssembly.name = 'net-assembly';
  netAssembly.add(net, cord, bungees);

  group.add(...poles, ...bases, ...guys, netAssembly);

  // --- annotations
  const southBungee = ballPos.find((p) => p.z > 0 && Math.abs(p.x - 1.625) < 1e-6) || ballPos[0];
  const anchors = [
    new THREE.Vector3(-1.2, netY(-1.2, -0.6) + 0.01, -0.6),                  // 1 net
    southBungee.clone(),                                                     // 2 bungee
    new THREE.Vector3(0, (BASE_TOP + Ys) / 2, PZ + PIPE_R),                 // 3 mid pole (south)
    new THREE.Vector3(PX + 0.02, RING_Y, PZ),                                // 4 SE corner base / U-bolt
  ];
  const callouts = DES.callouts.map((c, i) => ({ ...c, anchor: anchors[i] }));

  // --- per-frame net flutter
  const posAttr = netGeom.attributes.position;
  const basePos = posAttr.array.slice();
  let frame = 0, displaced = false;
  function update(t, env = {}) {
    const ws = Math.max(0, Number(env?.windSpeed) || 0);
    const amp = Math.min(FLUTTER_MAX, FLUTTER_PER_MS * ws);
    const p = posAttr.array;
    if (amp < 1e-5) {
      if (displaced) { p.set(basePos); posAttr.needsUpdate = true; netGeom.computeVertexNormals(); displaced = false; }
      return;
    }
    const from = THREE.MathUtils.degToRad(Number.isFinite(env?.windDirDeg) ? env.windDirDeg : 270);
    const dx = -Math.sin(from), dz = Math.cos(from);                  // downwind (+x East, +z South)
    const ex = dx * SKEW_C - dz * SKEW_S, ez = dx * SKEW_S + dz * SKEW_C;
    for (let i = 0; i < weight.length; i++) {
      const w = weight[i];
      if (w === 0) continue;
      const x = basePos[i * 3], z = basePos[i * 3 + 2];
      p[i * 3 + 1] = basePos[i * 3 + 1] + amp * w * (
        0.65 * Math.sin(K1 * (x * dx + z * dz) - W1 * t) +
        0.35 * Math.sin(K2 * (x * ex + z * ez) - W2 * t + 1.3));
    }
    posAttr.needsUpdate = true;
    if ((frame++ & 1) === 0) netGeom.computeVertexNormals();          // normals every other frame
    displaced = true;
  }

  return {
    id: 'D',
    group,
    parts: [
      { key: 'net', name: '차광망 (알루미넷 3.5×6.5m)', count: 1, objects: [net, cord] },
      { key: 'bungee', name: '번지볼·후크', count: 24, objects: [bungees] },
      { key: 'pole', name: '폴 φ48.6', count: 6, objects: poles },
      { key: 'base', name: '폴 하단 U볼트 + 가이라인', count: 10, countText: 'U볼트 6 + 가이라인 4', objects: [...bases, ...guys] },
    ],
    installSteps: [
      { title: '폴 6본 세우기 · U볼트 결속 (인양고리·각관)', minutes: 8, objects: [...poles, ...bases] },
      { title: '가이라인 4개 당기기', minutes: 5, objects: guys },
      { title: '차광망 펼치기 · 테두리 로프', minutes: 7, objects: [net, cord] },
      { title: '번지볼 24개 걸기', minutes: 5, objects: [bungees] },
    ],
    callouts,
    gapLabel: { text: DES.gapText, anchor: new THREE.Vector3(0, ROOF_Y + gap / 2, 0) },
    shadeMeshes: [net, ...poles],
    topSurfaces: [net],
    gap: {
      y0: ROOF_Y, y1: Ys,
      x0: CONTAINER.roofRect.x0, x1: CONTAINER.roofRect.x1,
      z0: CONTAINER.roofRect.z0, z1: CONTAINER.roofRect.z1,
    },
    windLoose: [netAssembly],
    update,
  };
}
