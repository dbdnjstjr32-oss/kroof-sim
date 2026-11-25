// main.js — integrator: scene, 4 container units (A, B, C, Cp), state store, physics, animations.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import * as config from './config.js';
import {
  DESIGN_IDS, ALL_IDS, SITES, WEATHER_PRESETS, COMPARE_LAYOUT, TEMP_RANGE,
  ROOF, INTERIOR, getDesign, customDefaults, displayId,
  CP_CANDIDATES, cpSurfaceOf, isCpAdjusted,
} from './config.js';
import { effectiveDesign, cpDesignFor } from './custom.js';
import { snapshot, sanitize, deepMerge, decodeShare, shareUrl, createSlotStore } from './scenario.js';
import { createMaterials } from './materials.js';
import { disposeTree } from './parts.js';
import { buildContainer } from './container.js';
import { buildEnvironment } from './environment.js';
import { build as buildB } from './designs/designB.js';
import { build as buildC } from './designs/designC.js';
import { build as buildCp } from './designs/designCp.js';
import { dayOfYear, solarPosition, clearSkyIrradiance, sunTimes, ambientTemperature, sunPath } from './physics/sun.js';
import { simulatePair, sampleAt, THERMAL_ASSUMPTIONS } from './physics/thermal.js';
import { createShadeAnalyzer } from './viz/shade.js';
import { createRoofHeatmap, HEAT_CSS_GRADIENT } from './viz/heatmap.js';
import { createGapFlow } from './viz/flow.js';
import { createSunRays } from './viz/rays.js';
import { createAnimator, disassemblySequence } from './viz/animator.js';
import { createUI } from './ui/ui.js';

const BUILDERS = { B: buildB, C: buildC, Cp: buildCp };

// ------------------------------------------------------------------ state
const preset = WEATHER_PRESETS[0];
const state = {
  mode: 'single',
  design: 'C',
  siteId: 'seoul',
  month: preset.month,
  day: preset.day,
  hour: 14.0,
  playing: false,
  speed: 1.5,
  weatherPreset: preset.id,
  weather: { Tmax: preset.Tmax, Tmin: preset.Tmin, windSpeed: preset.windSpeed, clearness: preset.clearness },
  roof: { alpha: ROOF.alpha, eps: ROOF.eps, insulationMm: ROOF.insulationMm },
  interior: {
    acOn: INTERIOR.acOn,
    setpoint: INTERIOR.setpoint,
    internalGainW: INTERIOR.internalGainW,
    wallU: INTERIOR.wallU,
    achInfil: INTERIOR.achInfil,
    acStartHour: INTERIOR.acStartHour,
    acEndHour: INTERIOR.acEndHour,
  },
  windDirDeg: 180,
  view: { heatmap: true, flow: true, rays: true, labels: true, sunPath: true, section: false, explode: 0 },
  camera: 'iso',
  actions: { installSeq: 0, disassembleSeq: 0, restoreSeq: 0 },
  ...customDefaults(),
};

const DEFAULT_SNAPSHOT = snapshot(state);
const sharedFromLink = typeof location !== 'undefined' ? decodeShare(location.hash) : null;
if (sharedFromLink) deepMerge(state, sharedFromLink);

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
{ const q = lsGet('kroof.quality'); if (['auto', 'low', 'medium', 'high'].includes(q)) state.ui.quality = q; }

// ------------------------------------------------------------------ DOM / renderer
const host = document.getElementById('viewport') || (() => {
  const d = document.createElement('div'); d.id = 'viewport';
  d.style.cssText = 'position:relative;height:70vh;overflow:hidden'; document.body.prepend(d); return d;
})();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center';
  box.textContent = 'WebGL을 초기화할 수 없습니다. 브라우저 하드웨어 가속을 확인해 주세요.';
  host.appendChild(box);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.localClippingEnabled = true;
renderer.domElement.className = 'gl-canvas';
renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
host.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'label-layer';
labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
renderer.domElement.after(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 2000);
camera.position.set(9.5, 6.5, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 0.35;
controls.maxDistance = 90;

function resize() {
  const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();

// ------------------------------------------------------------------ world
const mats = createMaterials();
const sharedMats = new Set(Object.values(mats));
const env = buildEnvironment({ scene, renderer, mats });
const analyzer = createShadeAnalyzer({ nx: 24, nz: 12 });
const animator = createAnimator();
const rays = createSunRays();
scene.add(rays.group);

const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

function createUnit(id) {
  const root = new THREE.Group();
  root.name = `unit-${id}`;
  const container = buildContainer({ mats });
  container.setInsulation(state.roof.insulationMm);
  root.add(container.group);
  const heatmap = createRoofHeatmap({ nx: 24, nz: 12 });
  root.add(heatmap.mesh);
  const flow = createGapFlow({ count: 600 });
  root.add(flow.object);

  const d = getDesign(id);
  const tagEl = document.createElement('div');
  tagEl.className = 'unit-tag';
  tagEl.style.setProperty('--c', d.color);
  tagEl.innerHTML = `<b>${displayId(id)}</b> ${d.name}`;
  tagEl.style.pointerEvents = 'auto';
  tagEl.style.cursor = 'pointer';
  tagEl.addEventListener('click', () => set({ design: id }));
  const tagLabel = new CSS2DObject(tagEl);
  tagLabel.position.set(0, 4.2, 0);
  root.add(tagLabel);

  scene.add(root);
  return { id, root, container, heatmap, flow, tagLabel, model: null, labels: [] };
}

const units = Object.fromEntries(ALL_IDS.map((id) => [id, createUnit(id)]));

function buildModel(id) {
  const unit = units[id];
  if (!BUILDERS[id]) return;
  if (unit.model) {
    unit.root.remove(unit.model.group);
    disposeTree(unit.model.group, sharedMats);
  }
  const model = BUILDERS[id]({ mats });
  unit.model = model;
  unit.root.add(model.group);
  if (state.view.explode > 0) animator.setExplode(model, state.view.explode);
  applySectionTo(unit.root);
  rebuildLabels(unit);
  unit.flow.setGap(model.gap);
}

const leaderMat = new THREE.LineBasicMaterial({ color: 0x55606c, transparent: true, opacity: 0.85, depthTest: false });

function rebuildLabels(unit) {
  for (const l of unit.labels) { l.parent?.remove(l); if (l.isLine) l.geometry.dispose(); if (l.element) l.element.remove(); }
  unit.labels = [];
  const m = unit.model;
  if (!m) return;
  (m.callouts || []).forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `<span class="n">${c.n}</span><span class="t">${c.text}</span>${c.sub ? `<span class="s">${c.sub}</span>` : ''}`;
    const obj = new CSS2DObject(el);
    const pos = new THREE.Vector3(3.65, 4.05 - i * 0.55, -0.2 + i * 0.2);
    obj.position.copy(pos);
    obj.center.set(0, 0.5);
    unit.root.add(obj);
    unit.labels.push(obj);
    if (c.anchor) {
      const g = new THREE.BufferGeometry().setFromPoints([c.anchor.clone(), pos.clone().add(new THREE.Vector3(-0.05, 0, 0))]);
      const line = new THREE.Line(g, leaderMat);
      line.renderOrder = 999;
      unit.root.add(line);
      unit.labels.push(line);
    }
  });
  if (m.gapLabel) {
    const el = document.createElement('div');
    el.className = 'gap-label';
    el.textContent = m.gapLabel.text;
    const obj = new CSS2DObject(el);
    obj.position.copy(m.gapLabel.anchor);
    unit.root.add(obj);
    unit.labels.push(obj);
  }
  // Warning labels that only appear with their reveal object (B안: drill holes / repair needed after teardown)
  for (const nt of m.notices || []) {
    const el = document.createElement('div');
    el.className = `notice-label${nt.tone ? ` is-${nt.tone}` : ''}`;
    const t = document.createElement('span'); t.className = 't'; t.textContent = nt.text; el.append(t);
    if (nt.sub) { const s = document.createElement('span'); s.className = 's'; s.textContent = nt.sub; el.append(s); }
    const obj = new CSS2DObject(el);
    obj.position.copy(nt.anchor);
    obj.userData.showWith = nt.showWith || null;
    unit.root.add(obj);
    unit.labels.push(obj);
  }
  refreshLabelVisibility();
}

/** C′ callouts follow the adjustable surface properties (ρ, ε) shown in the labels. */
function refreshCpCallouts() {
  const unit = units.Cp;
  if (!unit?.model) return;
  const eff = effectiveDesign('Cp', state);
  for (const c of unit.model.callouts) {
    const e = eff.callouts.find((x) => x.n === c.n);
    if (e) { c.text = e.text; c.sub = e.sub; }
  }
  rebuildLabels(unit);
}

function declutterLabels() {
  const els = selectedUnit().labels.filter((l) => l.isCSS2DObject && l.visible && l.element.classList.contains('callout')).map((l) => l.element);
  if (els.length < 2) return;
  for (const e of els) e.style.marginTop = '0px';
  const rects = els.map((e) => ({ e, r: e.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
  let floor = -Infinity;
  for (const { e, r } of rects) {
    const shift = Math.max(0, floor + 4 - r.top);
    if (shift > 0) e.style.marginTop = `${shift}px`;
    floor = r.bottom + shift;
  }
}

function refreshLabelVisibility() {
  for (const u of Object.values(units)) {
    const show = state.view.labels && u.root.visible && (state.mode === 'single' ? u.id === state.design : false);
    for (const l of u.labels) l.visible = show && (!l.userData.showWith || l.userData.showWith.visible);
    u.tagLabel.visible = u.root.visible && state.mode === 'compare';
  }
}

// Notice labels track their reveal objects, which the animator toggles during a teardown; B's heat-map follows its panels.
function syncNotices() {
  const uB = units.B;
  if (uB) {
    const want = state.view.heatmap && uB.root.visible && !!results.thermal.B && !roofCovered(uB);
    if (uB.heatmap.mesh.visible !== want) uB.heatmap.setVisible(want);
  }
  for (const u of Object.values(units)) {
    const show = state.view.labels && u.root.visible && state.mode === 'single' && u.id === state.design;
    for (const l of u.labels) {
      const w = l.userData.showWith;
      if (!w) continue;
      const want = show && w.visible;
      if (l.visible !== want) l.visible = want;
    }
  }
}

function applyLayout() {
  for (const u of Object.values(units)) {
    if (state.mode === 'single') {
      u.root.visible = u.id === state.design;
      u.root.position.set(0, 0, 0);
    } else {
      const p = COMPARE_LAYOUT[u.id];
      u.root.visible = true;
      u.root.position.set(p.x, 0, p.z);
    }
  }
  scene.updateMatrixWorld(true);
  env.setShadowBounds(state.mode === 'single' ? 7 : 16);
  refreshLabelVisibility();
  applyOverlayVisibility();
  hourDirty = true;
}

function applySectionTo(root) {
  const planes = state.view.section ? [sectionPlane] : [];
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; }
  });
}

function applySection() {
  if (state.view.section && state.mode !== 'single') { state.mode = 'single'; applyLayout(); pushInstallSteps(); }
  for (const u of Object.values(units)) applySectionTo(u.root);
  leaderMat.clippingPlanes = [];
}

// B's panels lie flush on the roof: the roof heat-map overlay would bleed through them (polygon offset) and
// veil the white ACP and the screw heads, so it is only shown while the B roof is uncovered (mid-install / torn down).
const roofCovered = (u) => u.id === 'B' && !!u.model && u.model.topSurfaces.some((o) => isShown(o));

function applyOverlayVisibility() {
  for (const u of Object.values(units)) {
    u.heatmap.setVisible(state.view.heatmap && u.root.visible && !!results.thermal[u.id] && !roofCovered(u));
    // B안 has 0 mm air gap: never display air-gap airflow particles inside B
    const hasAirFlow = u.id !== 'B';
    u.flow.setVisible(state.view.flow && u.root.visible && hasAirFlow);
  }
  rays.setVisible(state.view.rays);
  env.setSunPathVisible(state.view.sunPath);
}

// ------------------------------------------------------------------ camera presets
const CAMS = {
  iso:     { pos: [9.5, 6.8, 11], target: [0, 2.1, 0], fov: 42 },
  section: { pos: [0.9, 3.0, 17], target: [0.9, 2.45, 0], fov: 30 },
  top:     { pos: [0, 16, 0.6],   target: [0, 2.8, 0], fov: 42 },
  gap:     { pos: [4.8, 3.2, 3.4], target: [1.0, 2.88, 0], fov: 40 },
  detail:  { pos: [3.62, 2.98, 2.32], target: [2.88, 2.74, 1.48], fov: 34 },
  roof:    { pos: [4.4, 4.7, 3.9], target: [0.7, 2.78, 0.25], fov: 40 },   // whole roof surface, close enough for screws/holes
  yard:    { pos: [17, 13, 21],   target: [0, 1.6, 0], fov: 42 },
};
// Design-specific presets: B's "상세" looks at the SE roof corner screws + EPDM washers instead of a strap.
const CAMS_BY_DESIGN = {
  B: { detail: { pos: [3.36, 3.06, 1.98], target: [2.72, 2.80, 1.28], fov: 30 } },
};
const camPreset = (name) => CAMS_BY_DESIGN[state.design]?.[name] || CAMS[name] || CAMS.iso;
let camTween = null;
function flyTo(name) {
  const c = camPreset(name);
  const off = state.mode === 'compare' && name !== 'yard' ? COMPARE_LAYOUT[state.design] : { x: 0, z: 0 };
  camTween = {
    t: 0, dur: 0.9,
    p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov,
    p1: new THREE.Vector3(c.pos[0] + off.x, c.pos[1], c.pos[2] + off.z),
    t1: new THREE.Vector3(c.target[0] + off.x, c.target[1], c.target[2] + off.z),
    f1: c.fov,
  };
}
controls.addEventListener('start', () => { camTween = null; });

// ------------------------------------------------------------------ sun
let sunNow = { dir: new THREE.Vector3(0, 1, 0), azimuth: 180, elevation: 60, ghi: 0, dni: 0, dhi: 0 };
const site = () => (state.siteId === 'custom'
  ? { id: 'custom', name: '직접 입력', lat: state.customSite.lat, lon: state.customSite.lon, tz: state.customSite.tz }
  : SITES.find((s) => s.id === state.siteId) || SITES[0]);
const doy = () => dayOfYear(state.month, state.day);

function sunAt(hour) {
  const s = site();
  const p = solarPosition({ dayOfYear: doy(), hour, lat: s.lat, lon: s.lon, tz: s.tz });
  const irr = clearSkyIrradiance({ elevationDeg: p.elevation, dayOfYear: doy(), clearness: state.weather.clearness });
  return { dir: new THREE.Vector3(p.dir.x, p.dir.y, p.dir.z), azimuth: p.azimuth, elevation: p.elevation, ...irr };
}

function updateSun() {
  sunNow = sunAt(state.hour);
  env.setSun({ dir: sunNow.dir, elevationDeg: sunNow.elevation, ghi: sunNow.ghi });
}

function updateSunPath() {
  const s = site();
  const pts = sunPath({ dayOfYear: doy(), lat: s.lat, lon: s.lon, tz: s.tz, stepMin: 10 });
  env.setSunPath(pts.map((p) => new THREE.Vector3(p.dir.x, p.dir.y, p.dir.z)));
}

// ------------------------------------------------------------------ physics
// thermal: {A, B, C, Cp} (Cp with the current, possibly adjusted, surface properties)
// cpBase: original C′ under the same conditions · cpCandidates: the 2-3 candidate conditions (computed in the background)
const results = { thermal: {}, cpBase: null, cpCandidates: {}, cpSurface: cpSurfaceOf(state), cpAdjusted: false };

function thermalOpts(design) {
  const s = site();
  return {
    design,
    site: { lat: s.lat, lon: s.lon, tz: s.tz },
    dayOfYear: doy(),
    weather: { ...state.weather },
    roof: { ...state.roof },
    interior: { ...state.interior },
  };
}

// C′ reference runs depend only on the shared conditions, not on the C′ sliders → cache per condition set.
const cpCache = { key: '', base: null, cand: {} };
let candTimer = 0;
const conditionKey = () => JSON.stringify([site(), doy(), state.weather, state.roof, state.interior]);

function publishCp() {
  results.cpSurface = cpSurfaceOf(state);
  results.cpAdjusted = isCpAdjusted(state);
  results.cpBase = cpCache.base;
  results.cpCandidates = cpCache.base ? { base: cpCache.base, ...cpCache.cand } : { ...cpCache.cand };
}

function runThermal(ids = ALL_IDS) {
  const key = conditionKey();
  if (key !== cpCache.key) { cpCache.key = key; cpCache.base = null; cpCache.cand = {}; }
  for (const id of ids) results.thermal[id] = simulatePair(thermalOpts(effectiveDesign(id, state)));
  if (!isCpAdjusted(state)) { if (ids.includes('Cp') && results.thermal.Cp) cpCache.base = results.thermal.Cp; }
  else if (!cpCache.base) cpCache.base = simulatePair(thermalOpts(getDesign('Cp')));
  publishCp();
  scheduleCandidates();
}

// One candidate per tick so slider drags and the 3D view stay smooth (~8 ms per candidate pair).
function scheduleCandidates() {
  clearTimeout(candTimer);
  const key = cpCache.key;
  let computed = 0;
  const step = () => {
    if (key !== cpCache.key) return;
    const next = CP_CANDIDATES.find((c) => c.id !== 'base' && !cpCache.cand[c.id]);
    if (!next) {
      if (computed) { publishCp(); ui?.renderResults?.({ ...results }); }
      return;
    }
    try {
      cpCache.cand[next.id] = simulatePair(thermalOpts(cpDesignFor(next)));
      computed++;
    } catch (e) {
      console.error(e);
      return;
    }
    candTimer = setTimeout(step, 0);
  };
  candTimer = setTimeout(step, 30);
}

const dirty = { thermal: new Set(), sunPath: false };
let flushTimer = 0;
function schedule() {
  clearTimeout(flushTimer);
  ui?.setBusy?.(true);
  flushTimer = setTimeout(flush, 60);
}
function flush() {
  try {
    if (dirty.sunPath) updateSunPath();
    if (dirty.thermal.size) runThermal([...dirty.thermal]);
  } catch (e) {
    console.error(e);
    ui?.toast?.(`계산 오류: ${e.message}`);
  }
  dirty.thermal.clear(); dirty.sunPath = false;
  ui?.renderResults?.({ ...results });
  ui?.setBusy?.(false);
  hourDirty = true;
}

// ------------------------------------------------------------------ set()
let ui = null;
let hourDirty = true;

function set(patch) {
  const prev = JSON.parse(JSON.stringify(state));
  deepMerge(state, patch);
  const changed = (path) => JSON.stringify(path(prev)) !== JSON.stringify(path(state));

  if (patch.weatherPreset && patch.weatherPreset !== 'custom' && changed((s) => s.weatherPreset)) {
    const w = WEATHER_PRESETS.find((p) => p.id === state.weatherPreset);
    if (w && !patch.weather) {
      Object.assign(state.weather, { Tmax: w.Tmax, Tmin: w.Tmin, windSpeed: w.windSpeed, clearness: w.clearness });
      state.month = w.month; state.day = w.day;
    }
  }
  if (state.weather.Tmin > state.weather.Tmax) state.weather.Tmin = state.weather.Tmax;

  let heavy = false;
  if (changed((s) => [s.siteId, s.month, s.day, s.siteId === 'custom' ? s.customSite : 0])) {
    ALL_IDS.forEach((id) => dirty.thermal.add(id)); dirty.sunPath = true; heavy = true; hourDirty = true;
  }
  if (changed((s) => [s.weather, s.roof, s.interior])) {
    ALL_IDS.forEach((id) => dirty.thermal.add(id)); heavy = true; hourDirty = true;
  }
  if (changed((s) => s.cpSurface)) {
    state.cpSurface = cpSurfaceOf(state);
    dirty.thermal.add('Cp'); heavy = true; hourDirty = true;
    refreshCpCallouts();
  }
  if (changed((s) => s.roof.insulationMm)) {
    for (const u of Object.values(units)) u.container.setInsulation(state.roof.insulationMm);
  }
  if (changed((s) => s.ui.quality)) { applyQuality(); lsSet('kroof.quality', state.ui.quality); }
  if (changed((s) => s.ui.autoRotate)) controls.autoRotate = !!state.ui.autoRotate;
  if (changed((s) => s.hour)) hourDirty = true;

  if (changed((s) => [s.mode, s.design])) {
    applyLayout();
    pushInstallSteps();
    if (changed((s) => s.mode)) flyTo(state.mode === 'compare' ? 'yard' : state.camera === 'yard' ? 'iso' : state.camera);
    else if (state.mode === 'compare') flyTo(state.camera === 'yard' ? 'yard' : state.camera);
    else if (state.camera === 'detail' || state.camera === 'roof') flyTo(state.camera);   // design-specific presets
    ui?.renderResults?.({ ...results });
  }
  if (changed((s) => s.view.section)) applySection();
  if (changed((s) => [s.view.heatmap, s.view.flow, s.view.rays, s.view.sunPath])) applyOverlayVisibility();
  if (changed((s) => s.view.labels)) refreshLabelVisibility();
  if (changed((s) => s.view.explode)) {
    for (const u of Object.values(units)) if (u.model) animator.setExplode(u.model, state.view.explode);
    hourDirty = true;
  }
  if (changed((s) => s.camera)) {
    if (state.camera === 'section' && !state.view.section) { state.view.section = true; applySection(); }
    else if (prev.camera === 'section' && state.camera !== 'section' && state.view.section) { state.view.section = false; applySection(); }
    if (state.camera === 'yard' && state.mode !== 'compare') { state.mode = 'compare'; applyLayout(); }
    flyTo(state.camera);
  }
  if (changed((s) => s.actions.installSeq)) startInstall();
  if (changed((s) => s.actions.disassembleSeq)) startDisassemble();
  if (changed((s) => s.actions.restoreSeq)) startRestore();

  if (heavy) schedule();
  ui?.syncFromState?.();
}

// ------------------------------------------------------------------ install / disassemble actions
const selectedUnit = () => units[state.design];

function pushInstallSteps() {
  const m = selectedUnit().model;
  const steps = m ? m.installSteps.map((s) => ({ title: s.title, minutes: s.minutes })) : [];
  ui?.setInstall?.({ running: false, mode: 'install', stepIndex: -1, steps, elapsedMin: 0, totalMin: steps.reduce((a, s) => a + s.minutes, 0) });
}

function switchCamera(name) {
  if (state.camera === name) return;
  if (state.camera === 'section' && state.view.section) { state.view.section = false; applySection(); }
  state.camera = name;
  flyTo(name);
}

// B's screws and drill holes are only legible close to the roof; C/C′ read fine from the iso view.
function cameraForSequence(m) {
  if (m.id === 'B') { if (state.camera !== 'roof' && state.camera !== 'detail') switchCamera('roof'); }
  else if (state.camera !== 'iso' && state.camera !== 'gap') switchCamera('iso');
}

function startInstall() {
  const m = selectedUnit().model;
  if (!m) { ui?.toast?.('A안은 추가 차열 구조물이 없습니다. B, C, C′안을 선택하세요.'); return; }
  if (state.view.explode > 0) { state.view.explode = 0; for (const u of Object.values(units)) if (u.model) animator.setExplode(u.model, 0); }
  const steps = m.installSteps.map((s) => ({ title: s.title, minutes: s.minutes }));
  const totalMin = steps.reduce((a, s) => a + s.minutes, 0);
  animator.playInstall(m, {
    speed: 1,
    onStep: (i, step, elapsedMin) => { ui?.setInstall?.({ running: true, mode: 'install', stepIndex: i, steps, elapsedMin, totalMin }); hourDirty = true; },
    onDone: () => { ui?.setInstall?.({ running: false, mode: 'install', stepIndex: steps.length, steps, elapsedMin: totalMin, totalMin }); hourDirty = true; },
  });
  cameraForSequence(m);
}

function startDisassemble() {
  const m = selectedUnit().model;
  if (!m) { ui?.toast?.('A안은 해체할 차열 구조물이 없습니다. B안, C안 또는 C′안을 선택하세요.'); return; }
  if (state.view.explode > 0) { state.view.explode = 0; for (const u of Object.values(units)) if (u.model) animator.setExplode(u.model, 0); }
  const revSteps = disassemblySequence(m).map((s) => ({ title: s.title, minutes: s.minutes }));
  const totalMin = revSteps.reduce((a, s) => a + s.minutes, 0);
  const doneText = getDesign(m.id)?.disassembleDone || `${displayId(m.id)} 해체 완료 — 무천공 분리·재사용 가능`;
  animator.playDisassemble(m, {
    speed: 1,
    onStep: (i, step, elapsedMin) => { ui?.setInstall?.({ running: true, mode: 'disassemble', stepIndex: i, steps: revSteps, elapsedMin, totalMin }); hourDirty = true; },
    onDone: () => {
      ui?.setInstall?.({ running: false, mode: 'disassemble', stepIndex: revSteps.length, steps: revSteps, elapsedMin: totalMin, totalMin });
      ui?.toast?.(doneText);
      syncNotices();
      hourDirty = true;
    },
  });
  cameraForSequence(m);
}

function startRestore() {
  for (const u of Object.values(units)) if (u.model) animator.restoreAssembled(u.model);
  pushInstallSteps();
  syncNotices();
  hourDirty = true;
  ui?.toast?.('조립 완료 상태로 복원했습니다.');
}

// ------------------------------------------------------------------ overlays
let rr = 0;
const isShown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
// Hidden parts (mid-animation, or removed by a finished teardown) must not catch sun rays.
const shownOnly = (list) => list.filter(isShown);

function activeThermal(entry) {
  if (!entry) return null;
  return state.interior.acOn ? entry.on : entry.off;
}

function updateHeatFor(unit) {
  const th = activeThermal(results.thermal[unit.id]);
  if (!th) return;
  const s = sampleAt(th, state.hour);
  let trans;
  if (unit.model && sunNow.elevation > 0) {
    trans = analyzer.gridTransmittance(unit.root, shownOnly(unit.model.shadeMeshes), sunNow.dir);
  } else {
    trans = new Float32Array(24 * 12).fill(sunNow.elevation > 0 ? 1 : 0);
  }
  unit.heatmap.update(trans, s.TroofBot, s.TroofBot);
}

function updateOverlays() {
  const visible = Object.values(units).filter((u) => u.root.visible);
  if (!visible.length) return;
  const sel = selectedUnit();
  if (sel.root.visible) updateHeatFor(sel);
  const others = visible.filter((u) => u !== sel);
  if (others.length) updateHeatFor(others[rr++ % others.length]);

  if (state.view.rays && sel.root.visible) {
    let targets = sel.model ? shownOnly(sel.model.topSurfaces) : [sel.container.roofMesh];
    if (!targets.length) targets = [sel.container.roofMesh];
    rays.update(sunNow.dir, sel.root, targets, sunNow.elevation);
  }
}

function pushClock() {
  if (!ui?.setClock) return;
  const sample = {};
  for (const id of ALL_IDS) {
    const th = activeThermal(results.thermal[id]);
    if (th) sample[id] = sampleAt(th, state.hour);
  }
  const s = site();
  const times = sunTimes({ dayOfYear: doy(), lat: s.lat, lon: s.lon, tz: s.tz });
  ui.setClock({
    hour: state.hour,
    sun: {
      azimuth: sunNow.azimuth, elevation: sunNow.elevation, ghi: sunNow.ghi, dni: sunNow.dni, dhi: sunNow.dhi,
      sunrise: times.sunrise, sunset: times.sunset, solarNoon: times.solarNoon,
      Ta: ambientTemperature(state.hour, state.weather.Tmin, state.weather.Tmax),
    },
    sample,
  });
}

// ------------------------------------------------------------------ graphics quality
const QUALITY = {
  low:    { pixelRatio: 1,   shadow: 1024, particles: 240 },
  medium: { pixelRatio: 1.5, shadow: 2048, particles: 420 },
  high:   { pixelRatio: 2,   shadow: 4096, particles: 600 },
};
function resolveQuality() {
  if (state.ui.quality !== 'auto') return state.ui.quality;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
}
function applyQuality() {
  const q = QUALITY[resolveQuality()];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  resize();
  const sh = env.sun.shadow;
  if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); sh.map?.dispose?.(); sh.map = null; }
  for (const u of Object.values(units)) u.flow.object.geometry.setDrawRange(0, q.particles);
}

// ------------------------------------------------------------------ scenarios
const slotStore = createSlotStore((() => { try { return localStorage; } catch { return null; } })());
const scenario = {
  snapshot: () => snapshot(state),
  apply(obj) { const clean = sanitize(obj); if (!Object.keys(clean).length) return false; set(clean); return true; },
  reset() { set(JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT))); },
  shareUrl: () => shareUrl(location.href, snapshot(state), DEFAULT_SNAPSHOT),
  slots: {
    list: () => slotStore.list(),
    save(name) { return slotStore.save(name, snapshot(state)); },
    load(name) { const data = slotStore.load(name); if (!data) return false; set(data); return true; },
    remove: (name) => slotStore.remove(name),
  },
};

// ------------------------------------------------------------------ boot
ui = createUI({
  state, set, config, scenario,
  legend: { css: HEAT_CSS_GRADIENT, min: TEMP_RANGE[0], max: TEMP_RANGE[1] },
  designOf: (id) => effectiveDesign(id, state),
});
if (sharedFromLink) ui?.toast?.('공유받은 설정을 불러왔습니다.');
ui?.setAssumptions?.({ thermal: THERMAL_ASSUMPTIONS });

for (const id of DESIGN_IDS) buildModel(id);
refreshCpCallouts();
units.A.flow.setGap(null);
applyLayout();
applySection();
applyQuality();
controls.autoRotate = !!state.ui.autoRotate;
controls.autoRotateSpeed = 1.2;
updateSunPath();
updateSun();
ui?.setBusy?.(true);

setTimeout(() => {
  runThermal();
  applyOverlayVisibility();
  ui?.renderResults?.({ ...results });
  pushInstallSteps();
  ui?.setBusy?.(false);
  ui?.syncFromState?.();
  hourDirty = true;
}, 50);

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  set({ playing: !state.playing });
});

// ------------------------------------------------------------------ frame loop
const clock3 = new THREE.Clock();
let elapsed = 0, tick = 0, clockTick = 0;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function frame() {
  advance(Math.min(0.05, clock3.getDelta()));
  requestAnimationFrame(frame);
}

function advance(dt) {
  elapsed += dt;
  if (state.playing) {
    state.hour = (state.hour + dt * state.speed) % 24;
    hourDirty = true;
  }
  if (hourDirty) updateSun();

  tick += dt; clockTick += dt;
  const animating = animator.busy?.() ?? true;
  if (tick > 0.1 && (hourDirty || animating)) {
    tick = 0;
    updateOverlays();
    hourDirty = false;
  }
  if (clockTick > 0.1) { clockTick = 0; pushClock(); syncNotices(); if (state.view.labels) declutterLabels(); }

  for (const u of Object.values(units)) {
    if (!u.root.visible) continue;
    const th = activeThermal(results.thermal[u.id]);
    const s = th ? sampleAt(th, state.hour) : null;
    u.flow.update(dt, {
      windSpeed: state.weather.windSpeed,
      windDirDeg: state.windDirDeg,
      gapVelocity: s ? s.gapVelocity : undefined,
      Tin: s ? s.Ta : 30,
      Tout: s ? (u.model ? s.Tgap : s.TroofBot) : 40,
    });
    u.model?.update?.(elapsed);
    u.container.update?.(elapsed);
  }
  animator.update(dt);
  env.update?.(dt);

  if (camTween) {
    camTween.t += dt;
    const k = ease(Math.min(1, camTween.t / camTween.dur));
    camera.position.lerpVectors(camTween.p0, camTween.p1, k);
    controls.target.lerpVectors(camTween.t0, camTween.t1, k);
    camera.fov = camTween.f0 + (camTween.f1 - camTween.f0) * k;
    camera.updateProjectionMatrix();
    if (k >= 1) camTween = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.kroof = { state, set, units, results, scene, camera, renderer, controls, advance, flush, scenario, get ui() { return ui; } };
