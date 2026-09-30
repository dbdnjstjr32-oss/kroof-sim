// Cross-module integration smoke test (headless). Run: node tests/smoke.test.mjs
// Builds the container and every design with min/default/max params and checks the CONTRACT,
// then runs the shade analyser + physics on real geometry, exactly as main.js does.
import * as THREE from 'three';
import { CONTAINER, DESIGNS, DESIGN_IDS, ALL_IDS, getDesign, defaultParams, SITES } from '../js/config.js';
import { createMaterials } from '../js/materials.js';
import { buildContainer } from '../js/container.js';
import { dayOfYear, solarPosition } from '../js/physics/sun.js';
import { simulateDay } from '../js/physics/thermal.js';
import { windCheck } from '../js/physics/wind.js';
import { createShadeAnalyzer } from '../js/viz/shade.js';

const builders = {};
for (const id of DESIGN_IDS) builders[id] = (await import(`../js/designs/design${id}.js`)).build;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗', msg); } };
const tris = (obj) => {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const c = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += o.isInstancedMesh ? c * o.count : c;
  });
  return Math.round(n);
};

const mats = createMaterials();

// ---- container
const cont = buildContainer({ mats });
cont.group.updateMatrixWorld(true);
const cb = new THREE.Box3().setFromObject(cont.group);
console.log(`container: tris=${tris(cont.group)} bbox y ${cb.min.y.toFixed(3)}..${cb.max.y.toFixed(3)} x ${cb.min.x.toFixed(2)}..${cb.max.x.toFixed(2)} z ${cb.min.z.toFixed(2)}..${cb.max.z.toFixed(2)}`);
ok(cont.roofMesh?.isMesh, 'container.roofMesh is a mesh');
const rb = new THREE.Box3().setFromObject(cont.roofMesh);
ok(Math.abs(rb.max.y - CONTAINER.roofY) < 0.002, `roof top at ${rb.max.y.toFixed(4)} (want ${CONTAINER.roofY})`);
ok(cb.max.y <= CONTAINER.ringCenterY + CONTAINER.ringR + CONTAINER.ringBarR + 0.01, `container max y ${cb.max.y.toFixed(3)} ≤ ring top`);

// ---- designs
const analyzer = createShadeAnalyzer({ nx: 24, nz: 12 });
const site = SITES[0];
const doy = dayOfYear(7, 25);
const sunDir = (h) => {
  const p = solarPosition({ dayOfYear: doy, hour: h, lat: site.lat, lon: site.lon, tz: site.tz });
  return p.elevation > 0 ? new THREE.Vector3(p.dir.x, p.dir.y, p.dir.z) : null;
};
const hours = Array.from({ length: 49 }, (_, i) => i * 0.5);
const rows = [];

for (const id of DESIGN_IDS) {
  const d = DESIGNS[id];
  for (const which of ['min', 'default', 'max']) {
    const params = defaultParams(id);
    for (const [k, p] of Object.entries(d.params)) params[k] = which === 'default' ? p.default : p[which];
    let m;
    try { m = builders[id]({ mats, params }); } catch (e) { fails++; console.log(`  ✗ ${id} build(${which}) threw: ${e.stack}`); continue; }
    const root = new THREE.Group();
    root.add(cont.group.clone(false));
    root.add(m.group);
    root.updateMatrixWorld(true);

    const tag = `${id}/${which}`;
    ok(m.id === id, `${tag} id`);
    ok(m.group?.isObject3D, `${tag} group`);
    ok(Array.isArray(m.parts) && m.parts.length > 0, `${tag} parts`);
    ok(m.parts.length === d.meta.partKinds || (id === 'C' && m.parts.length >= 3), `${tag} part kinds ${m.parts.length} vs doc ${d.meta.partKinds}`);
    // every object in exactly one install step
    const inStep = new Map();
    for (const s of m.installSteps) for (const o of s.objects) inStep.set(o, (inStep.get(o) || 0) + 1);
    ok([...inStep.values()].every((n) => n === 1), `${tag} objects appear in exactly one step`);
    const covered = new Set();
    for (const o of inStep.keys()) o.traverse((c) => covered.add(c));
    let orphans = 0;
    m.group.traverse((o) => { if (o.isMesh && !covered.has(o)) orphans++; });
    ok(orphans === 0, `${tag} ${orphans} meshes not in any install step`);
    const minutes = m.installSteps.reduce((a, s) => a + s.minutes, 0);
    ok(minutes >= d.meta.installMin[0] && minutes <= d.meta.installMin[1], `${tag} install minutes ${minutes} within ${d.meta.installMin}`);
    ok(m.callouts?.length === 4 && m.callouts.every((c, i) => c.n === i + 1 && c.anchor?.isVector3), `${tag} callouts 1..4 with anchors`);
    ok(m.gapLabel?.anchor?.isVector3, `${tag} gapLabel`);
    ok(m.shadeMeshes?.length > 0 && m.shadeMeshes.every((s) => typeof s.userData.transmittance === 'number'), `${tag} shadeMeshes transmittance`);
    ok(m.topSurfaces?.length > 0, `${tag} topSurfaces`);
    ok(m.windLoose?.length > 0, `${tag} windLoose`);
    ok(m.gap && m.gap.y1 > m.gap.y0 && m.gap.x1 > m.gap.x0 && m.gap.z1 > m.gap.z0, `${tag} gap box`);
    // nothing inside the roof plate footprint below the roof top (allow 2 mm)
    let pen = 0;
    const rr = CONTAINER.roofRect;
    m.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const b = new THREE.Box3().setFromObject(o);
      const inside = b.min.x > rr.x0 + 0.02 && b.max.x < rr.x1 - 0.02 && b.min.z > rr.z0 + 0.02 && b.max.z < rr.z1 - 0.02;
      if (inside && b.min.y < CONTAINER.roofY - 0.002) pen++;
    });
    ok(pen === 0, `${tag} ${pen} meshes penetrate the roof plate`);
    try { m.update?.(1.0, { windSpeed: 5, windDirDeg: 270 }); } catch (e) { fails++; console.log(`  ✗ ${tag} update threw ${e.message}`); }

    if (which === 'default') {
      const t0 = performance.now();
      const prof = analyzer.profile(root, m.shadeMeshes, sunDir, hours);
      const sky = analyzer.skyView(root, m.shadeMeshes, 128);
      const tProf = performance.now() - t0;
      const noon = prof.beamTrans[hours.indexOf(12.5)];
      const morning = prof.beamTrans[hours.indexOf(7.5)];
      const shadeProfile = (h) => {
        const x = h / 0.5, i = Math.min(47, Math.floor(x)), f = x - i;
        return { beamTrans: prof.beamTrans[i] * (1 - f) + prof.beamTrans[i + 1] * f, skyView: sky };
      };
      const th = simulateDay({
        design: d, params, site, dayOfYear: doy,
        weather: { Tmax: 35, Tmin: 26, windSpeed: 1.5, clearness: 0.95 },
        roof: { alpha: 0.7, insulationMm: 50 }, interior: { acOn: true, setpoint: 26, internalGainW: 350 },
        shadeProfile,
      });
      const w = windCheck(d, { V: 26, params });
      rows.push({ id, tris: tris(m.group), steps: m.installSteps.length, minutes, noon: noon.toFixed(2), '07:30': morning.toFixed(2), sky: sky.toFixed(2), profMs: tProf.toFixed(0),
        TroofMax: th.summary.TroofMax.toFixed(1), TshadeMax: th.summary.TshadeMax?.toFixed?.(1), roofKWh: th.summary.roofHeatKWh.toFixed(2), acKWh: th.summary.acKWh.toFixed(2),
        sf26: w.sf.toFixed(2), Vcrit: w.criticalV.toFixed(1), gov: w.governing });
      ok(tris(m.group) < 60000, `${tag} triangles ${tris(m.group)} < 60k`);
    }
  }
}

const base = simulateDay({
  design: getDesign('0'), params: {}, site, dayOfYear: doy,
  weather: { Tmax: 35, Tmin: 26, windSpeed: 1.5, clearness: 0.95 },
  roof: { alpha: 0.7, insulationMm: 50 }, interior: { acOn: true, setpoint: 26, internalGainW: 350 },
});
rows.unshift({ id: '0', TroofMax: base.summary.TroofMax.toFixed(1), roofKWh: base.summary.roofHeatKWh.toFixed(2), acKWh: base.summary.acKWh.toFixed(2) });
console.table(rows);
for (const r of rows.slice(1)) ok(+r.TroofMax < base.summary.TroofMax - 10, `${r.id} roof peak ${r.TroofMax} well below baseline ${base.summary.TroofMax.toFixed(1)}`);

console.log(fails ? `\n${fails} check(s) failed` : '\nall smoke checks passed');
process.exit(fails ? 1 : 0);
