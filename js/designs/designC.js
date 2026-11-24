// designC.js — C안: ACP 차열 이중지붕 (ACP 4T + 110mm 공기층 + 모듈식 무천공 탈부착).
//
// Vertical stack (roofY = 2.800 m -> ACP underside = 2.910 m, exact 110 mm air gap):
//   - 10 Grooved EPDM rubber pads (100x100x10 mm): 2.800 .. 2.810
//   - 10 Adjustable galvanized levelers with U-saddle cradle & nuts (+-20 mm range): 2.810 .. 2.830
//   - 5 Hollow galvanized steel crossbars (100x50x2.9T, L=3.2 m) + end plugs: 2.830 .. 2.880
//   - 12 Modules: 30x30x1.6T hollow galvanized subframes (with center rib & corner gussets) + 3-layer ACP 4T sheet: 2.880 .. 2.918
//   - 48 Stainless toggle draw latches + catch hooks locking module ribs to crossbars
//   - 8 Ratchet straps (50 mm twill webbing + coiled ratchet buckle + D-ring + twin J-hook) + 4 forged M12 beam clamps
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { acpSandwichPanel, tag } from '../parts.js';
import { createPartKit, mergeByMaterial, buildCrossbarStrap, finishModel } from './kit.js';

const ID = 'C';
const ROOF_Y = CONTAINER.roofY;        // 2.800 m
const GAP = 0.110;                     // 110 mm
const CROSSBAR_X = [-2.95, -1.50, 0.0, 1.50, 2.95];
const CROSSBAR_LEN = 3.20;
const CROSSBAR_HALF = CROSSBAR_LEN / 2;
const CROSSBAR_W = 0.100;              // 100 mm along x
const CROSSBAR_H = 0.050;              // 50 mm along y
const CROSSBAR_T = 0.0029;
const PAD_H = 0.010;                   // 10 mm rubber pad
const LEVELER_H = 0.020;               // 20 mm nominal leveler stem height
const RIB_SIZE = 0.030;                // 30x30 mm hollow panel stiffener
const RIB_T = 0.0016;
const ACP_T = 0.008;                   // drawn ACP thickness

const Y_PAD0 = ROOF_Y;                 // 2.800
const Y_PAD1 = Y_PAD0 + PAD_H;         // 2.810
const Y_LEV1 = Y_PAD1 + LEVELER_H;     // 2.830
const Y_BAR1 = Y_LEV1 + CROSSBAR_H;    // 2.880
const Y_ACP0 = Y_BAR1 + RIB_SIZE;      // 2.910 (= ROOF_Y + 0.110)

const STRAP_X = [-2.95, -1.50, 0.0, 2.95]; // 8 straps total (skip south door at x=+1.50)

function buildPad(kit, mats) {
  const raw = new THREE.Group();
  // Molded 100x100x10mm EPDM rubber pad with chamfered top block & 3 anti-slip grooves
  raw.add(kit.box([-0.050, 0, -0.050], [0.050, 0.007, 0.050], mats.rubber));
  for (const gx of [-0.030, 0, 0.030]) {
    raw.add(kit.box([gx - 0.012, 0.007, -0.046], [gx + 0.012, 0.010, 0.046], mats.rubber));
  }
  return mergeByMaterial(raw, 'padC');
}

function buildLeveler(kit, mats) {
  const raw = new THREE.Group();
  const h = LEVELER_H; // 0..0.020 local above Y_PAD1
  // Square anchor base plate + 4 stainless corner bolts
  raw.add(kit.box([-0.044, 0, -0.044], [0.044, 0.004, 0.044], mats.zinc));
  for (const bx of [-0.032, 0.032]) for (const bz of [-0.032, 0.032]) {
    raw.add(kit.hex([bx, 0.004, bz], [0, 1, 0], mats.stainless, { r: 0.0045, h: 0.003 }));
  }
  // M16 threaded stem + hex height-adjustment nut + washer
  raw.add(kit.cyl([0, 0.004, 0], [0, h - 0.004, 0], 0.0095, mats.steelDark, 10));
  raw.add(kit.cyl([0, 0.0045, 0], [0, 0.0065, 0], 0.018, mats.stainless, 12));
  raw.add(kit.hex([0, 0.0065, 0], [0, 1, 0], mats.zinc, { r: 0.0155, h: 0.0065 }));
  // Upper U-saddle cradling the 100mm crossbar (base at h-0.004..h, side cheeks up to +0.022 above base)
  raw.add(kit.box([-0.054, h - 0.004, -0.042], [0.054, h, 0.042], mats.zinc));
  raw.add(kit.box([-0.055, h, -0.038], [-0.050, h + 0.024, 0.038], mats.zinc));
  raw.add(kit.box([0.050, h, -0.038], [0.055, h + 0.024, 0.038], mats.zinc));
  raw.add(kit.hex([-0.055, h + 0.012, 0], [-1, 0, 0], mats.stainless, { r: 0.0055, h: 0.004 }));
  raw.add(kit.hex([0.055, h + 0.012, 0], [1, 0, 0], mats.stainless, { r: 0.0055, h: 0.004 }));
  return mergeByMaterial(raw, 'levelerC');
}

function buildCrossbar(kit, mats, x) {
  const g = new THREE.Group();
  const yMid = (Y_LEV1 + Y_BAR1) / 2;
  // True hollow 100x50x2.9T galvanized rectangular steel tube
  g.add(kit.hollowTube([x, yMid, -CROSSBAR_HALF + 0.003], [x, yMid, CROSSBAR_HALF - 0.003], CROSSBAR_W, CROSSBAR_H, CROSSBAR_T, mats.steelGalv));
  // Recessed inner dark baffle + molded black plastic end-caps at z = +-1.595
  for (const sz of [-1, 1]) {
    const zPlugOut = sz * (CROSSBAR_HALF - 0.001);
    const zPlugIn = sz * (CROSSBAR_HALF - 0.014);
    g.add(kit.box(
      [x - CROSSBAR_W / 2 + 0.004, yMid - CROSSBAR_H / 2 + 0.004, Math.min(zPlugIn, zPlugOut)],
      [x + CROSSBAR_W / 2 - 0.004, yMid + CROSSBAR_H / 2 - 0.004, Math.max(zPlugIn, zPlugOut)],
      mats.endCap,
    ));
  }
  return g;
}

function buildModuleSubframeProto(kit, mats, modL, modW) {
  const raw = new THREE.Group();
  const yMid = (Y_BAR1 + Y_ACP0) / 2;
  const x0 = -modL / 2, x1 = modL / 2;
  const z0 = -modW / 2, z1 = modW / 2;

  // Left & right end 30x30x1.6T hollow galvanized stiffeners along Z (resting on crossbars)
  raw.add(kit.hollowTube([x0 + RIB_SIZE / 2, yMid, z0 + 0.001], [x0 + RIB_SIZE / 2, yMid, z1 - 0.001], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
  raw.add(kit.hollowTube([x1 - RIB_SIZE / 2, yMid, z0 + 0.001], [x1 - RIB_SIZE / 2, yMid, z1 - 0.001], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
  // Front & back + middle longitudinal 30x30x1.6T hollow stiffeners along X
  raw.add(kit.hollowTube([x0 + RIB_SIZE, yMid, z0 + RIB_SIZE / 2], [x1 - RIB_SIZE, yMid, z0 + RIB_SIZE / 2], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
  raw.add(kit.hollowTube([x0 + RIB_SIZE, yMid, z1 - RIB_SIZE / 2], [x1 - RIB_SIZE, yMid, z1 - RIB_SIZE / 2], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
  raw.add(kit.hollowTube([x0 + RIB_SIZE, yMid, 0], [x1 - RIB_SIZE, yMid, 0], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
  // Recessed black plastic plugs at outer ends of the Z-running end tubes
  for (const sx of [x0 + RIB_SIZE / 2, x1 - RIB_SIZE / 2]) {
    for (const sz of [-1, 1]) {
      const zFace = sz * (modW / 2 - 0.001), zIn = sz * (modW / 2 - 0.012);
      raw.add(kit.box([sx - 0.012, yMid - 0.012, Math.min(zIn, zFace)], [sx + 0.012, yMid + 0.012, Math.max(zIn, zFace)], mats.endCap));
    }
  }
  // 4 corner weld gusset brackets beneath subframe corners
  for (const sx of [x0 + 0.032, x1 - 0.068]) {
    for (const sz of [z0 + 0.032, z1 - 0.068]) {
      raw.add(kit.box([sx, Y_BAR1 + 0.0005, sz], [sx + 0.036, Y_BAR1 + 0.0035, sz + 0.036], mats.zinc));
    }
  }
  return mergeByMaterial(raw, 'subframeC');
}

function buildDrawLatchProto(kit, mats, sideX) {
  const raw = new THREE.Group();
  const s = Math.sign(sideX); // +1 if extending inward +X, -1 if extending -X
  // Latch mounting housing on crossbar side + lever arm + wire toggle loop + strike hook on 30x30 stiffener
  raw.add(kit.box([-0.014, -0.032, -0.020], [0.014, 0, 0.020], mats.stainless));
  raw.add(kit.hex([0, -0.022, -0.012], [s < 0 ? 1 : -1, 0, 0], mats.steelDark, { r: 0.0035, h: 0.018 }));
  raw.add(kit.hex([0, -0.022, 0.012], [s < 0 ? 1 : -1, 0, 0], mats.steelDark, { r: 0.0035, h: 0.018 }));
  // Wire catch loop reaching up onto the 30x30 stiffener strike hook
  raw.add(kit.cyl([s * 0.010, -0.014, -0.013], [s * 0.010, 0.024, -0.013], 0.0025, mats.stainless, 6));
  raw.add(kit.cyl([s * 0.010, -0.014, 0.013], [s * 0.010, 0.024, 0.013], 0.0025, mats.stainless, 6));
  raw.add(kit.cyl([s * 0.010, 0.024, -0.015], [s * 0.010, 0.024, 0.015], 0.0025, mats.stainless, 6));
  // Strike plate riveted to 30x30 stiffener + over-center ergonomic pull tab
  raw.add(kit.box([s * 0.004, 0.014, -0.016], [s * 0.016, 0.028, 0.016], mats.zinc));
  raw.add(kit.box([-0.016, -0.019, -0.011], [0.016, -0.005, 0.011], mats.ratchet));
  return mergeByMaterial(raw, 'drawLatchC');
}

function buildBeamClamp(kit, mats, x, zSign) {
  const raw = new THREE.Group();
  const s = Math.sign(zSign);
  const zIn = s * CONTAINER.frameTube.innerZ;
  const zOut = s * (CONTAINER.W / 2);
  const zEdge = s * 1.485;
  const y0 = ROOF_Y - 0.048;

  // Forged C-shaped beam clamp jaw gripping top flange of container frame & crossbar base
  const zOuter = zOut + s * 0.018;
  raw.add(kit.box([x - 0.024, y0, Math.min(zOut, zOuter)], [x + 0.024, Y_LEV1 + 0.010, Math.max(zOut, zOuter)], mats.zinc));
  raw.add(kit.box([x - 0.024, Y_LEV1, Math.min(zEdge, zOuter)], [x + 0.024, Y_LEV1 + 0.012, Math.max(zEdge, zOuter)], mats.zinc));
  raw.add(kit.box([x - 0.024, y0, Math.min(zIn, zOuter)], [x + 0.024, y0 + 0.016, Math.max(zIn, zOuter)], mats.zinc));
  // M12 threaded clamping bolt + jam nut + square thrust pad
  raw.add(kit.cyl([x, y0 + 0.032, zOut + s * 0.034], [x, y0 + 0.032, zIn + s * 0.012], 0.006, mats.steelDark, 8));
  raw.add(kit.hex([x, y0 + 0.032, zOut + s * 0.024], [0, 0, s], mats.stainless, { r: 0.0105, h: 0.009 }));
  raw.add(kit.box([x - 0.016, y0 + 0.020, zOut - s * 0.006], [x + 0.016, y0 + 0.044, zOut + s * 0.002], mats.zinc));
  return mergeByMaterial(raw, 'beamClampC');
}

export function build({ mats } = {}) {
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-C';

  const put = (obj, partKey, name, explodeY) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    group.add(obj);
    return obj;
  };

  // 1) Molded grooved rubber pads (10 places)
  const padProto = buildPad(kit, mats);
  const pads = [];
  for (const x of CROSSBAR_X) {
    for (const sz of [-1, 1]) {
      const p = padProto.clone();
      p.position.set(x, Y_PAD0, sz * 1.44);
      pads.push(put(p, 'pad', '받침 고무패드 (10곳)', 0.12));
    }
  }

  // 2) Adjustable levelers (10 places)
  const levProto = buildLeveler(kit, mats);
  const levelers = [];
  for (const x of CROSSBAR_X) {
    for (const sz of [-1, 1]) {
      const l = levProto.clone();
      l.position.set(x, Y_PAD1, sz * 1.44);
      levelers.push(put(l, 'leveler', '높이 조절 레벨러 (±20mm, 10곳)', 0.25));
    }
  }

  // 3) 5 Hollow galvanized crossbars (100x50x2.9T, L=3.2 m) + end plugs
  const crossbars = CROSSBAR_X.map((x) => put(
    buildCrossbar(kit, mats, x),
    'crossbar', '아연도금 중공 각관 크로스바 (100×50×2.9T, 3.2m)', 0.45,
  ));

  // 4) 12 ACP 4T 3-layer + 30x30 hollow galvanized stiffener modules (4x3 grid, ~10 mm gap)
  const cols = 4, rows = 3;
  const modL = 1.49, modW = 0.99;
  const subframeProto = buildModuleSubframeProto(kit, mats, modL, modW);
  const latchPosProto = buildDrawLatchProto(kit, mats, 1);
  const latchNegProto = buildDrawLatchProto(kit, mats, -1);

  const modules = [];
  const topSurfaces = [];
  const latches = [];

  for (let ix = 0; ix < cols; ix++) {
    const cx = -2.25 + ix * 1.50;
    for (let iz = 0; iz < rows; iz++) {
      const cz = -1.00 + iz * 1.00;
      const mod = new THREE.Group();

      const sub = subframeProto.clone();
      sub.position.set(cx, 0, cz);
      mod.add(sub);

      const acp = acpSandwichPanel(modL, modW, ACP_T, mats.acpWhiteTop, mats.millAluminum, mats.acpCore, mats.panelEdge);
      acp.position.set(cx, Y_ACP0 + ACP_T / 2, cz);
      mod.add(acp);
      topSurfaces.push(acp);

      modules.push(put(mod, 'panel', 'ACP 4T (3층) + 중공 각관 보강재(30×30) 패널 모듈', 0.95));

      const x0 = cx - modL / 2, x1 = cx + modL / 2;
      for (const lz of [cz - 0.35, cz + 0.35]) {
        const lL = latchPosProto.clone(); lL.position.set(x0 + 0.01, Y_BAR1, lz);
        latches.push(put(lL, 'latch', '드로우 래치 (모듈 고정)', 0.68));
        const lR = latchNegProto.clone(); lR.position.set(x1 - 0.01, Y_BAR1, lz);
        latches.push(put(lR, 'latch', '드로우 래치 (모듈 고정)', 0.68));
      }
    }
  }

  // 5) Crossbar-end D-rings + 50mm woven ratchet straps + twin J-hooks + M12 beam clamps
  const straps = [];
  for (const x of STRAP_X) {
    for (const sz of [-1, 1]) {
      straps.push(put(
        buildCrossbarStrap(kit, mats, {
          x, zSide: sz, yBarTop: Y_BAR1, yBarBot: Y_LEV1, crossbarHalf: CROSSBAR_HALF, crossbarW: CROSSBAR_W,
        }),
        'strap', 'D링 · 라쳇 스트랩(50mm) · 하부 J후크', 0.35,
      ));
    }
  }
  const beamClamps = [];
  for (const x of [1.50, -1.50]) {
    for (const sz of [-1, 1]) {
      beamClamps.push(put(buildBeamClamp(kit, mats, x, sz), 'clamp', 'M12 빔 클램프 (보조 고정)', 0.25));
    }
  }

  // Ventilation channels strictly BETWEEN the 5 crossbars along width (z axis)
  const channels = [];
  for (let i = 0; i < CROSSBAR_X.length - 1; i++) {
    channels.push({
      x0: CROSSBAR_X[i] + CROSSBAR_W / 2 + 0.04,
      x1: CROSSBAR_X[i + 1] - CROSSBAR_W / 2 - 0.04,
      y0: Y_PAD0 + 0.006,
      y1: Y_ACP0 - 0.006,
      z0: -CONTAINER.W / 2,
      z1: CONTAINER.W / 2,
    });
  }

  const parts = [
    { key: 'panel', name: 'ACP 4T + 아연도금 보강재(30×30) 모듈', count: modules.length, objects: modules },
    { key: 'crossbar', name: '아연도금 각관 크로스바 (100×50×2.9T)', count: crossbars.length, objects: crossbars },
    { key: 'leveler', name: '높이 조절 레벨러 (±20mm)', count: levelers.length, objects: levelers },
    { key: 'pad', name: '받침 고무패드', count: pads.length, objects: pads },
    { key: 'latch', name: '드로우 래치 (패널 모듈 고정)', count: latches.length, objects: latches },
    { key: 'strap', name: '라쳇 스트랩(50mm) + D링 + J후크', count: straps.length, objects: straps },
    { key: 'clamp', name: 'M12 빔 클램프 (보조 고정)', count: beamClamps.length, objects: beamClamps },
  ];

  const installSteps = [
    { title: '받침부 고무패드 10곳 배치', minutes: 4, objects: pads },
    { title: '레벨러 10곳 설치 및 크로스바 수평 기준 조절', minutes: 6, objects: levelers },
    { title: '아연도금 각관 크로스바 5개 배치 (폭 방향 4개 환기통로 형성)', minutes: 6, objects: crossbars },
    { title: 'ACP 4T + 각관 보강재 패널 모듈 12개 배치 (끝 리브 20mm 걸침)', minutes: 12, objects: modules },
    { title: '드로우 래치로 패널 모듈–크로스바 고정', minutes: 6, objects: latches },
    { title: '크로스바 끝단 D링 · 50mm 라쳇 스트랩 · J후크 결속 및 M12 빔 클램프 고정', minutes: 8, objects: [...straps, ...beamClamps] },
  ];

  const anchors = {
    1: new THREE.Vector3(-1.5, Y_ACP0 + ACP_T + 0.01, 0.5),
    2: new THREE.Vector3(-0.75, Y_BAR1 + 0.015, 1.0),
    3: new THREE.Vector3(0.0, Y_LEV1 + 0.025, 1.44),
    4: new THREE.Vector3(2.95, 1.35, 1.56),
  };

  return finishModel({
    id: ID,
    group,
    parts,
    installSteps,
    anchors,
    gap: GAP,
    topSurfaces,
    windLoose: modules,
    gapBox: {
      y0: ROOF_Y,
      y1: ROOF_Y + GAP,
      x0: -CONTAINER.L / 2,
      x1: CONTAINER.L / 2,
      z0: -CONTAINER.W / 2,
      z1: CONTAINER.W / 2,
      flowAxis: 'z',
      channels,
    },
  });
}
