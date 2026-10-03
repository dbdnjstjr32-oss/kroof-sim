// main.js — integrator: scene, units (container + design), state store, physics scheduling, frame loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import * as config from './config.js';
import {
  DESIGNS, DESIGN_IDS, ALL_IDS, SITES, WEATHER_PRESETS, COMPARE_LAYOUT, TEMP_RANGE,
  ROOF, INTERIOR, getDesign, defaultParams, customDefaults,
} from './config.js';
import { effectiveDesign, applySurfaceAppearance } from './custom.js';
import { snapshot, sanitize, deepMerge, decodeShare, shareUrl, createSlotStore } from './scenario.js';
import { createMaterials } from './materials.js';
import { disposeTree } from './parts.js';
import { buildContainer } from './container.js';
import { buildEnvironment } from './environment.js';
import { build as buildA } from './designs/designA.js';
import { build as buildB } from './designs/designB.js';
import { build as buildC } from './designs/designC.js';
import { build as buildD } from './designs/designD.js';
import { build as buildE } from './designs/designE.js';
import { dayOfYear, solarPosition, clearSkyIrradiance, sunTimes, ambientTemperature, sunPath } from './physics/sun.js';
import { simulateDay, sampleAt, THERMAL_ASSUMPTIONS } from './physics/thermal.js';
import { windCheck, sfCurve, WIND_ASSUMPTIONS } from './physics/wind.js';
import { createShadeAnalyzer } from './viz/shade.js';
import { createRoofHeatmap, HEAT_CSS_GRADIENT } from './viz/heatmap.js';
import { createGapFlow } from './viz/flow.js';
import { createSunRays } from './viz/rays.js';
import { createAnimator } from './viz/animator.js';
import { createUI } from './ui/ui.js';

const BUILDERS = { A: buildA, B: buildB, C: buildC, D: buildD, E: buildE };

// ------------------------------------------------------------------ state
const preset = WEATHER_PRESETS[0];
const state = {
  mode: 'single',
  design: 'A',
  siteId: 'seoul', month: preset.month, day: preset.day, hour: 13.5, playing: false, speed: 1.5,
  weatherPreset: preset.id,
  weather: { Tmax: preset.Tmax, Tmin: preset.Tmin, windSpeed: preset.windSpeed, clearness: preset.clearness },
  roof: { alpha: ROOF.alpha, eps: ROOF.eps, insulationMm: ROOF.insulationMm },
  interior: {
    acOn: true, setpoint: INTERIOR.setpoint, internalGainW: INTERIOR.internalGainW,
    wallU: INTERIOR.wallU, windowArea: INTERIOR.windowArea, achInfil: INTERIOR.achInfil, acCOP: INTERIOR.acCOP,
  },
  gust: 26, windDirDeg: 270,
  params: Object.fromEntries(DESIGN_IDS.map((id) => [id, defaultParams(id)])),
  view: { heatmap: true, flow: true, rays: true, labels: true, sunPath: true, section: false, explode: 0, windSim: false },
  camera: 'iso',
  actions: { installSeq: 0, blowSeq: 0 },
  ...customDefaults(),   // surface, windAdj, econ, customSite, ui
};

// Reset target = the defaults as they are BEFORE a shared link or a saved scenario is applied.
const DEFAULT_SNAPSHOT = snapshot(state);

// A share link (#s=…) restores the sender's settings; every value is clamped by sanitize().
const sharedFromLink = typeof location !== 'undefined' ? decodeShare(location.hash) : null;
if (sharedFromLink) deepMerge(state, sharedFromLink);

// Graphics quality survives reloads (it is a per-device setting, not part of a shared scenario).
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
{ const q = lsGet('kroof.quality'); if (['auto', 'low', 'medium', 'high'].includes(q)) state.ui.quality = q; }

// ------------------------------------------------------------------ DOM / renderer
const host = document.getElementById('viewport') || (() => {
  const d = document.createElement('div'); d.id = 'viewport';
  d.style.cssText = 'position:relative;height:70vh;overflow:hidden'; document.body.prepend(d); return d;
})();

function fatal(msg) {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:14px/1.5 system-ui;z-index:50;background:var(--bg,#f4f5f7);color:var(--fg,#1d232b)';
  box.textContent = msg;
  host.appendChild(box);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  fatal('WebGL을 초기화할 수 없습니다. 하드웨어 가속을 켜거나 다른 브라우저에서 열어 주세요.');
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
controls.minDistance = 1.5;
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

const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);   // keeps z ≤ 0 (north half)

/** One yard slot: container + (optional) design + overlays. */
function createUnit(id) {
  const root = new THREE.Group();
  root.name = `unit-${id}`;
  const container = buildContainer({ mats });
  root.add(container.group);
  const heatmap = createRoofHeatmap({ nx: 24, nz: 12 });
  root.add(heatmap.mesh);
  const flow = createGapFlow({ count: 700 });
  root.add(flow.object);

  const d = getDesign(id);
  const tagEl = document.createElement('div');
  tagEl.className = 'unit-tag';
  tagEl.style.setProperty('--c', d.color);
  tagEl.innerHTML = `<b>${id === '0' ? '기존' : id}</b> ${d.name}`;
  tagEl.style.pointerEvents = 'auto';
  tagEl.style.cursor = 'pointer';
  tagEl.addEventListener('click', () => set({ design: id }));
  const tagLabel = new CSS2DObject(tagEl);
  tagLabel.position.set(0, 4.1, 0);
  root.add(tagLabel);

  scene.add(root);
  return { id, root, container, heatmap, flow, tagLabel, model: null, labels: [], profile: null, profileKey: '', trans: null };
}

const units = Object.fromEntries(ALL_IDS.map((id) => [id, createUnit(id)]));

function buildModel(id) {
  const unit = units[id];
  if (id === '0') return;
  if (unit.model) {
    animator.resetBlowOff?.(unit.model);
    unit.root.remove(unit.model.group);
    disposeTree(unit.model.group, sharedMats);
  }
  const model = BUILDERS[id]({ mats, params: { ...state.params[id] } });
  unit.model = model;
  unit.root.add(model.group);
  unit.profileKey = '';
  if (state.view.explode > 0) animator.setExplode(model, state.view.explode);
  applySectionTo(unit.root);
  rebuildLabels(unit);
  unit.flow.setGap(model.gap);
}

// ------------------------------------------------------------------ labels (callouts with leader lines, like the doc figures)
const leaderMat = new THREE.LineBasicMaterial({ color: 0x55606c, transparent: true, opacity: 0.85, depthTest: false });

function rebuildLabels(unit) {
  for (const l of unit.labels) { l.parent?.remove(l); if (l.isLine) l.geometry.dispose(); if (l.element) l.element.remove(); }
  unit.labels = [];
  const m = unit.model;
  if (!m) return;
  const list = m.callouts || [];
  list.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `<span class="n">${c.n}</span><span class="t">${c.text}</span>${c.sub ? `<span class="s">${c.sub}</span>` : ''}`;
    const obj = new CSS2DObject(el);
    // Column of labels east of the container, top to bottom — mirrors the document's right-hand callouts.
    const pos = new THREE.Vector3(3.6, 3.95 - i * 0.5, -0.2 + i * 0.2);
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
  refreshLabelVisibility();
}

/** Screen-space declutter: push overlapping callouts of the selected unit down so none overlap. */
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
    for (const l of u.labels) l.visible = show;
    u.tagLabel.visible = u.root.visible && state.mode === 'compare';
  }
}

// ------------------------------------------------------------------ layout / visibility / section
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
  env.setShadowBounds(state.mode === 'single' ? 7 : 19);
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
  // A single plane can't cut both rows of the yard, so section view always uses the single-unit layout.
  if (state.view.section && state.mode !== 'single') { state.mode = 'single'; applyLayout(); pushInstallSteps(); }
  for (const u of Object.values(units)) applySectionTo(u.root);
  leaderMat.clippingPlanes = [];
}

function applyOverlayVisibility() {
  for (const u of Object.values(units)) {
    u.heatmap.setVisible(state.view.heatmap && u.root.visible && !!results.thermal[u.id]);
    u.flow.setVisible(state.view.flow && u.root.visible);
  }
  rays.setVisible(state.view.rays);
  env.setSunPathVisible(state.view.sunPath);
}

// ------------------------------------------------------------------ camera presets
const CAMS = {
  iso:     { pos: [9.5, 6.5, 11], target: [0, 2.0, 0], fov: 42 },
  section: { pos: [0.9, 2.9, 18],  target: [0.9, 2.35, 0], fov: 30 },   // shifted so the callout column fits on the right
  top:     { pos: [0, 17, 0.6],   target: [0, 2.6, 0], fov: 42 },
  gap:     { pos: [5.4, 3.05, 2.9], target: [1.6, 2.66, 0], fov: 42 },
  yard:    { pos: [24, 17, 28],   target: [0, 1.5, 0], fov: 42 },
};
let camTween = null;
function flyTo(name) {
  const c = CAMS[name] || CAMS.iso;
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
const results = { thermal: {}, wind: {}, curves: {} };
const PROFILE_HOURS = Array.from({ length: 49 }, (_, i) => i * 0.5);

function profileKey(id) {
  const s = site();
  return `${id}|${JSON.stringify(state.params[id])}|${s.lat},${s.lon},${s.tz}|${state.month}-${state.day}`;
}

function ensureProfile(unit) {
  if (!unit.model) return null;
  const key = profileKey(unit.id);
  if (unit.profileKey === key && unit.profile) return unit.profile;
  // Analyse the assembled geometry (no explode / blow-off offsets).
  const k = state.view.explode;
  if (k > 0) animator.setExplode(unit.model, 0);
  unit.root.updateMatrixWorld(true);
  const prof = analyzer.profile(unit.root, unit.model.shadeMeshes, (h) => {
    const s = sunAt(h);
    return s.elevation > 0 ? s.dir : null;
  }, PROFILE_HOURS);
  const skyView = analyzer.skyView(unit.root, unit.model.shadeMeshes, 128);
  if (k > 0) animator.setExplode(unit.model, k);
  unit.profile = { hours: prof.hours, beamTrans: prof.beamTrans, skyView };
  unit.profileKey = key;
  return unit.profile;
}

function profileFn(p) {
  return (hour) => {
    const x = Math.max(0, Math.min(24, hour)) / 0.5;
    const i = Math.min(p.beamTrans.length - 2, Math.floor(x));
    const f = x - i;
    return { beamTrans: p.beamTrans[i] * (1 - f) + p.beamTrans[i + 1] * f, skyView: p.skyView };
  };
}

function runThermal(ids = ALL_IDS) {
  const s = site();
  for (const id of ids) {
    const unit = units[id];
    const p = id === '0' ? null : ensureProfile(unit);
    const opts = {
      design: effectiveDesign(id, state),
      params: state.params[id] || {},
      site: { lat: s.lat, lon: s.lon, tz: s.tz },
      dayOfYear: doy(),
      weather: { ...state.weather },
      roof: { ...state.roof },
      interior: { ...state.interior },
      shadeProfile: p ? profileFn(p) : undefined,
    };
    const r = simulateDay(opts);
    // With AC on the room is pinned at the setpoint, so also report the free-floating (AC-off) indoor peak.
    r.summary.TinMaxFree = state.interior.acOn
      ? simulateDay({ ...opts, interior: { ...opts.interior, acOn: false } }).summary.TinMax
      : r.summary.TinMax;
    // Daily electricity with AC on, independent of the AC switch — what the payback estimate is based on.
    r.summary.acKWhRef = state.interior.acOn
      ? r.summary.acKWh
      : simulateDay({ ...opts, interior: { ...opts.interior, acOn: true } }).summary.acKWh;
    results.thermal[id] = r;
  }
}

function runWind(ids = DESIGN_IDS) {
  for (const id of ids) {
    const adj = state.windAdj;
    results.wind[id] = windCheck(effectiveDesign(id, state), { V: state.gust, params: state.params[id], capScale: adj.capScale, cpScale: adj.cpScale });
    results.curves[id] = sfCurve(effectiveDesign(id, state), state.params[id], 50, 1, adj);
  }
}

// Heavy work is batched and debounced.
const dirty = { rebuild: new Set(), thermal: new Set(), wind: new Set(), sunPath: false };
let flushTimer = 0;
function schedule() {
  clearTimeout(flushTimer);
  ui?.setBusy?.(true);
  flushTimer = setTimeout(flush, 90);
}
function flush() {
  try {
    for (const id of dirty.rebuild) buildModel(id);
    if (dirty.sunPath) updateSunPath();
    if (dirty.thermal.size) runThermal([...dirty.thermal]);
    if (dirty.wind.size) runWind([...dirty.wind]);
  } catch (e) {
    console.error(e);
    ui?.toast?.(`계산 오류: ${e.message}`);
  }
  const rebuilt = dirty.rebuild.size > 0;
  dirty.rebuild.clear(); dirty.thermal.clear(); dirty.wind.clear(); dirty.sunPath = false;
  ui?.renderResults?.({ ...results });
  if (rebuilt) pushInstallSteps();
  ui?.setBusy?.(false);
  hourDirty = true;
}

// ------------------------------------------------------------------ set(): the single entry point for state changes
let ui = null;
let hourDirty = true;

function set(patch) {
  const prev = JSON.parse(JSON.stringify(state));
  deepMerge(state, patch);
  const changed = (path) => JSON.stringify(path(prev)) !== JSON.stringify(path(state));

  if (patch.weatherPreset && changed((s) => s.weatherPreset)) {
    const w = WEATHER_PRESETS.find((p) => p.id === state.weatherPreset);
    if (w && !patch.weather) {
      Object.assign(state.weather, { Tmax: w.Tmax, Tmin: w.Tmin, windSpeed: w.windSpeed, clearness: w.clearness });
      state.month = w.month; state.day = w.day;
    }
  }

  let heavy = false;
  if (changed((s) => s.params)) {
    for (const id of DESIGN_IDS) {
      if (JSON.stringify(prev.params[id]) !== JSON.stringify(state.params[id])) {
        dirty.rebuild.add(id); dirty.thermal.add(id); dirty.wind.add(id); heavy = true;
      }
    }
  }
  if (changed((s) => [s.siteId, s.month, s.day, s.siteId === 'custom' ? s.customSite : 0])) {
    ALL_IDS.forEach((id) => dirty.thermal.add(id)); dirty.sunPath = true; heavy = true; hourDirty = true;
  }
  if (changed((s) => [s.weather, s.roof, s.interior])) { ALL_IDS.forEach((id) => dirty.thermal.add(id)); heavy = true; hourDirty = true; }
  if (changed((s) => s.surface)) {
    applySurfaceAppearance(mats, state.surface);
    ALL_IDS.forEach((id) => dirty.thermal.add(id)); DESIGN_IDS.forEach((id) => dirty.wind.add(id)); heavy = true; hourDirty = true;
  }
  if (changed((s) => [s.gust, s.windAdj])) { DESIGN_IDS.forEach((id) => dirty.wind.add(id)); heavy = true; }
  if (changed((s) => s.ui.quality)) { applyQuality(); lsSet('kroof.quality', state.ui.quality); }
  if (changed((s) => s.ui.autoRotate)) controls.autoRotate = !!state.ui.autoRotate;
  if (changed((s) => s.hour)) hourDirty = true;

  if (changed((s) => [s.mode, s.design])) {
    applyLayout();
    pushInstallSteps();
    if (changed((s) => s.mode)) flyTo(state.mode === 'compare' ? 'yard' : state.camera === 'yard' ? 'iso' : state.camera);
    else if (state.mode === 'compare') flyTo(state.camera === 'yard' ? 'yard' : state.camera);
    ui?.renderResults?.({ ...results });
  }
  if (changed((s) => s.view.section)) applySection();
  if (changed((s) => [s.view.heatmap, s.view.flow, s.view.rays, s.view.sunPath])) applyOverlayVisibility();
  if (changed((s) => s.view.labels)) refreshLabelVisibility();
  if (changed((s) => s.view.explode)) {
    for (const u of Object.values(units)) if (u.model) animator.setExplode(u.model, state.view.explode);
    hourDirty = true;
  }
  if (changed((s) => s.view.windSim) && !state.view.windSim) {
    for (const u of Object.values(units)) if (u.model) animator.resetBlowOff(u.model);
    hourDirty = true;
  }
  if (changed((s) => s.camera)) {
    if (state.camera === 'section' && !state.view.section) { state.view.section = true; applySection(); }
    if (state.camera === 'yard' && state.mode !== 'compare') { state.mode = 'compare'; applyLayout(); }
    flyTo(state.camera);
  }
  if (changed((s) => s.actions.installSeq)) startInstall();
  if (changed((s) => s.actions.blowSeq)) startBlow();

  if (heavy) schedule();
  ui?.syncFromState?.();
}

// ------------------------------------------------------------------ install / wind actions
const selectedUnit = () => units[state.design];

function pushInstallSteps() {
  const m = selectedUnit().model;
  const steps = m ? m.installSteps.map((s) => ({ title: s.title, minutes: s.minutes })) : [];
  ui?.setInstall?.({ running: false, stepIndex: -1, steps, elapsedMin: 0, totalMin: steps.reduce((a, s) => a + s.minutes, 0) });
}

function startInstall() {
  const m = selectedUnit().model;
  if (!m) { ui?.toast?.('기존 지붕에는 설치할 차열 구조물이 없습니다. 설계안 A~E를 선택하세요.'); return; }
  if (state.view.explode > 0) { state.view.explode = 0; for (const u of Object.values(units)) if (u.model) animator.setExplode(u.model, 0); }
  animator.resetBlowOff(m);
  const steps = m.installSteps.map((s) => ({ title: s.title, minutes: s.minutes }));
  const totalMin = steps.reduce((a, s) => a + s.minutes, 0);
  animator.playInstall(m, {
    speed: 1,
    onStep: (i, step, elapsedMin) => { ui?.setInstall?.({ running: true, stepIndex: i, steps, elapsedMin, totalMin }); hourDirty = true; },
    onDone: () => { ui?.setInstall?.({ running: false, stepIndex: steps.length, steps, elapsedMin: totalMin, totalMin }); hourDirty = true; },
  });
  if (state.camera !== 'iso' && state.camera !== 'gap') { state.camera = 'iso'; flyTo('iso'); }
}

function startBlow() {
  const id = state.design;
  if (id === '0') { ui?.toast?.('설계안 A~E를 선택하면 풍하중 이탈을 시뮬레이션합니다.'); return; }
  const w = results.wind[id] || windCheck(effectiveDesign(id, state), { V: state.gust, params: state.params[id], capScale: state.windAdj.capScale, cpScale: state.windAdj.cpScale });
  state.view.windSim = true;
  if (w.sf < 1) {
    animator.blowOff(units[id].model, { windDirDeg: state.windDirDeg, V: state.gust });
    ui?.toast?.(`${state.gust} m/s: 안전율 ${w.sf.toFixed(2)} < 1 — "${w.governing}" 단계에서 이탈합니다.`);
  } else {
    ui?.toast?.(`${state.gust} m/s: 안전율 ${w.sf.toFixed(2)} — 이탈하지 않습니다. 한계풍속 ${w.criticalV.toFixed(1)} m/s 이상으로 올려 보세요.`);
  }
  hourDirty = true;
  ui?.syncFromState?.();
}

// ------------------------------------------------------------------ per-frame overlays
let rr = 0;   // round-robin index for heat-map ray casting
// Only parts that are actually shown cast shade (matters mid-install, when later steps are still hidden).
const isShown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
const shownOnly = (list) => (animator.isInstalling?.() ? list.filter(isShown) : list);

function updateHeatFor(unit) {
  const th = results.thermal[unit.id];
  if (!th) return;
  const s = sampleAt(th, state.hour);
  let trans;
  if (unit.model && sunNow.elevation > 0) {
    trans = analyzer.gridTransmittance(unit.root, shownOnly(unit.model.shadeMeshes), sunNow.dir);
  } else {
    trans = new Float32Array(24 * 12).fill(sunNow.elevation > 0 ? 1 : 0);
  }
  unit.trans = trans;
  unit.heatmap.update(trans, s.TroofSun, s.TroofShade);
}

function updateOverlays() {
  const visible = Object.values(units).filter((u) => u.root.visible);
  if (!visible.length) return;
  // Selected unit every tick, others round-robin (ray casting is the expensive part).
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
  for (const id of ALL_IDS) if (results.thermal[id]) sample[id] = sampleAt(results.thermal[id], state.hour);
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
  low:    { pixelRatio: 1,   shadow: 1024, particles: 250 },
  medium: { pixelRatio: 1.5, shadow: 2048, particles: 450 },
  high:   { pixelRatio: 2,   shadow: 4096, particles: 700 },
};
function resolveQuality() {
  if (state.ui.quality !== 'auto') return state.ui.quality;
  // phones/tablets (coarse pointer) start at 'medium' to keep the 6-unit yard smooth
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

// ------------------------------------------------------------------ scenarios (save / load / share / reset)
const slotStore = createSlotStore((() => { try { return localStorage; } catch { return null; } })());
const scenario = {
  snapshot: () => snapshot(state),
  apply(obj) { const clean = sanitize(obj); if (!Object.keys(clean).length) return false; set(clean); return true; },
  reset() { set(JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT))); ui?.toast?.('설정을 초기화했습니다.'); },
  shareUrl: () => shareUrl(location.href, snapshot(state), DEFAULT_SNAPSHOT),
  slots: {
    list: () => slotStore.list(),
    save(name) {
      const ok = slotStore.save(name, snapshot(state));
      ui?.toast?.(ok ? `'${String(name).trim().slice(0, 24)}' 저장했습니다.` : '저장할 수 없습니다. 이름을 확인하거나 브라우저 저장소 설정을 확인하세요.');
      return ok;
    },
    load(name) {
      const data = slotStore.load(name);
      if (!data) { ui?.toast?.('저장된 설정을 불러올 수 없습니다.'); return false; }
      set(data); ui?.toast?.(`'${name}' 불러왔습니다.`); return true;
    },
    remove: (name) => slotStore.remove(name),
  },
};

// ------------------------------------------------------------------ boot
applySurfaceAppearance(mats, state.surface);
ui = createUI({ state, set, config, scenario, legend: { css: HEAT_CSS_GRADIENT, min: TEMP_RANGE[0], max: TEMP_RANGE[1] } });
if (sharedFromLink) ui?.toast?.('공유받은 설정을 불러왔습니다.');
ui?.setAssumptions?.({ thermal: THERMAL_ASSUMPTIONS, wind: WIND_ASSUMPTIONS });

for (const id of DESIGN_IDS) buildModel(id);
units['0'].flow.setGap(null);
applyLayout();
applySection();
applyQuality();
controls.autoRotate = !!state.ui.autoRotate;
controls.autoRotateSpeed = 1.2;
updateSunPath();
updateSun();
ui?.setBusy?.(true);
// Let the first frame paint before the heavier shading + thermal pass.
// (setTimeout, not requestAnimationFrame: rAF is paused in background tabs, which would stall the first results.)
setTimeout(() => {
  runThermal();
  runWind();
  applyOverlayVisibility();
  ui?.renderResults?.({ ...results });
  pushInstallSteps();
  ui?.setBusy?.(false);
  ui?.syncFromState?.();
  hourDirty = true;
}, 60);

// Keyboard: space = play/pause (ignored while typing)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  set({ playing: !state.playing });
});

// ------------------------------------------------------------------ frame loop
const clock = new THREE.Clock();
let elapsed = 0, tick = 0, clockTick = 0;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function frame() {
  advance(Math.min(0.05, clock.getDelta()));
  requestAnimationFrame(frame);
}

/** One simulation/render step. Also callable from the console (kroof.advance) for headless inspection. */
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
  if (clockTick > 0.1) { clockTick = 0; pushClock(); if (state.view.labels) declutterLabels(); }

  // Airflow + design animations
  const windNow = state.view.windSim ? state.gust : state.weather.windSpeed;
  for (const u of Object.values(units)) {
    if (!u.root.visible) continue;
    const th = results.thermal[u.id];
    const s = th ? sampleAt(th, state.hour) : null;
    u.flow.update(dt, {
      windSpeed: state.weather.windSpeed,
      windDirDeg: state.windDirDeg,
      gapVelocity: s ? s.gapVelocity : undefined,
      Tin: s ? s.Ta : 30,
      Tout: s ? (u.model ? s.Tgap : s.TroofSun) : 40,
    });
    u.model?.update?.(elapsed, { windSpeed: windNow, windDirDeg: state.windDirDeg });
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

// Debug handle for the console
window.kroof = { state, set, units, results, scene, camera, renderer, controls, advance, flush, scenario, get ui() { return ui; } };
