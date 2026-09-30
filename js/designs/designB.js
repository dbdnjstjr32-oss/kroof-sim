// designB.js — 설계안 B: 태양광 레일형 (solar racking).
//
// Stack (roof → up): EPDM pads 5 mm → 3 lower Al rails 40×40 (along x) → 12 standoffs (height sets the gap)
// → 3 upper Al rails 40×40 → 4 framed reflective panels held by mid/end clamps. Panel underside = roof + gap.
// Load path: panels → clamps → upper rails → standoff bolts → lower rails → L-feet → container:
//   6 beam-clamp L-feet grip the short-side (east/west) top tubes at the rail ends, and
//   4 ring L-feet bolt each lifting ring to the nearest outer-rail end. The lower rails only rest on the
//   roof plate through EPDM pads (allowed by the contract).
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { twoFacePanel, tag } from '../parts.js';
import { createPartKit, designParam, finishModel, ringFrame } from './designA.js';

const ID = 'B';
const ROOF_Y = CONTAINER.roofY;                         // 2.60
const TUBE_TOP = CONTAINER.frameTube.topY;              // 2.62
const TUBE_IN_X = CONTAINER.frameTube.innerX;           // 2.90 short-side tube inner face
const TUBE_OUT_X = CONTAINER.L / 2;                     // 3.00 short-side tube outer face

const RAIL = 0.04;                                      // 40×40 extrusion
const PAD_T = 0.005;                                    // EPDM pad
const RAIL_Z = [-1.1, 0, 1.1];
const LOWER_LEN = 5.8;                                  // ends abut the short-side tube inner faces
const UPPER_LEN = 5.84;                                 // a little longer: room for the end clamps
const LOWER_Y0 = ROOF_Y + PAD_T;                        // 2.605
const LOWER_Y1 = LOWER_Y0 + RAIL;                       // 2.645
const STANDOFF_X = [-2.2, -0.75, 0.75, 2.2];
const PAD_X = [-2.75, -2.2, -0.75, 0.75, 2.2, 2.75];

// Panels 1.42 (x) × 2.9 (z): 1.42 instead of 1.45 so the panel corners clear the lifting rings
// (ring top 2.736 m pokes above the panel underside 2.69–2.75 m).
const PANEL = { w: 1.42, d: 2.9, gap: 0.015, frameH: 0.035, frameW: 0.03, coreT: 0.03 };
const PANEL_PITCH = PANEL.w + PANEL.gap;                // 1.435
const PANEL_X = [-1.5, -0.5, 0.5, 1.5].map((k) => k * PANEL_PITCH);
const PANEL_EDGE_X = 2 * PANEL_PITCH - PANEL.gap / 2;   // 2.8625 outer panel edge
const GAP_X = [-1, 0, 1].map((k) => k * PANEL_PITCH);   // mid-clamp positions

/** Solar-style 40×40 rail: flanges + recessed web (side channels) + top T-slot with a dark floor. Local: axis x, bottom y=0. */
function railProfile(kit, mats, len) {
  const g = new THREE.Group();
  const h = len / 2, al = mats.aluminum;
  g.add(kit.box([-h, 0, -0.02], [h, 0.006, 0.02], al));                   // bottom flange
  g.add(kit.box([-h, 0.006, -0.016], [h, 0.030, 0.016], al));             // web (side channels)
  g.add(kit.box([-h, 0.030, -0.02], [h, 0.036, 0.02], al));               // top flange
  g.add(kit.box([-h, 0.036, -0.02], [h, RAIL, -0.004], al));              // T-slot lips
  g.add(kit.box([-h, 0.036, 0.004], [h, RAIL, 0.02], al));
  g.add(kit.box([-h, 0.036, -0.004], [h, 0.0366, 0.004], mats.steelDark)); // slot floor (dark groove)
  return g;
}

/** Standoff: base plate + spacer post (height h) + bolted side plates tying lower and upper rail. Local origin = lower rail top. */
function standoff(kit, mats, h) {
  const g = new THREE.Group();
  g.add(kit.box([-0.035, 0, -0.02], [0.035, 0.003, 0.02], mats.aluminumAnod));   // base plate in the T-slot
  g.add(kit.box([-0.015, 0.003, -0.015], [0.015, h, 0.015], mats.aluminumAnod)); // spacer post
  for (const s of [-1, 1]) {
    g.add(kit.box([-0.03, -RAIL + 0.005, s * 0.0205], [0.03, h + RAIL - 0.004, s * 0.0245], mats.aluminum));
    for (const y of [-RAIL / 2, h + RAIL / 2]) {
      g.add(kit.hex([0, y, s * 0.0245], [0, 0, s], mats.steelDark, { r: 0.0065, h: 0.004 }));
    }
  }
  return g;
}

/** Framed reflective panel: 35 mm Al frame, composite core (white top / silver-foil underside). Local origin = centre of underside. */
function reflectivePanel(kit, mats) {
  const g = new THREE.Group();
  const { w, d, frameH, frameW, coreT } = PANEL;
  const core = twoFacePanel(w - 2 * frameW, d - 2 * frameW, coreT, mats.whiteMatte, mats.silverFoil, mats.panelEdge);
  core.name = 'panel-core';
  core.position.y = 0.003 + coreT / 2;
  g.add(core);
  for (const s of [-1, 1]) {
    g.add(kit.box([s * (w / 2 - frameW), 0, -d / 2], [s * w / 2, frameH, d / 2], mats.aluminum));
    g.add(kit.box([-(w / 2 - frameW), 0, s * (d / 2 - frameW)], [w / 2 - frameW, frameH, s * d / 2], mats.aluminum));
  }
  return g;
}

/** Mid clamp: web in the 15 mm panel gap + cap over both frames + bolt into the rail slot. Local origin = gap centre on rail top. */
function midClamp(kit, mats) {
  const g = new THREE.Group();
  const top = PANEL.frameH;
  g.add(kit.box([-0.006, 0, -0.015], [0.006, top, 0.015], mats.aluminum));
  g.add(kit.box([-0.025, top, -0.02], [0.025, top + 0.007, 0.02], mats.aluminum));
  g.add(kit.bolt([0, top + 0.007, 0], [0, -1, 0], mats.steelDark, { d: 0.008, len: top + 0.017 }));
  return g;
}

/** End clamp: body beside the outer frame + lip over it + bolt. Local origin = panel edge on rail top (east). */
function endClamp(kit, mats) {
  const g = new THREE.Group();
  const top = PANEL.frameH;
  g.add(kit.box([0.001, 0, -0.02], [0.026, top, 0.02], mats.aluminum));
  g.add(kit.box([-0.012, top, -0.02], [0.026, top + 0.006, 0.02], mats.aluminum));
  g.add(kit.bolt([0.0135, top + 0.006, 0], [0, -1, 0], mats.steelDark, { d: 0.008, len: top + 0.016 }));
  return g;
}

/**
 * Beam-clamp L-foot on a short-side top tube at a lower-rail end.
 * sx: east (+1) / west (-1); side: which side of the rail (±z) the foot sits on.
 */
function beamLFoot(kit, mats, sx, zr, side) {
  const g = new THREE.Group();
  const X = (v) => sx * v;
  const zA = zr + side * 0.02, zB = zr + side * 0.07, zm = (zA + zB) / 2;
  const zn = mats.zinc, al = mats.aluminum;
  const legX = TUBE_OUT_X + 0.012;                                                     // outer leg stands off the face
  g.add(kit.box([X(TUBE_IN_X - 0.006), TUBE_TOP, zA], [X(legX + 0.006), TUBE_TOP + 0.006, zB], zn));   // top plate
  g.add(kit.box([X(TUBE_IN_X - 0.006), ROOF_Y + 0.004, zA], [X(TUBE_IN_X), TUBE_TOP, zB], zn));        // jaw on the inner lip
  g.add(kit.box([X(legX), 2.47, zA], [X(legX + 0.006), TUBE_TOP, zB], zn));                            // leg down the end wall
  g.add(kit.bolt([X(legX + 0.006), 2.55, zm], [-sx, 0, 0], mats.steelDark, { d: 0.01, len: legX + 0.006 - TUBE_OUT_X }));
  // L bracket bolted to the side of the lower rail
  const zL0 = zr + side * 0.0205, zL1 = zr + side * 0.0265;
  g.add(kit.box([X(TUBE_IN_X), TUBE_TOP + 0.006, zL0], [X(2.99), LOWER_Y1 + 0.003, zL1], al));          // over the tube
  g.add(kit.box([X(2.85), LOWER_Y0 + 0.005, zL0], [X(TUBE_IN_X - 0.006), LOWER_Y1 + 0.003, zL1], al));  // alongside the rail end
  g.add(kit.hex([X(2.872), LOWER_Y0 + RAIL / 2, zL1], [0, 0, side], mats.steelDark, { r: 0.0075, h: 0.005 }));
  return g;
}

/**
 * Ring L-foot: two plates clamp the lifting-ring bar, squeezed by one bolt through the eye (modelled in the
 * ring frame, above the ring's keeper lug), plus a flat arm over the tube to a tab bolted on the outer-rail end.
 */
function ringLFoot(kit, mats, ring) {
  const g = new THREE.Group();
  const fr = ringFrame(ring);
  const { sx, sz } = fr;
  const cy = CONTAINER.ringCenterY, rt = CONTAINER.ringBarR;
  const al = mats.aluminum, zn = mats.zinc;
  const yLo = 2.666;                                      // keeper lug top = 2.662
  const clamp = new THREE.Group();                        // ring-local: ring plane x'-y, eye axis z' (outward)
  clamp.add(kit.box([-0.05, yLo, -rt - 0.006], [0.05, cy + 0.035, -rt - 0.0005], al));        // inboard plate
  clamp.add(kit.box([-0.03, yLo, rt + 0.0005], [0.03, 2 * cy - yLo, rt + 0.0045], al));       // outboard plate
  clamp.add(kit.bolt([0, cy, -rt - 0.006], [0, 0, 1], zn, { d: 0.012, len: 2 * rt + 0.0145 }));
  clamp.add(kit.hex([0, cy, rt + 0.0045], [0, 0, 1], zn, { r: 0.011, h: 0.008 }));
  clamp.position.copy(fr.origin);
  clamp.rotation.y = fr.yaw;
  g.add(clamp);
  const railFace = Math.abs(RAIL_Z[2]) + RAIL / 2 + 0.0005;
  const X = (v) => sx * v, Z = (v) => sz * v;
  g.add(kit.box([X(2.855), LOWER_Y0 + 0.005, Z(railFace)], [X(2.895), yLo + 0.006, Z(railFace + 0.006)], al));   // tab on the rail
  g.add(kit.hex([X(2.875), LOWER_Y0 + RAIL / 2, Z(railFace + 0.006)], [0, 0, sz], mats.steelDark, { r: 0.0075, h: 0.005 }));
  g.add(kit.bar([X(2.875), yLo + 0.003, Z(railFace + 0.006)], fr.toWorld(0, yLo + 0.003, -rt - 0.006), 0.04, 0.006, al)); // arm
  return g;
}

export function build({ mats, params = {} } = {}) {
  const gap = designParam(ID, 'gap', params.gap);
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-B';
  const put = (obj, partKey, name, explodeY) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    group.add(obj);
    return obj;
  };

  const yPanel = ROOF_Y + gap;                  // panel underside = upper-rail top
  const yUpper0 = yPanel - RAIL;
  const standoffH = Math.max(0.005, yUpper0 - LOWER_Y1);

  // 1) L-feet: 6 beam clamps on the E/W tubes + 4 ring brackets
  const lfeet = [];
  for (const zr of RAIL_Z) {
    const side = zr > 0.5 ? -1 : 1;             // outer rails: foot on the inboard side (ring bracket takes the outboard side)
    for (const sx of [-1, 1]) lfeet.push(put(beamLFoot(kit, mats, sx, zr, side), 'lfoot', 'L-피트 (상부 각관 빔클램프)', 0.15));
  }
  for (const ring of CONTAINER.liftingRings) lfeet.push(put(ringLFoot(kit, mats, ring), 'lfoot', 'L-피트 (인양고리 볼트)', 0.15));

  // 2) lower rails on EPDM pads
  const lowerProto = railProfile(kit, mats, LOWER_LEN);
  for (const x of PAD_X) lowerProto.add(kit.box([x - 0.05, -PAD_T, -0.03], [x + 0.05, 0, 0.03], mats.rubber));
  const lowerRails = RAIL_Z.map((zr) => {
    const r = lowerProto.clone();
    r.position.set(0, LOWER_Y0, zr);
    return put(r, 'rail', '하부 Al 레일 40×40 + EPDM 패드', 0.4);
  });

  // 3) standoffs + upper rails
  const soProto = standoff(kit, mats, standoffH);
  const standoffs = [];
  for (const zr of RAIL_Z) {
    for (const x of STANDOFF_X) {
      const s = soProto.clone();
      s.position.set(x, LOWER_Y1, zr);
      standoffs.push(put(s, 'standoff', '스탠드오프', 0.65));
    }
  }
  const upperProto = railProfile(kit, mats, UPPER_LEN);
  const upperRails = RAIL_Z.map((zr) => {
    const r = upperProto.clone();
    r.position.set(0, yUpper0, zr);
    return put(r, 'rail', '상부 Al 레일 40×40', 0.9);
  });

  // 4) framed reflective panels
  const panelProto = reflectivePanel(kit, mats);
  const panels = PANEL_X.map((x) => {
    const p = panelProto.clone();
    p.position.set(x, yPanel, 0);
    return put(p, 'panel', '프레임 반사 패널', 1.35);
  });
  const cores = panels.map((p) => p.getObjectByName('panel-core'));

  // 5) mid clamps (in the panel gaps) + end clamps (rail ends)
  const midProto = midClamp(kit, mats), endProto = endClamp(kit, mats);
  const clamps = [];
  for (const zr of RAIL_Z) {
    for (const x of GAP_X) {
      const c = midProto.clone();
      c.position.set(x, yPanel, zr);
      clamps.push(put(c, 'clamp', '미드 클램프', 1.75));
    }
    for (const sx of [-1, 1]) {
      const c = endProto.clone();
      c.position.set(sx * PANEL_EDGE_X, yPanel, zr);
      c.rotation.y = sx < 0 ? Math.PI : 0;
      clamps.push(put(c, 'clamp', '엔드 클램프', 1.75));
    }
  }

  // ---------------------------------------------------------------- model
  const parts = [
    { key: 'clamp', name: '미드/엔드 클램프', count: clamps.length, objects: clamps },
    { key: 'panel', name: '프레임 반사 패널 1.42×2.9m', count: panels.length, objects: panels },
    { key: 'rail', name: 'Al 레일 40×40 (하부·상부)', count: lowerRails.length + upperRails.length, objects: [...lowerRails, ...upperRails] },
    { key: 'standoff', name: '스탠드오프', count: standoffs.length, objects: standoffs },
    { key: 'lfoot', name: 'L-피트 (빔클램프·인양고리 볼트)', count: lfeet.length, objects: lfeet },
  ];
  const installSteps = [
    { title: 'L-피트 빔클램프 · 인양고리 볼트 체결', minutes: 35, objects: lfeet },
    { title: '하부 레일 + EPDM 패드 깔기', minutes: 25, objects: lowerRails },
    { title: '스탠드오프 + 상부 레일 조립', minutes: 40, objects: [...standoffs, ...upperRails] },
    { title: '반사 패널 4장 얹기', minutes: 30, objects: panels },
    { title: '미드/엔드 클램프 체결', minutes: 20, objects: clamps },
  ];
  const anchors = {
    1: new THREE.Vector3(0, yPanel + PANEL.frameH + 0.007, RAIL_Z[2]),              // mid clamp
    2: new THREE.Vector3(-2.15, yPanel + PANEL.frameH, 0.6),                        // panel top
    3: new THREE.Vector3(2.9, yUpper0 + RAIL / 2, RAIL_Z[1]),                       // upper rail end
    4: new THREE.Vector3(TUBE_OUT_X + 0.018, 2.56, RAIL_Z[2] - 0.045),              // beam-clamp L-foot
  };
  return finishModel({ id: ID, group, parts, installSteps, anchors, gap, topSurfaces: cores, windLoose: panels });
}
