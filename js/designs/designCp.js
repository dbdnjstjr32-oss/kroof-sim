// designCp.js — C′안: 갈바륨 차열 이중지붕 (갈바륨 골강판 0.5T C-76 + 140mm 공기층 + 경량·경제성 개선).
//
// Vertical stack (roofY = 2.800 m -> galvalume trough underside = 2.940 m, exact 140 mm air gap):
//   - 20 Grooved EPDM rubber pads (100x100x10 mm): 2.800 .. 2.810
//   - 5 Upright hollow galvanized crossbars (50x100x2.9T, L=3.2 m) + end plugs: 2.810 .. 2.910
//   - 24 End-only hollow stiffeners (30x30x1.4T, L=0.99 m) with L-ear brackets: 2.910 .. 2.940
//   - 12 Closed-edge C-76 corrugated galvalume 0.5T modules + 96 waterproof screws/EPDM washers
//   - 48 M8 stainless butterfly wing bolts + flared pop-nuts
//   - 8 Ratchet straps (50 mm x 8 m) + J-hooks + 4 forged 4" blue C-clamps + 2 extruded L-profile corner guards
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { corrugatedSheet, tag } from '../parts.js';
import { createPartKit, mergeByMaterial, buildCrossbarStrap, finishModel } from './kit.js';

const ID = 'Cp';
const ROOF_Y = CONTAINER.roofY;        // 2.800 m
const GAP = 0.140;                     // 140 mm (10 + 100 + 30)
const CROSSBAR_X = [-2.95, -1.50, 0.0, 1.50, 2.95];
const CROSSBAR_LEN = 3.20;
const CROSSBAR_HALF = CROSSBAR_LEN / 2;
const CROSSBAR_W = 0.050;              // 50 mm wide along x
const CROSSBAR_H = 0.100;              // 100 mm upright tall along y (§5.3)
const CROSSBAR_T = 0.0029;
const PAD_H = 0.010;                   // 10 mm rubber pad
const RIB_SIZE = 0.030;                // 30x30x1.4T end stiffener
const RIB_T = 0.0014;

const Y_PAD0 = ROOF_Y;                 // 2.800
const Y_PAD1 = Y_PAD0 + PAD_H;         // 2.810
const Y_BAR1 = Y_PAD1 + CROSSBAR_H;    // 2.910
const Y_SHEET0 = Y_BAR1 + RIB_SIZE;    // 2.940 (= ROOF_Y + 0.140)

// C-76 corrugated profile (pitch 76 mm, depth 18 mm, closed edges, 16 seg/pitch)
const SHEET = { length: 1.49, width: 0.99, pitch: 0.076, depth: 0.018, thickness: 0.0035, segPerPitch: 16 };
const STRAP_X = [-2.95, -1.50, 0.0, 2.95];

function buildPadProto(kit, mats) {
  const raw = new THREE.Group();
  raw.add(kit.box([-0.050, 0, -0.050], [0.050, 0.007, 0.050], mats.rubber));
  for (const gx of [-0.025, 0, 0.025]) {
    raw.add(kit.box([gx - 0.009, 0.007, -0.046], [gx + 0.009, 0.010, 0.046], mats.rubber));
  }
  // Subtle galvanized locator cradle lips holding the 50 mm crossbar base
  raw.add(kit.box([-0.032, 0.006, -0.042], [-0.026, 0.014, 0.042], mats.zinc));
  raw.add(kit.box([0.026, 0.006, -0.042], [0.032, 0.014, 0.042], mats.zinc));
  return mergeByMaterial(raw, 'padCp');
}

function buildCrossbar(kit, mats, x) {
  const g = new THREE.Group();
  const yMid = (Y_PAD1 + Y_BAR1) / 2;
  // Upright 50x100x2.9T hollow galvanized steel crossbar along Z
  g.add(kit.hollowTube([x, yMid, -CROSSBAR_HALF + 0.003], [x, yMid, CROSSBAR_HALF - 0.003], CROSSBAR_W, CROSSBAR_H, CROSSBAR_T, mats.steelGalv));
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

function buildCClamp(kit, mats, x, zSign) {
  const raw = new THREE.Group();
  const s = Math.sign(zSign);
  const zOuter = s * (CONTAINER.W / 2 + 0.028);
  const zInner = s * (CONTAINER.W / 2 - 0.062);
  const yBot = ROOF_Y - 0.060;
  const yTop = Y_BAR1 + 0.015;
  const zSpine0 = Math.min(zOuter, zOuter + s * 0.016);
  const zSpine1 = Math.max(zOuter, zOuter + s * 0.016);

  // Forged blue I-beam C-frame body + inner reinforcing rib
  raw.add(kit.box([x - 0.013, yBot, zSpine0], [x + 0.013, yTop, zSpine1], mats.cClamp));
  raw.add(kit.box([x - 0.006, yBot + 0.012, zSpine0 - s * 0.008], [x + 0.006, yTop - 0.012, zSpine1 + s * 0.008], mats.cClamp));
  raw.add(kit.box([x - 0.013, yTop - 0.015, Math.min(zInner, zSpine1)], [x + 0.013, yTop, Math.max(zInner, zSpine1)], mats.cClamp));
  raw.add(kit.box([x - 0.013, yBot, Math.min(zInner, zSpine1)], [x + 0.013, yBot + 0.015, Math.max(zInner, zSpine1)], mats.cClamp));
  // Acme screw spindle, upper swivel pressure pad, and sliding T-handle bar
  const zScrew = (zInner + zOuter) / 2;
  raw.add(kit.cyl([x, yBot - 0.024, zScrew], [x, ROOF_Y - 0.006, zScrew], 0.0065, mats.stainless, 10));
  raw.add(kit.cyl([x, ROOF_Y - 0.009, zScrew], [x, ROOF_Y - 0.002, zScrew], 0.013, mats.ratchet, 12));
  raw.add(kit.cyl([x - 0.032, yBot - 0.022, zScrew], [x + 0.032, yBot - 0.022, zScrew], 0.004, mats.stainless, 8));
  return mergeByMaterial(raw, 'cClamp4');
}

function buildWingBoltProto(kit, mats) {
  const raw = new THREE.Group();
  // Knurled pop-nut collar (seated in crossbar top flange at y = 0)
  raw.add(kit.cyl([0, -0.005, 0], [0, 0.0025, 0], 0.0095, mats.stainless, 12));
  raw.add(kit.cyl([0, -0.008, 0], [0, 0.038, 0], 0.0042, mats.stainless, 10));
  // Stiffener bracket washer + M8 butterfly hub
  raw.add(kit.cyl([0, 0.030, 0], [0, 0.034, 0], 0.010, mats.stainless, 12));
  raw.add(kit.cyl([0, 0.034, 0], [0, 0.043, 0], 0.0065, mats.stainless, 10));
  // Two flared sculpted butterfly wings (+-28 deg)
  for (const sx of [-1, 1]) {
    const wing = kit.box([-0.008, -0.006, -0.0018], [0.008, 0.007, 0.0018], mats.stainless);
    wing.position.set(sx * 0.011, 0.043, 0);
    wing.rotation.z = sx * 0.48;
    raw.add(wing);
  }
  return mergeByMaterial(raw, 'wingBoltM8');
}

function buildCornerGuard(kit, mats, zSign) {
  const raw = new THREE.Group();
  const s = Math.sign(zSign);
  const x0 = -2.98, x1 = -0.98; // L = 2.0 m covering strap stations -2.95 and -1.50
  const zCornerOut = s * (CONTAINER.W / 2 + 0.006);
  const zCornerIn = s * (CONTAINER.W / 2 - 0.040);
  // True L-profile extruded rubber/polyurethane guard hugging top corner rail (max y = 2.808 <= pads/bars)
  raw.add(kit.box([x0, ROOF_Y + 0.001, Math.min(zCornerIn, zCornerOut)], [x1, ROOF_Y + 0.007, Math.max(zCornerIn, zCornerOut)], mats.cornerGuard));
  raw.add(kit.box([x0, ROOF_Y - 0.048, Math.min(zCornerOut - s * 0.007, zCornerOut)], [x1, ROOF_Y + 0.007, Math.max(zCornerOut - s * 0.007, zCornerOut)], mats.cornerGuard));
  // Raised strap channel guide ribs near -2.95 and -1.50
  for (const sx of [-2.95, -1.50]) {
    for (const dx of [-0.032, 0.032]) {
      raw.add(kit.box([sx + dx - 0.004, ROOF_Y + 0.002, Math.min(zCornerIn, zCornerOut + s * 0.003)], [sx + dx + 0.004, ROOF_Y + 0.011, Math.max(zCornerIn, zCornerOut + s * 0.003)], mats.cornerGuard));
    }
  }
  return mergeByMaterial(raw, 'cornerGuard2m');
}

export function build({ mats } = {}) {
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-Cp';

  const put = (obj, partKey, name, explodeY) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    group.add(obj);
    return obj;
  };

  // 1) 20 Grooved rubber pads (100x100x10 mm, 4 along each crossbar)
  const padProto = buildPadProto(kit, mats);
  const pads = [];
  const padZ = [-1.44, -0.48, 0.48, 1.44];
  for (const x of CROSSBAR_X) {
    for (const z of padZ) {
      const p = padProto.clone();
      p.position.set(x, Y_PAD0, z);
      pads.push(put(p, 'pad', '고무패드 (100×100×10mm, 20개)', 0.12));
    }
  }

  // 2) 5 Upright hollow galvanized steel crossbars (50x100x2.9T, L=3.2 m)
  const crossbars = CROSSBAR_X.map((x) => put(
    buildCrossbar(kit, mats, x),
    'crossbar', '아연도금 중공 각관 크로스바 (100×50×2.9T 세로 배치, 3.2m)', 0.42,
  ));

  // 3) 12 Closed-edge C-76 corrugated galvalume 0.5T modules + 24 end-only hollow stiffeners + 96 waterproof screws
  const sheetProto = corrugatedSheet({
    ...SHEET,
    matTop: mats.galvWhiteTop,
    matBottom: mats.galvalumeMill,
    matEdge: mats.panelEdge,
  });
  const epdmGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.0035, 10);
  const capWasherGeo = new THREE.CylinderGeometry(0.009, 0.0095, 0.0022, 10);
  const screwHeadGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.0055, 6);

  const modL = SHEET.length, modW = SHEET.width;
  const endFrameProto = (() => {
    const raw = new THREE.Group();
    const yMid = (Y_BAR1 + Y_SHEET0) / 2;
    const x0 = -modL / 2, x1 = modL / 2;
    // STRICTLY ONLY 2 end stiffeners (30x30x1.4T, L=0.99m) per module (§5.3)
    raw.add(kit.hollowTube([x0 + RIB_SIZE / 2, yMid, -modW / 2 + 0.001], [x0 + RIB_SIZE / 2, yMid, modW / 2 - 0.001], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
    raw.add(kit.hollowTube([x1 - RIB_SIZE / 2, yMid, -modW / 2 + 0.001], [x1 - RIB_SIZE / 2, yMid, modW / 2 - 0.001], RIB_SIZE, RIB_SIZE, RIB_T, mats.steelGalv));
    for (const sx of [x0 + RIB_SIZE / 2, x1 - RIB_SIZE / 2]) {
      for (const sz of [-1, 1]) {
        const zFace = sz * (modW / 2 - 0.001), zIn = sz * (modW / 2 - 0.012);
        raw.add(kit.box([sx - 0.012, yMid - 0.012, Math.min(zIn, zFace)], [sx + 0.012, yMid + 0.012, Math.max(zIn, zFace)], mats.endCap));
      }
      // L-ear fastener bracket tabs for M8 wing bolts
      for (const bz of [-0.30, 0.30]) {
        raw.add(kit.box([sx - 0.014, Y_BAR1 + 0.0005, bz - 0.016], [sx + 0.014, Y_BAR1 + 0.0035, bz + 0.016], mats.stainless));
      }
    }
    return mergeByMaterial(raw, 'endRibsCp');
  })();

  const wingProto = buildWingBoltProto(kit, mats);
  const modules = [];
  const topSurfaces = [];
  const wingBolts = [];

  const cols = 4, rows = 3;
  const ySheetCenter = Y_SHEET0 + SHEET.depth / 2 + SHEET.thickness / 2;

  for (let ix = 0; ix < cols; ix++) {
    const cx = -2.25 + ix * 1.50;
    for (let iz = 0; iz < rows; iz++) {
      const cz = -1.00 + iz * 1.00;
      const mod = new THREE.Group();

      const er = endFrameProto.clone();
      er.position.set(cx, 0, cz);
      mod.add(er);

      const sh = sheetProto.clone();
      sh.position.set(cx, ySheetCenter, cz);
      mod.add(sh);
      topSurfaces.push(sh);

      // 8 waterproof hex self-drilling screws + EPDM washers + stainless dished caps per module (96 total)
      const x0 = cx - modL / 2, x1 = cx + modL / 2;
      const screwPts = [];
      for (const sx of [x0 + 0.015, x1 - 0.015]) {
        for (let k = 0; k < 4; k++) {
          const sz = cz - 0.36 + k * 0.24;
          const zRel = sz - cz + modW / 2;
          const waveY = (SHEET.depth / 2) * Math.sin((2 * Math.PI * zRel) / SHEET.pitch);
          const yTop = ySheetCenter + waveY + SHEET.thickness / 2;
          screwPts.push([sx, yTop, sz]);
        }
      }
      mod.add(kit.instances(epdmGeo, mats.rubber, screwPts.map(([x, y, z]) => [x, y + 0.0018, z])));
      mod.add(kit.instances(capWasherGeo, mats.stainless, screwPts.map(([x, y, z]) => [x, y + 0.0044, z])));
      mod.add(kit.instances(screwHeadGeo, mats.stainless, screwPts.map(([x, y, z]) => [x, y + 0.0078, z])));

      modules.push(put(mod, 'panel', '갈바륨 골강판(0.5T C-76) + 양단 중공 보강재(30×30) 모듈', 0.95));

      // 4 M8 stainless butterfly wing bolts + pop-nuts per module (48 total)
      for (const bx of [x0 + 0.015, x1 - 0.015]) {
        for (const bz of [cz - 0.30, cz + 0.30]) {
          const wb = wingProto.clone();
          wb.position.set(bx, Y_BAR1, bz);
          wingBolts.push(put(wb, 'wingbolt', 'M8 스테인리스 나비볼트 및 팝너트 (48조)', 0.65));
        }
      }
    }
  }

  // 4) 8 Ratchet straps (50mm x 8m) at crossbar ends + twin J-hooks + 4 C-clamps (4") + 2 L-profile corner guards
  const straps = [];
  for (const x of STRAP_X) {
    for (const sz of [-1, 1]) {
      straps.push(put(
        buildCrossbarStrap(kit, mats, {
          x, zSide: sz, yBarTop: Y_BAR1, yBarBot: Y_PAD1, crossbarHalf: CROSSBAR_HALF, crossbarW: CROSSBAR_W,
        }),
        'strap', '라쳇 스트랩(50mm×8m) · 하부 J후크 (8개)', 0.35,
      ));
    }
  }
  const cClamps = [
    put(buildCClamp(kit, mats, 1.50, 1), 'cclamp', '4인치 C형 클램프 (출입문 상부 등 4개)', 0.25),
    put(buildCClamp(kit, mats, 1.50, -1), 'cclamp', '4인치 C형 클램프 (4개)', 0.25),
    put(buildCClamp(kit, mats, -1.50, 1), 'cclamp', '4인치 C형 클램프 (4개)', 0.25),
    put(buildCClamp(kit, mats, 0.0, 1), 'cclamp', '4인치 C형 클램프 (4개)', 0.25),
  ];

  const cornerGuards = [-1, 1].map((sz) => put(
    buildCornerGuard(kit, mats, sz),
    'guard', 'L형 모서리 보호재 (길이 2m, 2개)', 0.20,
  ));

  // Ventilation channels strictly BETWEEN the 5 crossbars along width (z axis)
  const channels = [];
  for (let i = 0; i < CROSSBAR_X.length - 1; i++) {
    channels.push({
      x0: CROSSBAR_X[i] + CROSSBAR_W / 2 + 0.04,
      x1: CROSSBAR_X[i + 1] - CROSSBAR_W / 2 - 0.04,
      y0: Y_PAD0 + 0.008,
      y1: Y_SHEET0 - 0.008,
      z0: -CONTAINER.W / 2,
      z1: CONTAINER.W / 2,
    });
  }

  const parts = [
    { key: 'panel', name: '갈바륨 골강판(0.5T) + 양단 보강재(30×30) 12모듈', count: modules.length, objects: modules },
    { key: 'crossbar', name: '아연도금 각관 크로스바 (100×50×2.9T)', count: crossbars.length, objects: crossbars },
    { key: 'pad', name: '고무패드 (100×100×10mm)', count: pads.length, objects: pads },
    { key: 'wingbolt', name: 'M8 스테인리스 나비볼트 · 팝너트', count: wingBolts.length, objects: wingBolts },
    { key: 'strap', name: '라쳇 스트랩 (50mm×8m) + J후크', count: straps.length, objects: straps },
    { key: 'cclamp', name: '4인치 C형 클램프 (보조 고정)', count: cClamps.length, objects: cClamps },
    { key: 'guard', name: '모서리 보호재 (2m)', count: cornerGuards.length, objects: cornerGuards },
  ];

  const installSteps = [
    { title: '컨테이너 지붕 상부 고무패드(10mm, 20개) 배치', minutes: 4, objects: pads },
    { title: '아연도금 각관 크로스바(100×50, 5개) 배치 (폭 방향 4개 통로)', minutes: 6, objects: crossbars },
    { title: '갈바륨 골강판(0.5T) + 양단 보강재 일체 모듈 12개 배치 (방수 직결피스 96개 체결 모듈)', minutes: 12, objects: modules },
    { title: 'M8 스테인리스 나비볼트 및 팝너트(48조)로 모듈–크로스바 체결', minutes: 8, objects: wingBolts },
    { title: '크로스바 끝단 라쳇 스트랩(8개) 결속 · C형 클램프(4개) · 모서리 보호재 설치', minutes: 8, objects: [...straps, ...cClamps, ...cornerGuards] },
  ];

  const anchors = {
    1: new THREE.Vector3(-1.5, Y_SHEET0 + SHEET.depth + 0.01, 0.5),
    2: new THREE.Vector3(-0.75, Y_BAR1 + 0.02, 1.0),
    3: new THREE.Vector3(0.0, Y_PAD1 + 0.05, 1.44),
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
