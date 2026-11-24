// 3D container, design assemblies (B/C/Cp), install/disassemble animator, and viz helpers smoke tests
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { CONTAINER, DESIGN_IDS, INSTALL_IDS, getDesign } from '../js/config.js';
import { createMaterials } from '../js/materials.js';
import { buildContainer } from '../js/container.js';
import { build as buildB } from '../js/designs/designB.js';
import { build as buildC } from '../js/designs/designC.js';
import { build as buildCp } from '../js/designs/designCp.js';
import { createAnimator } from '../js/viz/animator.js';
import { createGapFlow } from '../js/viz/flow.js';
import { createShadeAnalyzer } from '../js/viz/shade.js';
import { createRoofHeatmap, tempToRGB } from '../js/viz/heatmap.js';
import { createSunRays } from '../js/viz/rays.js';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

const mats = createMaterials();

// 1. Container geometry & toggleable 50mm roof insulation
const cont = buildContainer({ mats });
cont.group.updateMatrixWorld(true);
{
  const roofBox = new THREE.Box3().setFromObject(cont.roofMesh);
  const groupBox = new THREE.Box3().setFromObject(cont.group);
  check(Math.abs(roofBox.max.y - CONTAINER.roofY) < 0.03, `Roof top ~${CONTAINER.roofY}m (got ${roofBox.max.y.toFixed(3)})`);
  check(Math.abs((roofBox.max.x - roofBox.min.x) - 5.80) < 0.05, `Inner roof plate length ~5.80m (got ${(roofBox.max.x - roofBox.min.x).toFixed(3)})`);
  check(Math.abs((roofBox.max.z - roofBox.min.z) - 2.80) < 0.05, `Inner roof plate width ~2.80m (got ${(roofBox.max.z - roofBox.min.z).toFixed(3)})`);
  check((groupBox.max.x - groupBox.min.x) >= CONTAINER.L - 0.01 && (groupBox.max.z - groupBox.min.z) >= CONTAINER.W - 0.01,
    `Container outer footprint spans >= ${CONTAINER.L}x${CONTAINER.W}m`);

  check(cont.insulationMesh.visible === false, 'Insulation starts hidden at 0mm');
  cont.setInsulation(50);
  check(cont.insulationMesh.visible === true, 'setInsulation(50) reveals interior insulation mesh');
  const insBox = new THREE.Box3().setFromObject(cont.insulationMesh);
  check(insBox.max.y <= CONTAINER.roofY + 0.001, `Insulation sits below roof steel plate (max.y=${insBox.max.y.toFixed(3)})`);
  cont.setInsulation(0);
  check(cont.insulationMesh.visible === false, 'setInsulation(0) hides insulation mesh');
}

// 2. Design assemblies B, C, Cp
const builders = { B: buildB, C: buildC, Cp: buildCp };
const models = Object.fromEntries(DESIGN_IDS.map((id) => [id, builders[id]({ mats })]));

for (const id of DESIGN_IDS) {
  const m = models[id];
  m.group.updateMatrixWorld(true);

  const stepRoots = m.installSteps.flatMap((s) => s.objects || []);
  const stepMeshSets = m.installSteps.map((s) => {
    const set = new Set();
    for (const o of s.objects || []) o.traverse((n) => { if (n.isMesh) set.add(n); });
    return set;
  });

  // Verify every mesh in m.group belongs to exactly one installStep
  const allMeshes = [];
  m.group.traverse((n) => { if (n.isMesh) allMeshes.push(n); });
  check(allMeshes.length > 0, `${id}: builds meshes (${allMeshes.length})`);
  const uncovered = allMeshes.filter((mesh) => !stepMeshSets.some((set) => set.has(mesh)));
  const duplicated = allMeshes.filter((mesh) => stepMeshSets.filter((set) => set.has(mesh)).length > 1);
  check(uncovered.length === 0, `${id}: all meshes covered by installSteps (uncovered=${uncovered.length})`);
  check(duplicated.length === 0 && stepRoots.length > 0, `${id}: no mesh duplicated across installSteps`);

  // Verify every mesh has valid non-empty finite vertices (no NaN in CAD/hollow/corrugated geometries)
  const nanMeshes = allMeshes.filter((mesh) => {
    const pos = mesh.geometry?.attributes?.position;
    if (!pos || pos.count === 0) return true;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return true;
    return false;
  });
  check(nanMeshes.length === 0, `${id}: all ${allMeshes.length} meshes have finite non-empty vertices`);

  // Verify panel/support meshes do not pierce interior (y < 2.79 within roof footprint)
  const nonExteriorKeys = new Set(['acp', 'panel', 'crossbar', 'leveler', 'pad', 'latch', 'wingbolt']);
  const intruding = [];
  for (const part of m.parts || []) {
    if (!nonExteriorKeys.has(part.key)) continue;
    for (const o of part.objects || []) {
      const b = new THREE.Box3().setFromObject(o);
      if (b.min.y < CONTAINER.roofY - 0.015 && Math.abs((b.min.x + b.max.x) / 2) < 2.95 && Math.abs((b.min.z + b.max.z) / 2) < 1.48) {
        intruding.push(`${part.key}(${b.min.y.toFixed(3)})`);
      }
    }
  }
  check(intruding.length === 0, `${id}: zero roof-assembly penetration into container interior (${intruding.join(', ')})`);
}

// Specific checks for B (0mm contact)
{
  const mB = models.B;
  check(mB.gap === null, 'B: gap is null (0mm direct contact)');
  check(mB.callouts.length === 3, 'B: 3 callouts');
  check(mB.installSteps.length === 1, 'B: 1 install step');
  const boxB = new THREE.Box3().setFromObject(mB.group);
  check(boxB.min.y >= CONTAINER.roofY - 0.005 && boxB.max.y <= 2.83, `B panels flush on roof (${boxB.min.y.toFixed(3)}..${boxB.max.y.toFixed(3)})`);
  check(mB.topSurfaces.length === 12, `B: 12 ACP topSurfaces (${mB.topSurfaces.length})`);
}

// Specific checks for C (110mm) and Cp (140mm): straps, channels, callouts, install steps
for (const id of INSTALL_IDS) {
  const m = models[id];
  check(m.callouts.length === 4, `${id}: 4 callouts`);
  check(m.installSteps.length >= 5, `${id}: >= 5 installSteps (${m.installSteps.length})`);
  check(m.gap && m.gap.flowAxis === 'z' && Array.isArray(m.gap.channels) && m.gap.channels.length === 4, `${id}: 4 widthwise Z channels`);

  const interiorCrossbarsX = [-1.5, 0, 1.5];
  for (let ci = 0; ci < m.gap.channels.length; ci++) {
    const ch = m.gap.channels[ci];
    check(ch.y0 >= CONTAINER.roofY && ch.y1 <= m.gap.y1 + 1e-6, `${id} ch[${ci}] y strictly inside air gap`);
    for (const cx of interiorCrossbarsX) {
      check(cx <= ch.x0 || cx >= ch.x1, `${id} ch[${ci}] [${ch.x0.toFixed(2)}, ${ch.x1.toFixed(2)}] never crosses crossbar at x=${cx}`);
    }
  }

  const strapPart = m.parts.find((p) => p.key === 'strap');
  check(!!strapPart && strapPart.objects.length > 0, `${id}: strap part exists`);
  const strapBox = new THREE.Box3();
  for (const o of strapPart.objects) strapBox.expandByObject(o);
  check(strapBox.max.y < m.gap.y1, `${id}: ratchet straps stay below panel top (${strapBox.max.y.toFixed(3)} < ${m.gap.y1.toFixed(3)})`);
}

// 3. Animator: install -> disassemble -> restore
{
  const anim = createAnimator();
  const mC = models.C;
  const seenInst = new Set();
  let doneInst = false;
  anim.playInstall(mC, { speed: 4, onStep: (i) => seenInst.add(i), onDone: () => { doneInst = true; } });
  for (let i = 0; i < 1500 && anim.isAnimating(mC); i++) anim.update(0.05);
  check(doneInst && seenInst.size === mC.installSteps.length, `Install animation visited all ${mC.installSteps.length} steps (visited=${seenInst.size})`);
  check(mC.installSteps.every((s) => s.objects.every((o) => o.visible === true)), 'Install ends with all parts visible');

  const seenDis = new Set();
  let doneDis = false;
  anim.playDisassemble(mC, { speed: 4, onStep: (i) => seenDis.add(i), onDone: () => { doneDis = true; } });
  for (let i = 0; i < 1500 && anim.isAnimating(mC); i++) anim.update(0.05);
  check(doneDis && seenDis.size === mC.installSteps.length, `Disassemble animation visited all ${mC.installSteps.length} steps (visited=${seenDis.size})`);
  check(mC.installSteps.every((s) => s.objects.every((o) => o.visible === false)), 'Disassemble ends with parts removed/hidden');

  anim.restoreAssembled(mC);
  check(mC.installSteps.every((s) => s.objects.every((o) => o.visible === true)), 'restoreAssembled restores all parts visible');
}

// 4. Visualization modules: shade, flow, heatmap, rays
{
  const unitGroup = new THREE.Group();
  unitGroup.add(cont.group, models.C.group);
  unitGroup.updateMatrixWorld(true);

  const shade = createShadeAnalyzer();
  const sunDir = new THREE.Vector3(0.2, 0.95, 0.2).normalize();
  const trans = shade.meanTransmittance(unitGroup, models.C.shadeMeshes, sunDir);
  check(trans < 0.05, `100% opaque C roof shields underlying roof plate (transmittance=${trans.toFixed(4)})`);

  const flow = createGapFlow();
  flow.setVisible(false);
  check(flow.object.visible === false, 'flow.setVisible(false) hides particle cloud');
  flow.setVisible(true);
  flow.setGap(models.C.gap);
  flow.update(0.1, { gapVelocity: 0.5, windSpeed: 1.5, Tin: 34, Tout: 40 });
  const posArr = flow.object.geometry.attributes.position.array;
  const count = flow.object.geometry.attributes.position.count;
  let outOfBounds = 0;
  for (let i = 0; i < count; i++) {
    const x = posArr[i * 3], y = posArr[i * 3 + 1];
    const inAnyChannel = models.C.gap.channels.some((ch) => x >= ch.x0 - 0.001 && x <= ch.x1 + 0.001);
    if (!inAnyChannel || y < CONTAINER.roofY - 0.001 || y > models.C.gap.y1 + 0.001) outOfBounds++;
  }
  check(outOfBounds === 0, `All ${count} flow particles stay inside 4 channels & air gap height (oob=${outOfBounds})`);

  const rgb = [0, 0, 0];
  tempToRGB(25, rgb, 0);
  check(rgb.every((c) => Number.isFinite(c) && c >= 0 && c <= 1), 'tempToRGB writes valid linear RGB');

  const hm = createRoofHeatmap();
  hm.update(null, 65, 35);
  check(hm.temps[0] > 60 && hm.mesh.visible === true, 'Heatmap updates cell temperatures');

  const rays = createSunRays();
  rays.update(sunDir, unitGroup, models.C.topSurfaces, 70);
  check(rays.group.visible === true, 'SunRays updates cleanly');
}

console.log(failed ? `\n${failed} check(s) failed (${passed} passed)` : `\nall smoke checks passed (${passed})`);
assert.equal(failed, 0);
