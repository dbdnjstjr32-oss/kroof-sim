// designB.js — B안: ACP 밀착형 (ACP 4T 3-layer sandwich directly adhered to container roof, 0 mm air gap).
import * as THREE from 'three';
import { CONTAINER } from '../config.js';
import { acpSandwichPanel, tag } from '../parts.js';
import { createPartKit, mergeByMaterial, finishModel } from './kit.js';

const ID = 'B';
const ROOF_Y = CONTAINER.roofY; // 2.80 m
const PANEL_T = 0.008;          // 8 mm visual thickness (actual ACP 4T thermal spec)
const TAPE_H = 0.0015;          // 1.5 mm structural adhesive bondline

export function build({ mats } = {}) {
  const kit = createPartKit();
  const group = new THREE.Group();
  group.name = 'design-B';

  const put = (obj, partKey, name, explodeY) => {
    obj.name = obj.name || name;
    tag(obj, { partKey, name, explode: [0, explodeY, 0] });
    group.add(obj);
    return obj;
  };

  // 4 × 3 ACP 4T 3-layer sandwich modules tightly covering the full 6.0 × 3.0 m roof (0 mm air gap)
  const cols = 4, rows = 3;
  const pitchX = CONTAINER.L / cols;
  const pitchZ = CONTAINER.W / rows;
  const seam = 0.005;
  const pw = pitchX - seam;
  const pd = pitchZ - seam;

  const panels = [];
  const topSurfaces = [];

  for (let ix = 0; ix < cols; ix++) {
    const x = -CONTAINER.L / 2 + (ix + 0.5) * pitchX;
    for (let iz = 0; iz < rows; iz++) {
      const z = -CONTAINER.W / 2 + (iz + 0.5) * pitchZ;
      const mod = new THREE.Group();

      // Structural double-sided adhesive tape strips under ACP
      for (const dz of [-pd * 0.32, 0, pd * 0.32]) {
        mod.add(kit.box([x - pw * 0.44, ROOF_Y, z + dz - 0.015], [x + pw * 0.44, ROOF_Y + TAPE_H, z + dz + 0.015], mats.rubber));
      }

      // 3-layer ACP sandwich panel (PVDF white top / black PE core / unpainted mill aluminum underside)
      const p = acpSandwichPanel(pw, pd, PANEL_T, mats.acpWhiteTop, mats.millAluminum, mats.acpCore, mats.panelEdge);
      p.position.set(x, ROOF_Y + TAPE_H + PANEL_T / 2, z);
      mod.add(p);
      topSurfaces.push(p);

      panels.push(put(mod, 'acp', 'ACP 4T 밀착 패널 (3층 샌드위치 · 백색 고반사 / 하부 알루미늄)', 0.55));
    }
  }

  // Weatherseal EPDM seam beads + anodized aluminum perimeter edge trim sitting flush on ROOF_Y
  const trimRaw = new THREE.Group();
  const yPanelTop = ROOF_Y + TAPE_H + PANEL_T;
  const HX = CONTAINER.L / 2, HZ = CONTAINER.W / 2;

  for (let ix = 1; ix < cols; ix++) {
    const sx = -HX + ix * pitchX;
    trimRaw.add(kit.box([sx - seam / 2, ROOF_Y + TAPE_H, -HZ + 0.005], [sx + seam / 2, yPanelTop - 0.0005, HZ - 0.005], mats.rubber));
  }
  for (let iz = 1; iz < rows; iz++) {
    const sz = -HZ + iz * pitchZ;
    trimRaw.add(kit.box([-HX + 0.005, ROOF_Y + TAPE_H, sz - seam / 2], [HX - 0.005, yPanelTop - 0.0005, sz + seam / 2], mats.rubber));
  }
  // Perimeter L-profile aluminum flashing along all 4 roof edges (y >= ROOF_Y)
  for (const sz of [-1, 1]) {
    const zIn = sz > 0 ? HZ - 0.022 : -HZ - 0.004;
    const zOut = sz > 0 ? HZ + 0.004 : -HZ + 0.022;
    trimRaw.add(kit.box([-HX - 0.004, yPanelTop - 0.001, Math.min(zIn, zOut)], [HX + 0.004, yPanelTop + 0.003, Math.max(zIn, zOut)], mats.aluminumAnod));
    const zLip0 = sz > 0 ? HZ : -HZ - 0.004, zLip1 = sz > 0 ? HZ + 0.004 : -HZ;
    trimRaw.add(kit.box([-HX - 0.004, ROOF_Y, zLip0], [HX + 0.004, yPanelTop + 0.003, zLip1], mats.aluminumAnod));
  }
  for (const sx of [-1, 1]) {
    const xIn = sx > 0 ? HX - 0.022 : -HX - 0.004;
    const xOut = sx > 0 ? HX + 0.004 : -HX + 0.022;
    trimRaw.add(kit.box([Math.min(xIn, xOut), yPanelTop - 0.001, -HZ], [Math.max(xIn, xOut), yPanelTop + 0.003, HZ], mats.aluminumAnod));
    const xLip0 = sx > 0 ? HX : -HX - 0.004, xLip1 = sx > 0 ? HX + 0.004 : -HX;
    trimRaw.add(kit.box([xLip0, ROOF_Y, -HZ], [xLip1, yPanelTop + 0.003, HZ], mats.aluminumAnod));
  }
  const edgeTrim = put(mergeByMaterial(trimRaw, 'acpSealAndTrim'), 'seal', 'EPDM 실링 줄눈 및 외곽 알루미늄 마감 트림', 0.35);

  const allInstall = [...panels, edgeTrim];
  const parts = [
    { key: 'acp', name: 'ACP 4T 밀착형 차열패널 (4×3 3층 모듈, 100% 피복)', count: panels.length, objects: panels },
    { key: 'seal', name: '수밀 줄눈 실링 및 외곽 알루미늄 트림', count: 1, objects: [edgeTrim] },
  ];
  const installSteps = [
    { title: '기존 컨테이너 지붕 상부 ACP 4T 밀착 부착 및 외곽 실링 마감 (공기층 0mm)', minutes: 20, objects: allInstall },
  ];
  const anchors = {
    1: new THREE.Vector3(-1.4, yPanelTop + 0.01, 0.7),
    2: new THREE.Vector3(0.4, ROOF_Y + 0.003, -0.5),
    3: new THREE.Vector3(1.5, yPanelTop, 1.48),
  };

  return finishModel({ id: ID, group, parts, installSteps, anchors, gap: 0, topSurfaces });
}
