// designA.js — 설계안 A: 비계 캐노피형 (scaffold canopy).
//
// Load path (top → bottom):
//   corrugated Al sheets (4) → hook bolts → 3 m transoms (5) → right-angle couplers → 6 m ledgers (2)
//   → right-angle couplers → posts φ48.6 (8) → 150×150 base plates on the long-side top tubes.
//   Corner posts are tied to the adjacent lifting ring (U-bolt through the ring eye and a welded ear);
//   mid posts grip the top tube with two hook clamps (jaw on the inner lip, leg + set bolt on the outer face).
//   Nothing bears on the thin roof plate.
//
// This file also exports two small helpers (createPartKit, designParam) shared by designB.js / designC.js.
import * as THREE from 'three';
import { CONTAINER, DESIGNS } from '../config.js';
import { PIPE_R, corrugatedSheet, rightAngleClamp, uBolt, tag, shadows } from '../parts.js';

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- shared helpers (used by B and C too)

/** Clamp a design parameter to its slider range from config (falls back to the default). */
export function designParam(id, key, value) {
  const p = DESIGNS[id].params[key];
  const v = Number.isFinite(value) ? value : p.default;
  return Math.min(p.max, Math.max(p.min, v));
}

/**
 * Lifting-ring frame, matching container.js: the ring stands vertical with its plane turned so the eye faces
 * diagonally outward (eye axis n ∥ (sx, 0, sz)). u = horizontal axis in the ring plane.
 * `yaw` is the Object3D.rotation.y that maps local x → u and local z → n, so ring attachments can be modelled
 * in ring-local coordinates (ring plane = local x-y, centre at (0, ringCenterY, 0)).
 * (config.js describes the plane as parallel to x-y; container.js turns it 45° — change only this function.)
 */
export function ringFrame(ring) {
  const sx = Math.sign(ring.x), sz = Math.sign(ring.z);
  const yaw = Math.atan2(sx, sz);
  const u = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const origin = new THREE.Vector3(ring.x, 0, ring.z);
  return {
    sx, sz, yaw, u, n, origin,
    /** Ring-local (x', y, z') → container-local point. */
    toWorld: (x, y, z) => origin.clone().addScaledVector(u, x).addScaledVector(n, z).setY(y),
  };
}

/**
 * Geometry kit with a per-build cache so repeated parts share BufferGeometries.
 * All positions are container-local metres; boxes accept their two corners in any order,
 * which makes mirrored parts trivial (just multiply coordinates by ±1).
 */
export function createPartKit() {
  const cache = new Map();
  const shared = (key, make) => {
    let g = cache.get(key);
    if (!g) cache.set(key, (g = make()));
    return g;
  };
  const k = (v) => Math.round(v * 1e5);            // cache key precision: 0.01 mm
  const toV = (p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone());

  /** Mesh of a unit-height cylinder geometry, stretched between a and b. */
  const stretched = (geo, a, b, mat) => {
    const A = toV(a), B = toV(b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(A).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.scale.set(1, len, 1);
    return shadows(m);
  };

  return {
    /** Axis-aligned box spanning corners a and b ([x,y,z], any order). */
    box(a, b, mat) {
      const lo = a.map((v, i) => Math.min(v, b[i]));
      const hi = a.map((v, i) => Math.max(v, b[i]));
      const [w, h, d] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const geo = shared(`box|${k(w)}|${k(h)}|${k(d)}`, () => new THREE.BoxGeometry(w, h, d));
      const m = new THREE.Mesh(geo, mat);
      m.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
      return shadows(m);
    },
    /** Round bar / pipe of radius r between points a and b. */
    cyl(a, b, r, mat, seg = 12) {
      const geo = shared(`cyl|${k(r)}|${seg}`, () => new THREE.CylinderGeometry(r, r, 1, seg, 1, false));
      return stretched(geo, a, b, mat);
    },
    /** Flat bar (width × thick) from a to b; for a horizontal a→b the width stays horizontal. */
    bar(a, b, width, thick, mat) {
      const A = toV(a), B = toV(b);
      const dir = B.clone().sub(A);
      const len = dir.length();
      const geo = shared(`box|${k(width)}|${k(thick)}|1`, () => new THREE.BoxGeometry(width, thick, 1));
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(A).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      m.scale.set(1, 1, len);
      return shadows(m);
    },
    /** Hex disc (nut / bolt head) whose base sits at pos and which extends h along unit dir. */
    hex(pos, dir, mat, { r = 0.007, h = 0.005 } = {}) {
      const P = toV(pos), D = toV(dir).normalize();
      return this.cyl(P, P.clone().addScaledVector(D, h), r, mat, 6);
    },
    /** Hex bolt: head behind pos (against -dir), shank of length len running along unit dir. */
    bolt(pos, dir, mat, { d = 0.01, len = 0.03 } = {}) {
      const P = toV(pos), D = toV(dir).normalize();
      const g = new THREE.Group();
      g.add(this.hex(P, D.clone().negate(), mat, { r: d * 0.95, h: d * 0.6 }));
      g.add(this.cyl(P, P.clone().addScaledVector(D, len), d / 2, mat, 8));
      return g;
    },
    /** One InstancedMesh placing `geometry` at every [x,y,z] in positions. */
    instances(geometry, mat, positions) {
      const im = new THREE.InstancedMesh(geometry, mat, positions.length);
      const m4 = new THREE.Matrix4();
      positions.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      return shadows(im);
    },
  };
}

// ---------------------------------------------------------------- design A

const ID = 'A';
const ROOF_Y = CONTAINER.roofY;                         // 2.60 roof plate top
const TUBE_TOP = CONTAINER.frameTube.topY;              // 2.62 top-tube top
const TUBE_OUT_Z = CONTAINER.W / 2;                     // 1.50 long-side tube outer face
const TUBE_IN_Z = CONTAINER.frameTube.innerZ;           // 1.40 long-side tube inner face
const TUBE_MID_Z = (TUBE_OUT_Z + TUBE_IN_Z) / 2;        // 1.45 long-side tube centre line

// Frame layout. Corner posts sit at x = ±2.80 (not ±2.85) so the base plate clears the lifting-ring lug
// and the post coupler does not collide with the x = ±2.9 transom coupler.
const POST_X = [-2.80, -0.97, 0.97, 2.80];
const TRANSOM_X = [-2.9, -1.45, 0, 1.45, 2.9];
const LEDGER_HALF = 3.0;                                 // 6 m ledgers
const TRANSOM_HALF = 1.5;                                // 3 m transoms
const PLATE = 0.15, PLATE_T = 0.006;                     // base plate 150×150×6

// Corrugated Al 0.7 mm sheets: 6.4 × 0.9 m, ribs along x, one-rib side laps (ribs nest).
const SHEET = { length: 6.4, width: 0.9, pitch: 0.075, depth: 0.018, thickness: 0.004 };
const SHEET_COUNT = 4;
const SHEET_STEP = SHEET.width - SHEET.pitch;            // 0.825 → 3.375 m total width
const LAP_LIFT = 0.0045;                                 // every 2nd sheet rides one sheet thickness higher
const HOOK_Z_LIMIT = 1.36;                               // keep hook bolts clear of the ledger couplers

/**
 * Ear + U-bolt through the lifting-ring eye, in ring-local coordinates with the post on the −x' side:
 * the U wraps the ring's −x' side bar through the eye, its legs run back through the ear (nuts on the post side).
 */
function buildRingTie(kit, mats) {
  const g = new THREE.Group();
  const cy = CONTAINER.ringCenterY;
  const barX = -CONTAINER.ringR;                         // side bar facing the post
  const earX = barX - 0.02;                              // just clear of the bar (bar surface at −0.051)
  g.add(kit.box([earX - 0.003, TUBE_TOP, -0.03], [earX + 0.003, cy + 0.025, 0.03], mats.steelGalv));
  const ub = uBolt([barX, cy, 0], { r: 0.019, leg: 0.036, rod: 0.005, axis: 'z', mat: mats.zinc });
  ub.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
  g.add(ub);
  return g;
}

/** Hook clamp gripping the long-side top tube over a mid base plate (local x = 0; south tube). */
function buildHookClamp(kit, mats) {
  const g = new THREE.Group();
  const w = 0.015, zn = mats.zinc;
  const yPlate = TUBE_TOP + PLATE_T;
  const zIn = TUBE_MID_Z - PLATE / 2, zOut = TUBE_MID_Z + PLATE / 2;   // base plate edges 1.375 / 1.525
  g.add(kit.box([-w, yPlate, zIn - 0.006], [w, yPlate + 0.006, zOut + 0.006], zn));          // strap over the plate
  g.add(kit.box([-w, ROOF_Y + 0.004, zIn - 0.006], [w, yPlate, zIn], zn));                   // inner web
  g.add(kit.box([-w, ROOF_Y + 0.004, zIn], [w, ROOF_Y + 0.012, TUBE_IN_Z], zn));             // jaw on the 20 mm tube lip
  g.add(kit.box([-w, 2.47, zOut], [w, yPlate, zOut + 0.006], zn));                           // leg down the outer face
  g.add(kit.bolt([0, 2.56, zOut + 0.006], [0, 0, -1], mats.steelDark,
    { d: 0.01, len: zOut + 0.006 - TUBE_OUT_Z }));                                            // set bolt onto the tube face
  return g;
}

/** Crest (rib top) z positions of a sheet centred at zc; the lapped outer ribs are skipped. */
function sheetCrests(zc) {
  const n = Math.round(SHEET.width / SHEET.pitch);
  const out = [];
  for (let k = 1; k <= n - 2; k++) out.push(zc - SHEET.width / 2 + SHEET.pitch * (k + 0.25));
  return out;
}
const nearest = (list, t) => list.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));

export function build({ mats, params = {} } = {}) {
  const gap = designParam(ID, 'gap', params.gap);
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-A';
  const put = (obj, partKey, name, explodeY) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    group.add(obj);
    return obj;
  };

  // Heights: sheet underside = transom top = roof + gap; everything below stacks pipe-on-pipe.
  const R = PIPE_R;
  const yUnder = ROOF_Y + gap;
  const yTransom = yUnder - R;
  const yLedger = yTransom - 2 * R;
  const yPostTop = yLedger - R;
  const yPlateTop = TUBE_TOP + PLATE_T;

  // 1) posts + base plates (+ ring U-bolts at the corners, hook clamps mid-span)
  const tieProto = buildRingTie(kit, mats);
  const hookProto = buildHookClamp(kit, mats);
  const posts = [];
  for (const sz of [-1, 1]) {
    for (const x of POST_X) {
      const z = sz * TUBE_MID_Z;
      const corner = Math.abs(x) > 2;
      const g = new THREE.Group();
      g.add(kit.box([x - PLATE / 2, TUBE_TOP, z - PLATE / 2], [x + PLATE / 2, yPlateTop, z + PLATE / 2], mats.steelGalv));
      g.add(kit.cyl([x, yPlateTop, z], [x, yPostTop, z], R, mats.steelGalv, 16));
      if (corner) {
        const sx = Math.sign(x);
        const ring = CONTAINER.liftingRings.find((r) => Math.sign(r.x) === sx && Math.sign(r.z) === sz);
        const fr = ringFrame(ring);
        const postSide = fr.u.dot(new THREE.Vector3(x - ring.x, 0, z - ring.z));
        const tie = tieProto.clone();
        tie.position.copy(fr.origin);
        tie.rotation.y = fr.yaw + (postSide > 0 ? Math.PI : 0);   // keep the post on the tie's −x' side
        g.add(tie);
        // tab extending the base plate under the ear (stops short of the ring's base pad)
        g.add(kit.box([sx * 2.865, TUBE_TOP, sz * 1.462], [sx * 2.912, yPlateTop, sz * 1.498], mats.steelGalv));
      } else {
        for (const dx of [-0.05, 0.05]) {
          const h = hookProto.clone();
          h.position.set(x + dx, 0, 0);
          h.rotation.y = sz < 0 ? Math.PI : 0;
          g.add(h);
        }
      }
      posts.push(put(g, 'post', corner ? '모서리 기둥 + 베이스판 + U볼트' : '중간 기둥 + 베이스판 + 훅클램프', 0.2));
    }
  }

  // 2) 6 m ledgers on the posts + post couplers
  const clampProto = rightAngleClamp([0, 0, 0], mats.zinc, mats.steelDark);
  const coupler = (x, y, z, explodeY) => {
    const c = clampProto.clone();
    c.position.set(x, y, z);
    return put(c, 'clamp', '직교 클램프 φ48.6', explodeY);
  };
  const ledgers = [-1, 1].map((sz) => put(
    kit.cyl([-LEDGER_HALF, yLedger, sz * TUBE_MID_Z], [LEDGER_HALF, yLedger, sz * TUBE_MID_Z], R, mats.steelGalv, 16),
    'pipe', '비계 강관 6m (장선)', 0.55));
  const postCouplers = [];
  for (const sz of [-1, 1]) for (const x of POST_X) postCouplers.push(coupler(x, yPostTop, sz * TUBE_MID_Z, 0.4));

  // 3) 3 m transoms on the ledgers + ledger couplers
  const transoms = TRANSOM_X.map((x) => put(
    kit.cyl([x, yTransom, -TRANSOM_HALF], [x, yTransom, TRANSOM_HALF], R, mats.steelGalv, 16),
    'pipe', '비계 강관 3m (가로대)', 0.9));
  const transomCouplers = [];
  for (const x of TRANSOM_X) for (const sz of [-1, 1]) transomCouplers.push(coupler(x, yLedger + R, sz * TUBE_MID_Z, 0.75));

  // 4) corrugated sheets (white top / silver-foil underside) + hook bolts at the transom crossings
  const sheetProto = corrugatedSheet({ ...SHEET, matTop: mats.whiteMatte, matBottom: mats.silverFoil, segPerPitch: 6 });
  const sheets = [];
  const hookSpots = [];                                   // [x, z, lift]
  for (let i = 0; i < SHEET_COUNT; i++) {
    const zc = (i - (SHEET_COUNT - 1) / 2) * SHEET_STEP;
    const lift = i % 2 ? LAP_LIFT : 0;
    const s = sheetProto.clone();
    s.position.set(0, yUnder + SHEET.depth / 2 + SHEET.thickness / 2 + lift, zc);
    sheets.push(put(s, 'sheet', '알루미늄 골판 0.7mm', 1.4));
    // 2 hook bolts per sheet on the end + centre transoms, 1 on the others → 32
    const crests = sheetCrests(zc);
    const clampZ = (t) => Math.max(-HOOK_Z_LIMIT, Math.min(HOOK_Z_LIMIT, t));
    for (const x of TRANSOM_X) {
      const targets = Math.abs(x) > 2 || x === 0 ? [zc - 0.2, zc + 0.2] : [zc];
      for (const t of targets) hookSpots.push([x, nearest(crests, clampZ(t)), lift]);
    }
  }
  const hookBolts = buildHookBolts(kit, mats, hookSpots, { yUnder, yTransom });
  put(hookBolts, 'clamp', '골판 후크볼트', 1.15);

  // ---------------------------------------------------------------- model
  const parts = [
    { key: 'sheet', name: '알루미늄 골판 0.7mm (6.4×0.9m)', count: sheets.length, objects: sheets },
    { key: 'clamp', name: `직교 클램프 φ48.6 (+골판 후크볼트 ${hookSpots.length})`, count: postCouplers.length + transomCouplers.length,
      objects: [...postCouplers, ...transomCouplers, hookBolts] },
    { key: 'pipe', name: '비계 강관 φ48.6 (6m 장선·3m 가로대)', count: ledgers.length + transoms.length, objects: [...ledgers, ...transoms] },
    { key: 'post', name: '기둥 + 베이스판 (인양고리 U볼트·훅클램프)', count: posts.length, objects: posts },
  ];
  const installSteps = [
    { title: '베이스판·기둥 세우기 + 인양고리 U볼트 결속', minutes: 30, objects: posts },
    { title: '6m 장선 올리기 + 직교 클램프 체결', minutes: 25, objects: [...ledgers, ...postCouplers] },
    { title: '3m 가로대 올리기 + 직교 클램프 체결', minutes: 20, objects: [...transoms, ...transomCouplers] },
    { title: '골판 얹고 후크볼트 체결', minutes: 30, objects: [...sheets, hookBolts] },
  ];
  const anchors = {
    1: new THREE.Vector3(-1.6, yUnder + 0.027, 0.8),                            // sheet top
    2: new THREE.Vector3(1.45, yLedger + R, TUBE_MID_Z),                        // ledger–transom coupler
    3: new THREE.Vector3(-1.9, yLedger, TUBE_MID_Z),                            // 6 m ledger
    4: new THREE.Vector3(POST_X[3], (yPlateTop + yPostTop) / 2, TUBE_MID_Z),    // corner post
  };
  return finishModel({ id: ID, group, parts, installSteps, anchors, gap, topSurfaces: sheets, windLoose: sheets });
}

/** Hook bolts as 4 InstancedMeshes (washer, nut, shank, J-hook under the transom). */
function buildHookBolts(kit, mats, spots, { yUnder, yTransom }) {
  const g = new THREE.Group();
  const crest = yUnder + SHEET.depth + SHEET.thickness;   // rib top of a non-lifted sheet
  const hookR = PIPE_R + 0.004;
  const shankLen = crest + LAP_LIFT - yTransom;
  const gWasher = new THREE.CylinderGeometry(0.012, 0.012, 0.002, 12);
  const gNut = new THREE.CylinderGeometry(0.0085, 0.0085, 0.007, 6);
  const gShank = new THREE.CylinderGeometry(0.004, 0.004, shankLen, 6).translate(0, shankLen / 2, 0);
  const gHook = new THREE.TorusGeometry(hookR, 0.0035, 5, 10, Math.PI).rotateZ(Math.PI);   // lower half wraps the pipe
  const at = (fn) => spots.map(([x, z, lift]) => fn(x, z, lift));
  g.add(kit.instances(gWasher, mats.zinc, at((x, z, l) => [x + hookR, crest + l + 0.001, z])));
  g.add(kit.instances(gNut, mats.zinc, at((x, z, l) => [x + hookR, crest + l + 0.0055, z])));
  g.add(kit.instances(gShank, mats.zinc, at((x, z) => [x + hookR, yTransom, z])));
  g.add(kit.instances(gHook, mats.zinc, at((x, z) => [x, yTransom, z])));
  return g;
}

/**
 * Assemble the DesignModel common to all builders: callouts from config + anchors,
 * gap label/box, shade meshes (every mesh, opaque). Shared by designB.js / designC.js.
 */
export function finishModel({ id, group, parts, installSteps, anchors, gap, topSurfaces, windLoose, update }) {
  const d = DESIGNS[id];
  const shadeMeshes = [];
  group.traverse((o) => {
    if (o.isMesh) {
      o.userData.transmittance = 0;                       // solid sheet / panel / steel: opaque
      shadeMeshes.push(o);
    }
  });
  const rr = CONTAINER.roofRect;
  const y0 = CONTAINER.roofY, y1 = CONTAINER.roofY + gap;
  return {
    id,
    group,
    parts,
    installSteps,
    callouts: d.callouts.map((c) => ({ n: c.n, text: c.text, sub: c.sub, anchor: anchors[c.n].clone() })),
    gapLabel: { text: d.gapText, anchor: new THREE.Vector3(0, (y0 + y1) / 2, 0) },
    shadeMeshes,
    topSurfaces,
    gap: { y0, y1, x0: rr.x0, x1: rr.x1, z0: rr.z0, z1: rr.z1 },
    windLoose,
    update: update || (() => {}),
  };
}
