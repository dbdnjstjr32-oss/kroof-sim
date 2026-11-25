// designB.js — B안: ACP 밀착형 천공 고정 방식 (추가 수정 요청 §1).
// ACP 4T modules lie directly on the existing 1.2T roof (0 mm air gap) and are fixed with waterproof
// self-drilling screws (방수 직결피스) with bonded EPDM washers that pierce the panel AND the roof plate.
// No supports, crossbars or ratchet straps. Screw size, count and spacing are not final: visual concept only.
// Local thermal bridging through the screws is excluded from the heat balance, like the C/C′ fasteners.
//
// Teardown (disassembleSteps): screws out → panels lifted off → drill holes left in the roof → repair needed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONTAINER } from '../config.js';
import { acpSandwichPanel, tag } from '../parts.js';
import { createPartKit, mergeByMaterial, finishModel } from './kit.js';

const ID = 'B';
const ROOF_Y = CONTAINER.roofY;          // 2.800 m — roof rib crests; the panel underside rests here
const PLATE_TOP = ROOF_Y - 0.003;        // flat roof-plate top between the ribs (container.js)
const PLATE_BOT = PLATE_TOP - 0.005;     // drawn roof-plate thickness (1.2T shown as 5 mm)
const PANEL_T = 0.008;                   // 8 mm visual thickness (actual ACP 4T thermal spec)
const PANEL_TOP = ROOF_Y + PANEL_T;      // 2.808 m
const EDGE = 0.05;                       // screw inset from each module edge
const MARK_Y = ROOF_Y + 0.0035;          // roof marks sit just above the heat-map overlay (roofY + 0.0025)

/** Waterproof self-drilling screw, slightly enlarged so the heads read in the overall view (concept). */
export const SCREW = {
  washerR: 0.011, washerH: 0.0028,       // bonded EPDM rubber washer
  flangeR: 0.0078, flangeH: 0.0012,      // steel flange under the head
  headR: 0.006, headH: 0.0045,           // hex head
  shankR: 0.0027, protrude: 0.008, tip: 0.005,
};
const HEAD_TOP = PANEL_TOP + SCREW.washerH + SCREW.flangeH + SCREW.headH;
const SHANK_BOT = PLATE_BOT - SCREW.protrude;   // the drill point comes out under the roof plate

/** 8 screws per module: 4 corners + 4 edge midpoints, `edge` inside the module outline. Returns [[x, z], …]. */
export function moduleScrewPoints(x0, x1, z0, z1, edge = EDGE) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const xa = x0 + edge, xb = x1 - edge, za = z0 + edge, zb = z1 - edge;
  return [[xa, za], [cx, za], [xb, za], [xb, cz], [xb, zb], [cx, zb], [xa, zb], [xa, cz]];
}

// Screw geometry, local origin = panel top surface at the screw axis.
function screwGeometries() {
  const S = SCREW;
  const washer = new THREE.CylinderGeometry(S.washerR, S.washerR * 0.97, S.washerH, 20).translate(0, S.washerH / 2, 0);
  const head = mergeGeometries([
    new THREE.CylinderGeometry(S.flangeR, S.flangeR, S.flangeH, 20).translate(0, S.washerH + S.flangeH / 2, 0),
    new THREE.CylinderGeometry(S.headR, S.headR, S.headH, 6).translate(0, S.washerH + S.flangeH + S.headH / 2, 0),
  ], false);
  const top = S.washerH;                 // hidden under the washer
  const bot = SHANK_BOT - PANEL_TOP;     // negative: below the roof plate
  const shank = mergeGeometries([
    new THREE.CylinderGeometry(S.shankR, S.shankR, top - bot, 10).translate(0, (top + bot) / 2, 0),
    new THREE.ConeGeometry(S.shankR, S.tip, 10).rotateX(Math.PI).translate(0, bot - S.tip / 2, 0),
  ], false);
  return { washer, head, shank };
}

const flatDisc = (r, seg) => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2);
const flatRing = (r0, r1, seg) => new THREE.RingGeometry(r0, r1, seg).rotateX(-Math.PI / 2);

// Flat decals drawn over the roof (and over the heat-map overlay), never written to depth.
function markMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,   // just ahead of the heat map (-2 / -4)
  });
}

function markInstances(kit, geo, mat, pts, y, order) {
  const im = kit.instances(geo, mat, pts.map(([x, z]) => [x, y, z]));
  im.castShadow = false;
  im.receiveShadow = false;
  im.renderOrder = order;
  im.raycast = () => {};
  im.userData.noShade = true;
  return im;
}

export function build({ mats } = {}) {
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-B';

  const put = (obj, partKey, name, explodeY, extra) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    if (extra) Object.assign(obj.userData, extra);
    group.add(obj);
    return obj;
  };

  // 1) 4 × 3 ACP 4T sandwich modules covering the full 6.0 × 3.0 m roof, lying directly on it (0 mm air gap)
  const cols = 4, rows = 3;
  const pitchX = CONTAINER.L / cols, pitchZ = CONTAINER.W / rows;
  const seam = 0.005;
  const pw = pitchX - seam, pd = pitchZ - seam;
  const HX = CONTAINER.L / 2, HZ = CONTAINER.W / 2;

  const panels = [];
  const topSurfaces = [];
  const modules = [];
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const x0 = -HX + ix * pitchX, z0 = -HZ + iz * pitchZ;
      const x1 = x0 + pitchX, z1 = z0 + pitchZ;
      const mod = new THREE.Group();
      // 3-layer ACP sandwich (PVDF white top / black PE core / unpainted mill aluminium underside)
      const p = acpSandwichPanel(pw, pd, PANEL_T, mats.acpWhiteTop, mats.millAluminum, mats.acpCore, mats.panelEdge);
      p.position.set((x0 + x1) / 2, ROOF_Y + PANEL_T / 2, (z0 + z1) / 2);
      mod.add(p);
      topSurfaces.push(p);
      panels.push(put(mod, 'acp', 'ACP 4T 밀착 패널 (3층 샌드위치 · 백색 고반사 / 하부 알루미늄)', 0.55));
      modules.push({ x0, x1, z0, z1 });
    }
  }

  // 2) Weatherseal EPDM seam beads + anodised aluminium perimeter edge trim
  const trimRaw = new THREE.Group();
  for (let ix = 1; ix < cols; ix++) {
    const sx = -HX + ix * pitchX;
    trimRaw.add(kit.box([sx - seam / 2, ROOF_Y, -HZ + 0.005], [sx + seam / 2, PANEL_TOP - 0.0005, HZ - 0.005], mats.rubber));
  }
  for (let iz = 1; iz < rows; iz++) {
    const sz = -HZ + iz * pitchZ;
    trimRaw.add(kit.box([-HX + 0.005, ROOF_Y, sz - seam / 2], [HX - 0.005, PANEL_TOP - 0.0005, sz + seam / 2], mats.rubber));
  }
  // Perimeter L-profile aluminium flashing along all 4 roof edges (22 mm wide: clear of the screws at 50 mm)
  for (const sz of [-1, 1]) {
    const zIn = sz > 0 ? HZ - 0.022 : -HZ - 0.004;
    const zOut = sz > 0 ? HZ + 0.004 : -HZ + 0.022;
    trimRaw.add(kit.box([-HX - 0.004, PANEL_TOP - 0.001, Math.min(zIn, zOut)], [HX + 0.004, PANEL_TOP + 0.003, Math.max(zIn, zOut)], mats.aluminumAnod));
    const zLip0 = sz > 0 ? HZ : -HZ - 0.004, zLip1 = sz > 0 ? HZ + 0.004 : -HZ;
    trimRaw.add(kit.box([-HX - 0.004, ROOF_Y, zLip0], [HX + 0.004, PANEL_TOP + 0.003, zLip1], mats.aluminumAnod));
  }
  for (const sx of [-1, 1]) {
    const xIn = sx > 0 ? HX - 0.022 : -HX - 0.004;
    const xOut = sx > 0 ? HX + 0.004 : -HX + 0.022;
    trimRaw.add(kit.box([Math.min(xIn, xOut), PANEL_TOP - 0.001, -HZ], [Math.max(xIn, xOut), PANEL_TOP + 0.003, HZ], mats.aluminumAnod));
    const xLip0 = sx > 0 ? HX : -HX - 0.004, xLip1 = sx > 0 ? HX + 0.004 : -HX;
    trimRaw.add(kit.box([xLip0, ROOF_Y, -HZ], [xLip1, PANEL_TOP + 0.003, HZ], mats.aluminumAnod));
  }
  const edgeTrim = put(mergeByMaterial(trimRaw, 'acpSealAndTrim'), 'seal', 'EPDM 실링 줄눈 및 외곽 알루미늄 마감 트림', 0.35);

  // 3) Waterproof self-drilling screws: one group (8 screws) per module so they drive in panel by panel
  const geo = screwGeometries();
  const screwGroups = [];
  const allPts = [];
  modules.forEach((m, i) => {
    const pts = moduleScrewPoints(m.x0, m.x1, m.z0, m.z1);
    allPts.push(...pts);
    const g = new THREE.Group();
    g.name = `screws-${i}`;
    const at = pts.map(([x, z]) => [x, PANEL_TOP, z]);
    for (const [gg, mat] of [[geo.washer, mats.rubber], [geo.head, mats.stainless], [geo.shank, mats.zinc]]) {
      const im = kit.instances(gg, mat, at);
      im.userData.noShade = true;
      g.add(im);
    }
    // Short, overshoot-free drop = the screw being driven straight down through panel and roof plate
    screwGroups.push(put(g, 'screw', '방수 직결피스 + EPDM 고무 와셔 (개념 배치)', 0.9, { dropH: 0.42, dropEase: 'smooth' }));
  });
  const nScrew = allPts.length;

  // 4) What the teardown leaves behind: drill holes in the existing roof, then the repair-needed markers
  const holeMat = markMaterial(0x0b0b0d, 0.96);
  const rustMat = markMaterial(0x7a4a24, 0.72);
  const repairMat = markMaterial(0xf59e0b, 0.95);

  const drillMarks = new THREE.Group();
  drillMarks.name = 'drillMarks';
  drillMarks.add(markInstances(kit, flatRing(SCREW.shankR + 0.0008, 0.0105, 24), rustMat, allPts, MARK_Y, 3));
  drillMarks.add(markInstances(kit, flatDisc(SCREW.shankR + 0.0008, 16), holeMat, allPts, MARK_Y + 0.0002, 4));
  drillMarks.visible = false;
  drillMarks.userData.revealOnly = true;
  group.add(drillMarks);

  const repairMarks = new THREE.Group();
  repairMarks.name = 'repairMarks';
  repairMarks.add(markInstances(kit, flatRing(0.026, 0.038, 32), repairMat, allPts, MARK_Y + 0.0004, 5));
  repairMarks.visible = false;
  repairMarks.userData.revealOnly = true;
  group.add(repairMarks);

  const notices = [
    {
      key: 'holes', tone: 'info', showWith: drillMarks,
      text: `기존 지붕 천공 흔적 ${nScrew}곳 잔존`, sub: 'ACP 패널 회수 후 지붕 강판에 남는 피스 구멍',
      anchor: new THREE.Vector3(-1.5, ROOF_Y + 0.05, 0),
    },
    {
      key: 'repair', tone: 'warn', showWith: repairMarks,
      text: '천공부 방수·보수 필요', sub: '실링·방수 처리 등 보수 작업 · 반복 체결 시 손상 누적',
      anchor: new THREE.Vector3(1.5, ROOF_Y + 0.05, 0),
    },
  ];

  const parts = [
    { key: 'acp', name: 'ACP 4T 밀착형 차열패널 (4×3 3층 모듈, 100% 피복)', count: panels.length, objects: panels },
    { key: 'screw', name: `방수 직결피스 + EPDM 고무 와셔 (${nScrew}개 · 개념 배치)`, count: nScrew, objects: screwGroups },
    { key: 'seal', name: '수밀 줄눈 실링 및 외곽 알루미늄 트림', count: 1, objects: [edgeTrim] },
  ];

  // Install (1-4) and teardown (1-5) sequences of the request document
  const installSteps = [
    { title: '기존 컨테이너 지붕 노출 (1.2T 강판 상태 확인)', minutes: 2, objects: [], holdSec: 1.6 },
    { title: 'ACP 4T 패널 12장 배치 — 기존 지붕 위 직접 밀착 (공기층 0 mm)', minutes: 6, objects: panels },
    { title: `방수 직결피스 ${nScrew}개 체결 — ACP 패널과 기존 지붕 강판 관통 (EPDM 와셔)`, minutes: 10, objects: screwGroups, dropSec: 1.0 },
    { title: '설치 완료 — 밀착형 천공 고정 · 줄눈 실링·외곽 트림 마감', minutes: 2, objects: [edgeTrim], holdSec: 1.6 },
  ];
  const disassembleSteps = [
    { title: `체결된 직결피스 ${nScrew}개 제거`, minutes: 8, objects: screwGroups, dropSec: 0.9 },
    { title: 'ACP 패널 분리·회수 (외곽 트림 해체 · 패널 재사용 가능)', minutes: 6, objects: [edgeTrim, ...panels] },
    { title: `기존 컨테이너 지붕에 피스 천공 흔적 ${nScrew}곳 잔존`, minutes: 0, objects: [], reveal: [drillMarks], holdSec: 2.4 },
    { title: '천공부 방수 및 보수 필요 (실링 · 방수 처리 등)', minutes: 0, objects: [], reveal: [repairMarks], holdSec: 2.4 },
  ];

  const anchors = {
    1: new THREE.Vector3(-1.4, PANEL_TOP + 0.01, 0.7),
    2: new THREE.Vector3(0.4, ROOF_Y + 0.003, -0.5),
    3: new THREE.Vector3(1.5, PANEL_TOP, 1.48),
    4: new THREE.Vector3(2.95, HEAD_TOP, 1.45),     // south-east corner screw head
  };

  const update = (t) => {
    if (repairMarks.visible) repairMat.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(t * 4.2));
  };

  return finishModel({
    id: ID, group, parts, installSteps, anchors, gap: 0, topSurfaces,
    disassembleSteps, notices, update,
    extra: {
      drillMarks,
      repairMarks,
      fastener: {
        count: nScrew, perModule: 8, points: allPts,
        panelTopY: PANEL_TOP, headTopY: HEAD_TOP, shankBottomY: SHANK_BOT - SCREW.tip,
        plateTopY: PLATE_TOP, plateBottomY: PLATE_BOT,
      },
    },
  });
}
