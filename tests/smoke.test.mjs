// 3D container, design assemblies (B/C/Cp), install/disassemble animator, and viz helpers smoke tests
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { CONTAINER, DESIGN_IDS, INSTALL_IDS, getDesign } from '../js/config.js';
import { createMaterials } from '../js/materials.js';
import { buildContainer } from '../js/container.js';
import { build as buildB } from '../js/designs/designB.js';
import { build as buildC } from '../js/designs/designC.js';
import { build as buildCp } from '../js/designs/designCp.js';
import { createAnimator, disassemblySequence, revealObjects } from '../js/viz/animator.js';
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

  // Verify every mesh in m.group belongs to exactly one installStep (teardown-only reveal objects excepted)
  const revealMeshes = new Set();
  for (const o of revealObjects(m)) o.traverse((n) => { if (n.isMesh) revealMeshes.add(n); });
  const allMeshes = [];
  m.group.traverse((n) => { if (n.isMesh && !revealMeshes.has(n)) allMeshes.push(n); });
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

  // RENDERABILITY: a multi-material Mesh whose geometry has no groups (or groups that do not cover every vertex) draws nothing in three.js
  const unrenderable = allMeshes.filter((mesh) => {
    if (!Array.isArray(mesh.material)) return false;
    const geo = mesh.geometry;
    const total = geo.index ? geo.index.count : geo.attributes.position.count;
    const covered = geo.groups.reduce((n, g) => n + g.count, 0);
    const badIdx = geo.groups.some((g) => !mesh.material[g.materialIndex]);
    return geo.groups.length === 0 || covered !== total || badIdx;
  });
  check(unrenderable.length === 0, `${id}: every multi-material mesh has groups covering all vertices (unrenderable=${unrenderable.length})`);
  for (const ts of m.topSurfaces) {
    check(Array.isArray(ts.material) ? ts.geometry.groups.some((g) => ts.material[g.materialIndex] && g.count > 0) : true, `${id}: top surface is drawable`);
  }

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

// Specific checks for B (0mm contact + waterproof self-drilling screws through the roof plate)
{
  const mB = models.B;
  check(mB.gap === null, 'B: gap is null (0mm direct contact)');
  check(mB.callouts.length === 4, `B: 4 callouts incl. screw fixing (${mB.callouts.length})`);
  check(mB.callouts[3].text.includes('직결피스'), 'B: callout 4 names the waterproof screws');
  check(mB.installSteps.length === 4, `B: 4 install steps (${mB.installSteps.length})`);
  check(mB.installSteps[0].objects.length === 0 && mB.installSteps[2].objects.length === 12, 'B install: 1 exposed roof, 3 screws panel by panel');
  check(mB.disassembleSteps?.length === 4, 'B: 4 custom teardown steps');
  check(mB.disassembleSteps[2].reveal?.includes(mB.drillMarks) && mB.disassembleSteps[3].reveal?.includes(mB.repairMarks),
    'B teardown: step 3 reveals drill holes, step 4 the repair markers');

  const panelBox = new THREE.Box3();
  for (const key of ['acp', 'seal']) for (const o of mB.parts.find((p) => p.key === key).objects) panelBox.expandByObject(o);
  check(panelBox.min.y >= CONTAINER.roofY - 0.005 && panelBox.max.y <= 2.83, `B panels flush on roof (${panelBox.min.y.toFixed(3)}..${panelBox.max.y.toFixed(3)})`);
  check(mB.topSurfaces.length === 12, `B: 12 ACP topSurfaces (${mB.topSurfaces.length})`);

  const f = mB.fastener;
  const screwPart = mB.parts.find((p) => p.key === 'screw');
  check(f && f.count === 96 && f.points.length === 96 && f.perModule === 8, `B: 96 screws, 8 per ACP module (${f?.count})`);
  check(screwPart && screwPart.objects.length === 12, 'B: one screw group per module');
  check(f.headTopY > f.panelTopY && f.shankBottomY < f.plateBottomY,
    `B: screw head above the panel and drill point below the roof plate (${f.headTopY.toFixed(4)} / ${f.shankBottomY.toFixed(4)} < ${f.plateBottomY.toFixed(4)})`);
  check(f.points.every(([x, z]) => Math.abs(x) < CONTAINER.L / 2 - 0.02 && Math.abs(z) < CONTAINER.W / 2 - 0.02), 'B: every screw lands inside the roof footprint');
  const screwBox = new THREE.Box3();
  for (const o of screwPart.objects) screwBox.expandByObject(o);
  check(screwBox.min.y < CONTAINER.roofY - 0.008 && screwBox.max.y > f.panelTopY,
    `B: screw geometry spans panel top to below the roof plate (${screwBox.min.y.toFixed(3)}..${screwBox.max.y.toFixed(3)})`);
  const instCount = (g) => { let n = 0; g.traverse((o) => { if (o.isInstancedMesh) n = Math.max(n, o.count); }); return n; };
  check(instCount(mB.drillMarks) === 96 && instCount(mB.repairMarks) === 96, 'B: one drill mark + repair ring per screw');
  check(mB.drillMarks.visible === false && mB.repairMarks.visible === false, 'B: roof marks hidden while installed');
  const shaded = new Set(mB.shadeMeshes);
  let leaked = 0;
  for (const o of [...screwPart.objects, mB.drillMarks, mB.repairMarks]) o.traverse((n) => { if (n.isMesh && shaded.has(n)) leaked++; });
  check(leaked === 0, 'B: screws and roof marks excluded from sun-shading meshes');
  check(mB.notices.length === 2 && mB.notices.every((n) => n.anchor && n.showWith), 'B: 2 teardown notices tied to the roof marks');
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
  check(disassemblySequence(mC).every((s) => s.title.startsWith('해체 · ')) && disassemblySequence(mC).length === mC.installSteps.length,
    'C teardown is still the reversed install sequence');
}

// 3b. B: drilled install → teardown leaves drill holes + repair markers → restore
{
  const anim = createAnimator();
  const mB = models.B;
  const screws = mB.parts.find((p) => p.key === 'screw').objects;
  const panels = mB.parts.find((p) => p.key === 'acp').objects;
  const baseY = screws.map((o) => o.position.y);
  const run = () => { for (let i = 0; i < 4000 && anim.isAnimating(mB); i++) anim.update(0.05); };

  const seenInst = new Set();
  let minScrewY = Infinity;
  anim.playInstall(mB, { speed: 2, onStep: (i) => seenInst.add(i) });
  for (let i = 0; i < 4000 && anim.isAnimating(mB); i++) {
    anim.update(0.05);
    screws.forEach((o, k) => { if (o.visible) minScrewY = Math.min(minScrewY, o.position.y - baseY[k]); });
  }
  check(seenInst.size === 4, `B install visited all 4 steps (${seenInst.size})`);
  check(screws.every((o, i) => o.visible && Math.abs(o.position.y - baseY[i]) < 1e-9), 'B install: screws end seated in their holes');
  check(minScrewY > -1e-6, `B install: screws are driven straight down without overshoot (min offset ${minScrewY.toFixed(5)})`);
  check(!mB.drillMarks.visible && !mB.repairMarks.visible, 'B install: no roof marks while installed');

  const seenDis = [];
  let marksBeforeStep3 = false;
  anim.playDisassemble(mB, {
    speed: 2,
    onStep: (i) => { if (seenDis[seenDis.length - 1] !== i) seenDis.push(i); if (i < 2 && (mB.drillMarks.visible || mB.repairMarks.visible)) marksBeforeStep3 = true; },
  });
  run();
  check(seenDis.join(',') === '0,1,2,3', `B teardown visited steps in order (${seenDis.join(',')})`);
  check(!marksBeforeStep3, 'B teardown: holes appear only after the screws and panels are removed');
  check(screws.every((o) => !o.visible) && panels.every((o) => !o.visible), 'B teardown: screws and panels removed');
  check(mB.drillMarks.visible && mB.repairMarks.visible, 'B teardown: drill holes and repair markers stay on the roof');

  anim.restoreAssembled(mB);
  check(screws.every((o) => o.visible) && panels.every((o) => o.visible), 'B restore: assembly back in place');
  check(!mB.drillMarks.visible && !mB.repairMarks.visible, 'B restore: roof marks hidden again');

  anim.playDisassemble(mB, { speed: 2 });
  run();
  anim.playInstall(mB, { speed: 2 });
  check(!mB.drillMarks.visible && !mB.repairMarks.visible, 'B re-install after teardown starts from a clean roof');
  anim.stopInstall(mB);
  check(screws.every((o) => o.visible) && !mB.drillMarks.visible, 'B stopInstall shows the finished assembly');
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
