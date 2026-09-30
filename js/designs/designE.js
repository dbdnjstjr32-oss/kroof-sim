// designE.js — Design E 다리 달린 인터로킹 패널형 (legged interlocking panels).
//
// 20 aluminium panel units 1.4 × 0.6 m (4 cols × 5 rows, see DESIGNS.E.layout) with four bent-down
// legs each stand on Dual Lock pads on the roof plate. A male tongue lip on the +x / +z edges slides
// into the neighbour's female hook lip on its −x / −z edge (31 joints), so the field behaves as one
// plate. 12 quick-release cam levers hook the outer panel edges to the perimeter top tube.
//
// params.gap = leg height = clear height roof top (2.60) → panel underside
import * as THREE from 'three';
import { DESIGNS, CONTAINER } from '../config.js';
import { tag, twoFacePanel } from '../parts.js';

const DES = DESIGNS.E;
const { cols: COLS, rows: ROWS, panelL: PL, panelW: PW } = DES.layout;   // 4 × 5, 1.4 × 0.6 m
const ROOF_Y = CONTAINER.roofY;                     // 2.60 roof plate top
const TUBE = CONTAINER.frameTube;                   // perimeter top tube 2.52–2.62
const HALF_L = CONTAINER.L / 2, HALF_W = CONTAINER.W / 2;
const FIELD_HX = (COLS * PL) / 2, FIELD_HZ = (ROWS * PW) / 2;   // 2.8 × 1.5 panel field

// Panel unit, panel-local frame: origin at the plan centre, y = 0 at the panel underside.
const PANEL_T = 0.004;                              // visual thickness (real sheet: Al 1.0 mm)
// Leg tabs: inset so that even the outer-row / end-column feet land on the roof plate
// (roof plate inside x ±2.90, z ±1.40; outer-row tab at z = 1.2 + 0.17 = 1.37).
const LEG_X = 0.62, LEG_Z = 0.17;
const LEG_W = 0.05, TAB_T = 0.003, FOOT_L = 0.05, FOOT_T = 0.003;
const PAD_S = 0.025, PAD_T = 0.004;                 // Dual Lock pad 25 × 25 × 4 mm
const X_SPAN = PW / 2 - 0.05;                       // lip half-length along the short edges
const Z_SPAN = PL / 2 - 0.10;                       // lip half-length along the long edges
// Bent lip profiles [u0, u1, y0, y1]: u = inward distance from the edge (negative = beyond the edge).
const FEMALE = [[0.045, 0.048, -0.017, 0], [0.004, 0.048, -0.017, -0.014], [0.004, 0.007, -0.017, -0.012]];
const MALE = [[0.010, 0.040, -0.003, 0], [0.010, 0.013, -0.011, -0.003], [-0.035, 0.013, -0.011, -0.008]];

// Cam lever hook (local frame: origin on the panel top at the edge, +z = outward, x along the edge)
const HOOK_R = 0.004, HOOK_OFF = 0.016, HOOK_TIP = HOOK_R + 0.001, HOOK_BEND = 0.010;

// ---------------------------------------------------------------- small local helpers

function readParam(params, key) {
  const p = DES.params[key];
  const v = Number(params?.[key]);
  return Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
}

/** Box geometry spanning [x0,x1]×[y0,y1]×[z0,z1] (bounds in any order). */
function boxSpan([x0, x1], [y0, y1], [z0, z1]) {
  return new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))
    .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
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

// ---------------------------------------------------------------- panel unit

/** Boxes of a bent lip profile running along one panel edge ('-x' | '+x' | '-z' | '+z'). */
function lipBoxes(edge, profile, span) {
  const hx = PL / 2, hz = PW / 2;
  return profile.map(([u0, u1, y0, y1]) => {
    switch (edge) {
      case '-x': return boxSpan([-hx + u0, -hx + u1], [y0, y1], [-span, span]);
      case '+x': return boxSpan([hx - u1, hx - u0], [y0, y1], [-span, span]);
      case '-z': return boxSpan([-span, span], [y0, y1], [-hz + u0, -hz + u1]);
      default: return boxSpan([-span, span], [y0, y1], [hz - u1, hz - u0]);
    }
  });
}

/**
 * One panel unit: plate (top white / underside silver / edges Al), four bent leg tabs with foot
 * flanges, female hook lips on −x / −z and (where a neighbour exists) male tongues on +x / +z.
 * Material slots: 0 = top, 1 = underside, 2 = bent aluminium.
 */
function panelGeometry(gap, tongueX, tongueZ, plate) {
  const items = [{ g: plate.clone().translate(0, PANEL_T / 2, 0), slots: [2, 2, 0, 1, 2, 2] }];
  const footY = -(gap - PAD_T);                                      // foot underside sits on the pad
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const xr = [sx * LEG_X - LEG_W / 2, sx * LEG_X + LEG_W / 2], z = sz * LEG_Z;
      items.push(
        { g: boxSpan(xr, [footY, 0], [z - TAB_T / 2, z + TAB_T / 2]) },           // leg tab
        { g: boxSpan(xr, [-0.003, 0], [z, z + sz * 0.03]) },                     // bend root under the plate
        { g: boxSpan(xr, [footY, footY + FOOT_T], [z, z - sz * FOOT_L]) },      // foot flange
      );
    }
  }
  const lips = [...lipBoxes('-x', FEMALE, X_SPAN), ...lipBoxes('-z', FEMALE, Z_SPAN)];
  if (tongueX) lips.push(...lipBoxes('+x', MALE, X_SPAN));
  if (tongueZ) lips.push(...lipBoxes('+z', MALE, Z_SPAN));
  for (const g of lips) items.push({ g });
  return mergeBySlot(items.map((it) => ({ slot: 2, ...it })), 3);
}

// ---------------------------------------------------------------- cam lever

/** Centre line of the J-hook: over the panel edge, down the tube's outer face, curl under its lower edge. */
function hookPoints(reach, yTubeBottom) {
  const pts = [];
  const line = (a, b, step = 0.015) => {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let i = 0; i < n; i++) pts.push(a.clone().lerp(b, i / n));
  };
  const arc = (cy, cz, r, a0, a1, n) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector3(0, cy + r * Math.sin(a), cz + r * Math.cos(a)));
    }
  };
  const zDown = reach + HOOK_OFF;                                    // vertical leg, outside the tube face
  const yJ = yTubeBottom - 0.0075;                                   // J curl centre height
  const rJ = (HOOK_OFF - HOOK_TIP) / 2;
  line(new THREE.Vector3(0, 0.015, -0.028), new THREE.Vector3(0, 0.015, zDown - HOOK_BEND));
  arc(0.015 - HOOK_BEND, zDown - HOOK_BEND, HOOK_BEND, Math.PI / 2, 0, 6);
  line(new THREE.Vector3(0, 0.015 - HOOK_BEND, zDown), new THREE.Vector3(0, yJ, zDown));
  arc(yJ, reach + HOOK_TIP + rJ, rJ, 0, -Math.PI, 8);
  line(new THREE.Vector3(0, yJ, reach + HOOK_TIP), new THREE.Vector3(0, yJ + 0.006, reach + HOOK_TIP), 0.003);
  pts.push(new THREE.Vector3(0, yJ + 0.006, reach + HOOK_TIP));
  return pts;
}

/** Cam lever unit: base bracket + barrel + hook (zinc, slot 0), red lever folded flat (slot 1). */
function camGeometry(reach, Ytop) {
  const curve = new THREE.CatmullRomCurve3(hookPoints(reach, TUBE.bottomY - Ytop), false, 'centripetal');
  return mergeBySlot([
    { g: boxSpan([-0.025, 0.025], [0, 0.005], [-0.07, -0.01]), slot: 0 },
    { g: new THREE.CylinderGeometry(0.010, 0.010, 0.046, 12).rotateZ(Math.PI / 2).translate(0, 0.015, -0.028), slot: 0 },
    { g: new THREE.TubeGeometry(curve, Math.round(curve.points.length * 2.5), HOOK_R, 6, false), slot: 0 },
    { g: boxSpan([-0.012, 0.012], [0.003, 0.010], [-0.188, -0.028]), slot: 1 },
  ], 2);
}

// ---------------------------------------------------------------- builder

export function build({ mats, params = {} } = {}) {
  const gap = readParam(params, 'gap');
  const Yu = ROOF_Y + gap;                                           // panel underside
  const Ytop = Yu + PANEL_T;                                         // panel top surface

  const group = new THREE.Group();
  group.name = 'design-E';
  const plate = new THREE.Group();                                   // interlocked field → lifts as one
  plate.name = 'interlocked-plate';

  // --- panel units (4 shared geometry variants: male tongues only where a neighbour exists)
  const plateSrc = twoFacePanel(PL, PW, PANEL_T, mats.whiteMatte, mats.silverFoil, mats.panelEdge).geometry;
  const variants = new Map();
  const variant = (tx, tz) => {
    const key = `${+tx}${+tz}`;
    if (!variants.has(key)) variants.set(key, panelGeometry(gap, tx, tz, plateSrc));
    return variants.get(key);
  };
  const panelMats = [mats.whiteMatte, mats.silverFoil, mats.panelEdge];
  const panels = [];
  const rowPanels = Array.from({ length: ROWS }, () => []);
  const centres = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = -FIELD_HX + (c + 0.5) * PL, z = -FIELD_HZ + (r + 0.5) * PW;
      const m = new THREE.Mesh(variant(c < COLS - 1, r < ROWS - 1), panelMats);
      m.position.set(x, Yu, z);
      m.name = `panel-r${r + 1}c${c + 1}`;
      m.userData.row = r; m.userData.col = c;
      tag(m, {
        partKey: 'panel', name: '패널 유닛 1.4×0.6m (다리 일체, 맞물림)',
        explode: [(c - (COLS - 1) / 2) * 0.12, 0.7, (r - (ROWS - 1) / 2) * 0.15], transmittance: 0,
      });
      panels.push(m); rowPanels[r].push(m); centres.push([x, z]);
    }
  }
  plateSrc.dispose();

  // --- Dual Lock pads under every foot (80, instanced)
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(PAD_S, PAD_T, PAD_S), mats.velcro, centres.length * 4);
  const mtx = new THREE.Matrix4();
  let n = 0;
  for (const [x, z] of centres) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pads.setMatrixAt(n++, mtx.makeTranslation(x + sx * LEG_X, ROOF_Y + PAD_T / 2, z + sz * (LEG_Z - FOOT_L / 2)));
      }
    }
  }
  pads.instanceMatrix.needsUpdate = true;
  pads.computeBoundingSphere();
  pads.name = 'dual-lock-pads';
  tag(pads, { partKey: 'pad', name: 'Dual Lock 패드 (보조 고정)', explode: [0, 0.2, 0] });

  plate.add(pads, ...panels);

  // --- 12 cam levers: 4 per long side at the panel centres, 2 per short side at z = ±0.75
  const camMats = [mats.zinc, mats.camLever];
  const camLong = camGeometry(HALF_W - FIELD_HZ, Ytop);              // panel edge flush with the tube face
  const camShort = camGeometry(HALF_L - FIELD_HX, Ytop);             // 0.2 m reach over roof edge + tube
  const camSpots = [];
  for (const sz of [-1, 1]) for (const x of [-2.1, -0.7, 0.7, 2.1]) camSpots.push({ p: [x, sz * FIELD_HZ], out: [0, sz] });
  for (const sx of [-1, 1]) for (const z of [-0.75, 0.75]) camSpots.push({ p: [sx * FIELD_HX, z], out: [sx, 0] });
  const cams = camSpots.map(({ p, out }) => {
    const m = new THREE.Mesh(out[0] === 0 ? camLong : camShort, camMats);
    m.position.set(p[0], Ytop, p[1]);
    m.rotation.y = Math.atan2(out[0], out[1]);                       // local +z → outward
    m.name = 'cam-lever';
    return tag(m, { partKey: 'cam', name: '캠레버 (퀵릴리즈)', explode: [out[0] * 0.3, 1.1, out[1] * 0.3] });
  });

  group.add(plate, ...cams);

  // --- annotations
  const southCam = cams.find((m) => m.position.z > 0 && Math.abs(m.position.x - 0.7) < 1e-6) || cams[0];
  const anchors = [
    new THREE.Vector3(-0.7, Ytop, -0.6),                                                   // 1 panel
    new THREE.Vector3(0, Yu - 0.0095, FIELD_HZ - PW / 2 + X_SPAN),                        // 2 x-seam joint, south row
    new THREE.Vector3(southCam.position.x, Ytop + 0.01, FIELD_HZ - 0.1),                  // 3 cam lever
    new THREE.Vector3(0.7 + LEG_X, ROOF_Y + PAD_T / 2, FIELD_HZ - PW / 2 + LEG_Z - FOOT_L / 2),   // 4 pad
  ];
  const callouts = DES.callouts.map((c, i) => ({ ...c, anchor: anchors[i] }));

  const rowNames = ['1열(북측)', '2열', '3열', '4열', '5열(남측)'];
  return {
    id: 'E',
    group,
    parts: [
      { key: 'panel', name: '패널 유닛 (다리 일체, 맞물림)', count: panels.length, objects: panels },
      { key: 'cam', name: '캠레버', count: cams.length, objects: cams },
      { key: 'pad', name: 'Dual Lock', count: centres.length * 4, objects: [pads] },
    ],
    installSteps: [
      { title: `Dual Lock 패드 부착 (${centres.length * 4}개)`, minutes: 8, objects: [pads] },
      ...rowPanels.map((objs, r) => ({
        title: `패널 ${rowNames[r] || `${r + 1}열`} ${objs.length}장 맞물려 깔기`, minutes: 4, objects: objs,
      })),
      { title: `캠레버 ${cams.length}개 잠금`, minutes: 7, objects: cams },
    ],
    callouts,
    gapLabel: { text: DES.gapText, anchor: new THREE.Vector3(0, ROOF_Y + gap / 2, 0) },
    shadeMeshes: panels,
    topSurfaces: panels,
    gap: {
      y0: ROOF_Y, y1: Yu,
      x0: -FIELD_HX, x1: FIELD_HX,
      z0: CONTAINER.roofRect.z0, z1: CONTAINER.roofRect.z1,
    },
    windLoose: [plate],
    update() {},                                                     // static design
  };
}
