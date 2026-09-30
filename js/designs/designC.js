// designC.js — 설계안 C: 크로스바·라쳇 스트랩형 (roof rack + ratchet straps).
//
// 6 ㄷ-brackets hook over the long-side top tubes (rubber-lined, saddle on top) and carry 3 crossbars φ48.6.
// Three corrugated reflective sheets lie loose on the crossbars; 4 ratchet straps (2 lengthwise + an X)
// press them down and end in J-hooks through the lifting rings (2 hooks per ring). Tool-free.
// Load path: sheets → crossbars → saddles → brackets → top tube (gravity); uplift → straps → lifting rings.
//
// Sheets are 5.72 m long (doc: 6 m) so their ends clear the lifting rings, which stand 13.6 cm above the
// roof and would otherwise pierce the sheet corners; the straps drop off the sheet ends into the rings.
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { PIPE_R, corrugatedSheet, ribbon, rope, tag, v3 } from '../parts.js';
import { createPartKit, designParam, finishModel, ringFrame } from './designA.js';

const ID = 'C';
const ROOF_Y = CONTAINER.roofY;                         // 2.60
const TUBE_TOP = CONTAINER.frameTube.topY;              // 2.62
const TUBE_OUT_Z = CONTAINER.W / 2;                     // 1.50
const TUBE_IN_Z = CONTAINER.frameTube.innerZ;           // 1.40
const RING_Y = CONTAINER.ringCenterY, RING_R = CONTAINER.ringR;

const CROSSBAR_X = [-2.4, 0, 2.4];
const CROSSBAR_HALF = 1.5;                              // 3.0 m along z

// Corrugated sheets 1.02 (z) × 5.72 (x), ribs along x; centres 1.0 m apart = 13 pitches → 20 mm laps nest.
const SHEET = { length: 5.72, width: 1.02, pitch: 1 / 13, depth: 0.018, thickness: 0.004 };
const SHEET_Z = [-1, 0, 1];
const SHEET_HALF_X = SHEET.length / 2;                  // 2.86
const LAP_LIFT = 0.0045;                                // outer sheets lap over the centre sheet
const OUTER_EDGE = 1 - SHEET.width / 2;                 // 0.49: where the outer sheets start

// ㄷ-bracket
const BR_HW = 0.03;                                     // half width along the tube (60 mm)
const RUB = 0.0012, WEB_T = 0.003;
const WEB_TOP = TUBE_TOP + RUB + WEB_T;

// Straps
const STRAP_W = 0.05;
const STRAP_CLEAR = 0.003;                              // strap rides 3 mm over the rib tops
const LONG_Z = 1.30;                                    // lengthwise straps near the long edges
const STRAP_CLIP_X = SHEET_HALF_X + 0.018;              // straps leave the sheet top 18 mm past the sheet end
// J-hooks, in the ring frame (ring plane x'-y, eye axis z' pointing outward):
const HOOK_DY = 0.008;                                  // lengthwise hook 8 mm above ring centre, diagonal 8 mm below
const HOOK_RHO = 0.017;                                 // bend radius around the side bar (bar r 11 + wire 3.5 + 2.5 clear)
const RING_BAR_X = RING_R * Math.sqrt(1 - (HOOK_DY / RING_R) ** 2);   // side-bar centre |x'| at hook height
const HOOK_X = RING_BAR_X - HOOK_RHO;                   // |x'| where the hook passes through the eye
const EYE_Z = -0.035;                                   // strap eye sits 35 mm inboard of the ring plane
const EYE_W = 0.044;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** ㄷ-bracket over the south tube at local x = 0 (rubber lining, channel, saddle + cheeks cradling the bar). */
function bracket(kit, mats, yBarBottom, yBarAxis) {
  const g = new THREE.Group();
  const zi = TUBE_IN_Z, zo = TUBE_OUT_Z, hw = BR_HW;
  const yInBot = ROOF_Y + 0.0035;                       // inner lip is only 20 mm tall above the roof plate
  const yOutBot = TUBE_TOP - 0.064;                     // outer leg ~60 mm down the tube face
  const rub = mats.rubber, st = mats.steelGalv;
  // rubber lining
  g.add(kit.box([-hw, TUBE_TOP, zi], [hw, TUBE_TOP + RUB, zo], rub));
  g.add(kit.box([-hw, yOutBot + 0.004, zo], [hw, TUBE_TOP + RUB, zo + RUB], rub));
  g.add(kit.box([-hw, yInBot, zi - RUB], [hw, TUBE_TOP + RUB, zi], rub));
  // channel: web, outer leg, inner leg
  const zw0 = zi - RUB - WEB_T, zw1 = zo + RUB + WEB_T;
  const slotted = yBarBottom < WEB_TOP + 0.001;         // low bar: it nests in a slot cut in the web
  if (slotted) {
    for (const s of [-1, 1]) g.add(kit.box([s * 0.015, TUBE_TOP + RUB, zw0], [s * hw, WEB_TOP, zw1], st));
  } else {
    g.add(kit.box([-hw, TUBE_TOP + RUB, zw0], [hw, WEB_TOP, zw1], st));
  }
  g.add(kit.box([-hw, yOutBot, zo + RUB], [hw, WEB_TOP, zw1], st));
  g.add(kit.box([-hw, yInBot, zw0], [hw, WEB_TOP, zi - RUB], st));
  // saddle block + rubber seat (height = gap − bar diameter − tube lip)
  let yCheek = WEB_TOP;
  if (!slotted) {
    const padT = Math.min(0.0015, (yBarBottom - WEB_TOP) / 2);
    g.add(kit.box([-hw, WEB_TOP, zi], [hw, yBarBottom - padT, zo], st));
    g.add(kit.box([-0.02, yBarBottom - padT, zi + 0.01], [0.02, yBarBottom, zo - 0.01], rub));
    yCheek = yBarBottom - padT;
  }
  for (const s of [-1, 1]) {
    g.add(kit.box([s * (PIPE_R + 0.001), yCheek, zi + 0.005], [s * (PIPE_R + 0.0055), yBarAxis, zo - 0.005], st));
  }
  return g;
}

/**
 * Strap end fitting in ring-local coordinates: eye bar (strap loop) inboard of the ring plane and a J-hook
 * that runs out through the eye and bends around the side bar at x' = side·RING_BAR_X (pull bears on its outer face).
 */
function hookAssembly(kit, mats, y, side) {
  const g = new THREE.Group();
  const x0 = side * HOOK_X;
  g.add(kit.box([x0 - EYE_W / 2, y - 0.003, EYE_Z - 0.004], [x0 + EYE_W / 2, y + 0.003, EYE_Z + 0.004], mats.zinc));
  const J = [v3(x0, y, EYE_Z), v3(x0, y, -0.012)];
  for (let a = 0; a <= 240; a += 30) {
    const r = (a * Math.PI) / 180;
    J.push(v3(side * (RING_BAR_X - HOOK_RHO * Math.cos(r)), y, HOOK_RHO * Math.sin(r)));
  }
  g.add(rope(J, 0.0035, mats.zinc, 32));
  return g;
}

/** Ratchet buckle, local x along the strap, base on the strap (y = 0). */
function buckle(kit, mats) {
  const g = new THREE.Group(), m = mats.ratchet;
  g.add(kit.box([-0.065, 0, -0.03], [0.065, 0.004, 0.03], m));                        // base frame
  for (const s of [-1, 1]) g.add(kit.box([-0.05, 0.004, s * 0.026], [0.035, 0.034, s * 0.03], m)); // cheeks
  g.add(kit.cyl([-0.02, 0.02, -0.026], [-0.02, 0.02, 0.026], 0.013, m, 12));         // spool
  g.add(kit.box([-0.01, 0.028, -0.022], [0.075, 0.034, 0.022], m));                   // handle
  return g;
}

/** Polyline (monotonic in x) clipped to |x| ≤ xLim at both ends, resampled every `step`. */
function clipAndSample(plan, xLim, step = 0.05) {
  const P = plan.map(([x, z]) => ({ x, z }));
  const cut = (a, b, x) => ({ x, z: a.z + ((x - a.x) / (b.x - a.x)) * (b.z - a.z) });
  P[0] = cut(P[0], P[1], -xLim);
  P[P.length - 1] = cut(P[P.length - 2], P[P.length - 1], xLim);
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let j = 0; j < n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n });
  }
  out.push(P[P.length - 1]);
  return out;
}

export function build({ mats, params = {} } = {}) {
  const gap = designParam(ID, 'gap', params.gap);       // params.strapLC is physics-only
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-C';
  const put = (obj, partKey, name, explodeY) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    group.add(obj);
    return obj;
  };

  const yUnder = ROOF_Y + gap;                          // sheet underside = crossbar top
  const yBarAxis = yUnder - PIPE_R;
  const yBarBottom = yUnder - 2 * PIPE_R;
  const crest = yUnder + SHEET.depth + SHEET.thickness; // rib top of the (lower) centre sheet

  // 1) ㄷ-brackets on the long-side top tubes
  const brProto = bracket(kit, mats, yBarBottom, yBarAxis);
  const brackets = [];
  for (const sz of [-1, 1]) {
    for (const x of CROSSBAR_X) {
      const b = brProto.clone();
      b.position.set(x, 0, 0);
      b.rotation.y = sz < 0 ? Math.PI : 0;
      brackets.push(put(b, 'bracket', 'ㄷ자 브래킷 (상부 각관 걸침)', 0.15));
    }
  }

  // 2) crossbars
  const crossbars = CROSSBAR_X.map((x) => put(
    kit.cyl([x, yBarAxis, -CROSSBAR_HALF], [x, yBarAxis, CROSSBAR_HALF], PIPE_R, mats.steelGalv, 20),
    'crossbar', '크로스바 φ48.6 3m', 0.5));

  // 3) corrugated reflective sheets (outer two lap over the centre one)
  const sheetProto = corrugatedSheet({ ...SHEET, matTop: mats.whiteMatte, matBottom: mats.silverFoil, segPerPitch: 6 });
  const sheets = SHEET_Z.map((z) => {
    const s = sheetProto.clone();
    const lift = z === 0 ? 0 : LAP_LIFT;
    s.position.set(0, yUnder + SHEET.depth / 2 + SHEET.thickness / 2 + lift, z);
    return put(s, 'sheet', '반사 골판 1×6m', 1.1);
  });
  // strap bed height at centre-line z: the lift is complete before the strap's edge reaches the lap
  const topAt = (z) => crest + LAP_LIFT * smooth(OUTER_EDGE - STRAP_W, OUTER_EDGE - STRAP_W / 2, Math.abs(z));

  // 4) ratchet straps → J-hooks through the lifting-ring eyes (2 per ring, one on each side bar)
  const ringAt = (sx, sz) => CONTAINER.liftingRings.find((r) => Math.sign(r.x) === sx && Math.sign(r.z) === sz);
  /** Where a strap ends on ring (sx, sz): lengthwise straps take the side bar nearer the container's x-centre. */
  const strapEnd = (sx, sz, upper) => {
    const fr = ringFrame(ringAt(sx, sz));
    const side = (upper ? -1 : 1) * sx * sz;             // side bar at x' = side·barX in the ring frame
    const y = RING_Y + (upper ? HOOK_DY : -HOOK_DY);
    const eye = fr.toWorld(side * HOOK_X, y, EYE_Z);
    const hook = hookAssembly(kit, mats, y, side);
    hook.position.copy(fr.origin);
    hook.rotation.y = fr.yaw;
    // strap tail: leave the sheet top, drop to the eye, arrive along the eye axis
    const tail = [fr.toWorld(side * HOOK_X, y + 0.002, EYE_Z - 0.012), eye];
    return { eye, hook, tail };
  };
  const buckleProto = buckle(kit, mats);
  const strapDefs = [
    { name: '라쳇 스트랩 (북측 길이방향)', upper: true, ends: [[-1, -1], [1, -1]], at: [0.6, -LONG_Z], via: [[-2.45, -LONG_Z], [2.45, -LONG_Z]] },
    { name: '라쳇 스트랩 (남측 길이방향)', upper: true, ends: [[-1, 1], [1, 1]], at: [-0.6, LONG_Z], via: [[-2.45, LONG_Z], [2.45, LONG_Z]] },
    { name: '라쳇 스트랩 (대각 1)', upper: false, ends: [[-1, -1], [1, 1]], at: [-0.69, -0.34], via: [] },
    { name: '라쳇 스트랩 (대각 2)', upper: false, ends: [[-1, 1], [1, -1]], at: [0.69, -0.34], via: [], bump: true },
  ];
  let strapAnchor = null;
  const straps = strapDefs.map((def) => {
    const g = new THREE.Group();
    const [west, east] = def.ends.map(([sx, sz]) => strapEnd(sx, sz, def.upper));
    // lengthwise straps ride over the diagonals near the rings; diagonal 2 rides over diagonal 1 at the X
    const extra = (x, z) => (def.upper ? LAP_LIFT * smooth(2.45, 2.6, Math.abs(x)) : 0)
      + (def.bump ? LAP_LIFT * (1 - smooth(0.08, 0.25, Math.hypot(x, z))) : 0);
    const plan = [[west.eye.x, west.eye.z], ...def.via, [east.eye.x, east.eye.z]];
    const pts = clipAndSample(plan, STRAP_CLIP_X).map(({ x, z }) => v3(x, topAt(z) + STRAP_CLEAR + extra(x, z), z));
    pts.unshift(...[...west.tail].reverse());
    pts.push(...east.tail);
    g.add(west.hook, east.hook);
    g.add(ribbon(pts, STRAP_W, mats.strap, v3(0, 0, 1)));
    // ratchet buckle near the middle
    let bi = 1;
    for (let i = 1; i < pts.length - 1; i++) {
      if (Math.hypot(pts[i].x - def.at[0], pts[i].z - def.at[1]) < Math.hypot(pts[bi].x - def.at[0], pts[bi].z - def.at[1])) bi = i;
    }
    const b = buckleProto.clone();
    const dir = pts[bi + 1].clone().sub(pts[bi - 1]);
    b.position.copy(pts[bi]);
    b.rotation.y = Math.atan2(-dir.z, dir.x);
    g.add(b);
    if (def.at[1] > 0 && def.upper) strapAnchor = pts[bi].clone().add(v3(0, 0.035, 0));
    return put(g, 'strap', def.name, 1.5);
  });

  // ---------------------------------------------------------------- model
  const parts = [
    { key: 'sheet', name: '반사 골판 1.02×5.72m (백색/은박)', count: sheets.length, objects: sheets },
    { key: 'strap', name: '라쳇 스트랩 50mm (+J훅)', count: straps.length, objects: straps },
    { key: 'crossbar', name: '크로스바 φ48.6 3m', count: crossbars.length, objects: crossbars },
    { key: 'bracket', name: 'ㄷ자 브래킷 (고무 라이닝·새들)', count: brackets.length, objects: brackets },
  ];
  const installSteps = [
    { title: 'ㄷ자 브래킷 6개 상부 각관에 걸기', minutes: 5, objects: brackets },
    { title: '크로스바 3본 새들에 얹기', minutes: 5, objects: crossbars },
    { title: '반사 골판 3장 깔기 (겹침 20mm)', minutes: 15, objects: sheets },
    { title: '라쳇 스트랩 4본 인양고리 결박 · 조이기', minutes: 12, objects: straps },
  ];
  const anchors = {
    1: new THREE.Vector3(-1.2, crest + LAP_LIFT, 0.8),                             // sheet top
    2: strapAnchor,                                                               // south strap buckle
    3: new THREE.Vector3(CROSSBAR_X[2], yBarAxis, CROSSBAR_HALF),                 // crossbar end
    4: new THREE.Vector3(CROSSBAR_X[1], TUBE_TOP - 0.03, TUBE_OUT_Z + RUB + WEB_T), // bracket outer leg
  };
  return finishModel({ id: ID, group, parts, installSteps, anchors, gap, topSurfaces: sheets, windLoose: sheets });
}
