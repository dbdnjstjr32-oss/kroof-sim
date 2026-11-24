// UI helpers, KPI/compare/chart/CSV formatters, and interactive FakeDOM smoke tests
import { strict as assert } from 'node:assert';
import * as CFG from '../js/config.js';
import { dayOfYear } from '../js/physics/sun.js';
import { simulatePair } from '../js/physics/thermal.js';
import {
  DASH,
  fmtNum,
  fmtSigned,
  fmtPlain,
  fmtHHMM,
  shortName,
  computeCoolingSaving,
  computeKpis,
  COMPARE_COLUMNS,
  buildCompareRows,
  buildTempSeries,
  buildCsv,
  installTimeline,
  installProgress,
  parseNumInput,
  fmtLatLon,
  siteLabel,
  cleanSlotName,
  createConfirmGate,
  normalizeTheme,
  applyThemePref,
  createUI,
} from '../js/ui/ui.js';

let passes = 0;
let fails = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(cond, msg) {
  if (cond) passes++;
  else {
    fails++;
    console.error(`FAIL: ${msg}`);
  }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) passes++;
  else {
    fails++;
    console.error(`FAIL: ${msg}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`);
  }
}

// Compute genuine baseline thermal results for UI tests
const seoul = CFG.SITES[0];
const hw = CFG.WEATHER_PRESETS[0];
const doy = dayOfYear(7, 25);
const realThermal = Object.fromEntries(
  CFG.ALL_IDS.map((id) => [
    id,
    simulatePair({
      design: CFG.getDesign(id),
      site: seoul,
      dayOfYear: doy,
      weather: { ...hw },
      roof: { ...CFG.ROOF },
      interior: { ...CFG.INTERIOR },
    }),
  ])
);

// ================================================================ 1. Pure helpers
eq(shortName('A'), 'A안', 'shortName A');
eq(shortName('Cp'), 'C′안', 'shortName Cp uses prime');
eq(fmtHHMM(14.5), '14:30', 'fmtHHMM 14.5');
eq(fmtNum(-3.24, 1), '−3.2', 'fmtNum uses minus sign');
eq(fmtSigned(2.5, 1), '+2.5', 'fmtSigned positive');
eq(fmtPlain(-0), '0', 'fmtPlain normalizes -0');

// Cooling saving formula (§12.3)
{
  const na0 = computeCoolingSaving(0, 5, false);
  eq([na0.valid, na0.pct, na0.text], [false, null, 'N/A'], 'base=0 -> N/A');
  const naNeg = computeCoolingSaving(-2, 5, false);
  eq(naNeg.text, 'N/A', 'base<0 -> N/A');
  const baseSelf = computeCoolingSaving(25, 25, true);
  eq([baseSelf.valid, baseSelf.pct, baseSelf.text], [true, 0, '0.0'], 'baseline saving -> 0.0');
  const pos = computeCoolingSaving(40, 10, false);
  eq([pos.valid, pos.pct, pos.text], [true, 75, '75.0'], '75.0% positive saving');
  const neg = computeCoolingSaving(10, 12, false);
  ok(neg.valid && neg.pct < 0 && neg.text === '−20.0', 'negative saving preserved without clamping');
}

// KPI tiles (3 AC OFF + 1 AC ON)
{
  const kpis = computeKpis({ sel: 'C', thermal: realThermal, setpoint: 26 });
  eq(kpis.map((k) => k.key), ['roofBot', 'tinMax', 'roofHeat', 'cooling'], '4 KPI keys');
  eq(kpis[0].value, realThermal.C.off.summary.TroofBotMax, 'KPI 1 reads AC OFF TroofBotMax');
  eq(kpis[1].value, realThermal.C.off.summary.TinMax, 'KPI 2 reads AC OFF TinMax');
  eq(kpis[2].value, realThermal.C.off.summary.roofHeatKWh, 'KPI 3 reads AC OFF roofHeatKWh');
  eq(kpis[3].value, realThermal.C.on.summary.coolingKWh, 'KPI 4 reads AC ON coolingKWh');
  ok(kpis[3].deltaText.includes('%') && kpis[3].sub.includes('08:00~18:00'), 'KPI 4 displays % saving & AC window');

  const baseKpis = computeKpis({ sel: 'A', thermal: realThermal, setpoint: 26 });
  eq(baseKpis[3].deltaText, 'A안 대비 절감률 0.0 %', 'Baseline KPI 4 delta text');
}

// 6-column comparison table (design column + 5 COMPARE_COLUMNS)
{
  eq(COMPARE_COLUMNS.length, 5, '5 metric columns + 1 sticky design column = 6 total columns');
  const cmp = buildCompareRows(CFG, { thermal: realThermal });
  eq(cmp.rows.map((r) => r.id), ['A', 'B', 'C', 'Cp'], '4 comparison rows in order A, B, C, Cp');
  const rowC = cmp.rows.find((r) => r.id === 'C');
  const rowA = cmp.rows.find((r) => r.id === 'A');
  ok(rowC.cells.TroofBotMax.best && rowC.cells.coolingKWh.best && rowC.cells.savingPct.best, 'C wins lowest roof/cooling and highest saving');
  eq(rowA.cells.savingPct.text, '0.0%', 'A saving column reads 0.0%');

  const zeroThermal = {
    A: { off: realThermal.A.off, on: { ...realThermal.A.on, summary: { ...realThermal.A.on.summary, coolingKWh: 0 } } },
    B: { off: realThermal.B.off, on: { ...realThermal.B.on, summary: { ...realThermal.B.on.summary, coolingKWh: 2 } } },
  };
  const zeroCmp = buildCompareRows(CFG, { thermal: zeroThermal });
  ok(zeroCmp.rows[1].cells.savingPct.na && zeroCmp.rows[1].cells.savingPct.text === 'N/A', 'zero baseline cooling gives N/A');

  const csv = buildCsv(cmp, { conditions: '서울 · 7월 25일' });
  ok(csv.startsWith('\uFEFF설계안 명칭,지붕 강판 하면 최고온도'), 'CSV starts with UTF-8 BOM & header');
  ok(csv.includes('해석 조건,서울 · 7월 25일') && csv.includes('C안'), 'CSV includes rows & conditions');
}

// 24h temperature chart series filtering
{
  const sBothOff = buildTempSeries(realThermal, { design: 'C', acOn: false, viewTab: 'both', visible: {} }, CFG);
  eq(sBothOff.length, 9, 'both tab returns 4 roof + 4 indoor + 1 air = 9 traces');
  const maxTinOff = Math.max(...sBothOff.find((s) => s.key === 'A:indoor').data.map((p) => p.y));
  const sBothOn = buildTempSeries(realThermal, { design: 'C', acOn: true, viewTab: 'both', visible: {} }, CFG);
  const maxTinOn = Math.max(...sBothOn.find((s) => s.key === 'A:indoor').data.map((p) => p.y));
  ok(maxTinOff > 50 && maxTinOn < 40, `AC chart switch selects off (${maxTinOff.toFixed(1)}) vs on (${maxTinOn.toFixed(1)})`);

  const sRoof = buildTempSeries(realThermal, { design: 'C', acOn: false, viewTab: 'roof', visible: { A: false, air: false } }, CFG);
  eq(sRoof.length, 3, 'roof tab with A & air hidden returns B, C, Cp roof traces');
  ok(sRoof.every((s) => s.kind === 'roof'), 'all traces are roof');
}

// Misc pure helpers
{
  const p = parseNumInput('95', { min: -60, max: 66 }, { decimals: 2 });
  eq([p.ok, p.value, p.clamped], [true, 66, true], 'parseNumInput clamps');
  eq(parseNumInput('bad', { min: 0, max: 10 }).ok, false, 'parseNumInput rejects non-numeric');
  eq(fmtLatLon({ lat: 37.5665, lon: -73.9 }), '37.57°N, 73.90°W', 'fmtLatLon formatting');
  eq(siteLabel('custom', CFG.SITES, { lat: 37.5, lon: 127 }), '직접 입력 (37.50°N, 127.00°E)', 'siteLabel custom');
  eq(cleanSlotName('  가나다 \t 라  ', 5), '가나다', 'cleanSlotName trims and slices');
  const progDis = installProgress({ stepIndex: 1, steps: [{ title: '1' }, { title: '2' }], elapsedMin: 3, totalMin: 10, mode: 'disassemble' });
  eq(progDis.stepText, '해체 2/2', 'installProgress disassemble label');
  eq(installTimeline([{ title: 'a', minutes: 2 }, { title: 'b', minutes: 3 }]).total, 5, 'installTimeline sums minutes');
  let t = 0;
  const gate = createConfirmGate(1000, () => t);
  eq(gate.press(), false, 'first confirm arms');
  t = 500;
  eq(gate.press(), true, 'second confirm within window fires');
  eq(normalizeTheme('bogus'), 'auto', 'normalizeTheme');
}

// ================================================================ 2. FakeDOM + createUI
class FakeText {
  constructor(t) { this.nodeType = 3; this._text = String(t); this.parentNode = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}

class FakeStyle {
  constructor() { this.props = new Map(); }
  setProperty(k, v) { this.props.set(k, String(v)); }
  getPropertyValue(k) { return this.props.get(k) || ''; }
}

class FakeEl {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = {};
    this.style = new FakeStyle();
    this._text = '';
    this._html = null;
    this._value = '';
    this._checked = false;
    this._open = false;
    this._painted = undefined;
    this._selected = false;
    this.dataset = new Proxy({}, {
      get: (_, k) => this.attrs.get(`data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`),
      set: (_, k, v) => { this.attrs.set(`data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`, String(v)); return true; },
    });
  }
  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.attrs.get('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get min() { return this.attrs.get('min') || ''; }
  get max() { return this.attrs.get('max') || ''; }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get open() { return this._open; }
  set open(v) { this._open = !!v; if (this._open) this.setAttribute('open', ''); else this.removeAttribute('open'); }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked; }
  set checked(v) { this._checked = !!v; }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  setAttribute(k, v) {
    const key = String(k);
    const val = String(v);
    this.attrs.set(key, val);
    if (key === 'value') this._value = val;
    if (key === 'open') this._open = true;
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); if (k === 'open') this._open = false; }
  hasAttribute(k) { return this.attrs.has(k); }
  get classList() {
    const el = this;
    const get = () => new Set(el.className.split(/\s+/).filter(Boolean));
    const put = (s) => { el.className = [...s].join(' '); };
    return {
      add: (c) => { const s = get(); s.add(c); put(s); },
      remove: (c) => { const s = get(); s.delete(c); put(s); },
      contains: (c) => get().has(c),
      toggle: (c, force) => { const s = get(); const on = force === undefined ? !s.has(c) : !!force; if (on) s.add(c); else s.delete(c); put(s); return on; },
    };
  }
  _adopt(c) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; }
  append(...nodes) {
    for (const n of nodes.flat()) {
      const node = typeof n === 'string' ? new FakeText(n) : n;
      if (node.nodeType === 1) this._adopt(node);
      this.children.push(node);
    }
  }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this._html = null; this.append(...nodes); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._html = null; this._text = String(v); }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(v) { this.children = []; this._text = ''; this._html = String(v); }
  _all() { const out = []; const walk = (e) => { for (const c of e.children) if (c.nodeType === 1) { out.push(c); walk(c); } }; walk(this); return out; }
  _match(sel) {
    const m = sel.match(/^([A-Za-z0-9]*)(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/);
    if (!m) return false;
    const [, tag, id, cls, attr] = m;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (id && this.id !== id) return false;
    if (cls && !cls.split('.').filter(Boolean).every((c) => this.classList.contains(c))) return false;
    if (attr && !this.hasAttribute(attr)) return false;
    return true;
  }
  querySelector(sel) { return this._all().find((e) => e._match(sel)) || null; }
  querySelectorAll(sel) { return this._all().filter((e) => e._match(sel)); }
  closest(sel) { for (let e = this; e; e = e.parentNode) if (e._match && e._match(sel)) return e; return null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  click() { fire(this, 'click'); }
  focus() { this.ownerDocument.activeElement = this; fire(this, 'focus'); }
  blur() { if (this.ownerDocument.activeElement === this) { this.ownerDocument.activeElement = null; fire(this, 'blur'); } }
  select() { this._selected = true; }
}

function fire(el, type, extra = {}) {
  const ev = { type, target: el, key: undefined, isComposing: false, preventDefault() {}, ...extra };
  for (const fn of el.listeners[type] || []) fn(ev);
  return ev;
}

const rafQueue = [];
const flushRaf = () => { let n = 0; while (rafQueue.length && n++ < 50) rafQueue.splice(0).forEach((f) => f()); };
const settle = async () => { flushRaf(); await sleep(60); flushRaf(); await sleep(60); flushRaf(); };

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a); };

const doc = { activeElement: null, listeners: {} };
doc.createElement = (tag) => new FakeEl(tag, doc);
doc.documentElement = new FakeEl('html', doc);
doc.body = new FakeEl('body', doc);
doc.getElementById = (id) => doc.body._all().find((e) => e.id === id) || null;
doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
doc.addEventListener = () => {};
const mk = (tag, id, parent = doc.body) => { const e = doc.createElement(tag); if (id) e.id = id; parent.append(e); return e; };
const viewport = mk('section', 'viewport'); mk('div', 'hud', viewport);
mk('aside', 'controls'); mk('section', 'dashboard'); mk('div', 'toast');
mk('dd', 'tb-site'); mk('dd', 'tb-mode'); mk('dd', 'tb-status');

const store = new Map();
const observers = [];
let phone = false;
const clipboard = { mode: 'ok', last: null };
Object.assign(globalThis, {
  document: doc,
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  matchMedia: (q) => ({ matches: /max-width/.test(q) ? phone : false, addEventListener() {}, addListener() {} }),
  MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target, opts) { this.target = target; this.opts = opts; } },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: (t) => { clipboard.last = t; return clipboard.mode === 'ok' ? Promise.resolve() : Promise.reject(new Error('denied')); } } },
});

const defaultState = () => ({
  mode: 'single',
  design: 'C',
  siteId: 'seoul',
  month: 7,
  day: 25,
  hour: 14,
  playing: false,
  speed: 1.5,
  camera: 'iso',
  weatherPreset: 'heatwave',
  weather: { Tmax: 35, Tmin: 26, windSpeed: 1.5, clearness: 0.95 },
  roof: { insulationMm: 0 },
  interior: { acOn: false, setpoint: 26 },
  view: { heatmap: true, flow: true, rays: true, labels: true, sunPath: false, section: false, explode: 0 },
  actions: { installSeq: 0, disassembleSeq: 0, restoreSeq: 0 },
  ...CFG.customDefaults(),
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (isObj(v) && isObj(dst[k])) deepMerge(dst[k], v); else dst[k] = v; } return dst; };
const state = defaultState();
const set = (patch) => deepMerge(state, patch);

const slots = new Map();
let resetCalls = 0;
const scenario = {
  snapshot: () => clone(state),
  apply: () => {},
  reset: () => { resetCalls++; },
  shareUrl: () => 'https://example.test/kroof/#s=abc123',
  slots: {
    list: () => [...slots].map(([name, savedAt]) => ({ name, savedAt })),
    save: (name) => { slots.set(name, Date.now()); return true; },
    load: (name) => slots.has(name),
    remove: (name) => { slots.delete(name); },
  },
};

store.set('kroof.ui.theme', 'dark');
const ui = createUI({ state, set, config: CFG, legend: { css: 'x', min: 20, max: 80 }, scenario });
const $ = (id) => doc.getElementById(id);
const toastText = () => $('toast').textContent;
const pick = (el) => { el.checked = true; fire(el, 'change'); };
const setVal = (el, v, type = 'input') => { el.value = String(v); fire(el, type); };

eq(doc.documentElement.getAttribute('data-theme'), 'dark', 'saved theme applied at createUI');
ok(observers.some((o) => o.opts?.attributeFilter?.includes('data-theme')), 'MutationObserver watches data-theme');

// Section structure & controls
const SECTION_ORDER = ['sec-design', 'sec-time', 'sec-weather', 'sec-roof', 'sec-display', 'sec-app', 'sec-scenario'];
eq($('controls').querySelector('.ctl-flow').children.map((e) => e.id), SECTION_ORDER, 'control sections match expected order');
for (const id of SECTION_ORDER) ok($(`${id}-sum`) !== null, `${id} has summary slot`);
for (const id of [
  'ctl-mode-single', 'ctl-mode-compare', 'ctl-design-A', 'ctl-design-B', 'ctl-design-C', 'ctl-design-Cp',
  'ctl-site', 'ctl-month', 'ctl-day', 'ctl-hour', 'ctl-preset', 'ctl-tmax', 'ctl-tmin', 'ctl-windspeed', 'ctl-clearness',
  'ctl-ins-0', 'ctl-ins-50', 'ctl-ac', 'ctl-setpoint', 'btn-install', 'btn-disassemble', 'btn-restore',
  'cam-iso', 'cam-section', 'cam-top', 'cam-gap', 'cam-detail', 'cam-yard',
  'compare-table', 'spec-table', 'chart-temp', 'btn-chart-ac', 'tab-temp-both', 'tab-temp-roof', 'tab-temp-indoor',
  'tog-series-A', 'tog-series-Cp', 'tog-series-air', 'btn-install-2', 'btn-disassemble-2', 'btn-restore-2',
]) {
  ok($(id) !== null, `element #${id} exists`);
}
// Removed features absent (§13, §14.4)
ok($('sec-econ') === null && $('sec-wind') === null && $('econ-table') === null, 'removed econ & wind controls absent');

await settle();
ui.renderResults({ thermal: realThermal });
ui.setBusy(false);
await settle();

// Check rendered comparison table & initial insulation/AC state
{
  const tbodyHtml = $('compare-table').querySelector('tbody').innerHTML;
  for (const id of CFG.ALL_IDS) ok(tbodyHtml.includes(`data-id="${id}"`), `compare table has row ${id}`);
  ok($('temp-note').textContent.includes('0 mm'), 'temp-note starts at 0 mm insulation');
  eq($('ctl-ins-0').checked, true, '0mm segmented selected by default');
  eq($('btn-chart-ac').textContent, '그래프: 냉방 OFF', 'chart AC button starts OFF');
}

// Mode switching (single <-> 4-unit compare) & design selection (C -> Cp) + detail camera
fire($('cam-detail'), 'click');
eq(state.camera, 'detail', 'detail camera button selects detail preset');
pick($('ctl-mode-compare'));
eq(state.mode, 'compare', 'compare mode toggled');
pick($('ctl-design-Cp'));
await settle();
eq(state.design, 'Cp', 'design switched to Cp');
ok($('tb-mode').textContent.includes('C′안'), 'header displays C′안');

// Insulation 0mm <-> 50mm toggle
pick($('ctl-ins-50'));
await settle();
eq(state.roof.insulationMm, 50, '50mm insulation applied');
ok(!$('sec-roof').querySelector('.chg-dot').hidden, 'roof dot active at 50mm');
ok($('temp-note').textContent.includes('50 mm') && $('temp-note').textContent.includes('단열재 실내측 표면이 아닌'), 'temp-note clarifies steel bot vs ins surface');
pick($('ctl-ins-0'));
await settle();
eq(state.roof.insulationMm, 0, '0mm insulation restored');
ok($('sec-roof').querySelector('.chg-dot').hidden, 'roof dot cleared at defaults');

// AC toggle via chart button & tab switches
fire($('btn-chart-ac'), 'click');
await settle();
eq(state.interior.acOn, true, 'chart AC toggle sets interior.acOn=true');
ok($('btn-chart-ac').textContent.includes('냉방 ON (26°C)'), 'chart AC button label updated');
fire($('tab-temp-roof'), 'click');
eq($('tab-temp-roof').getAttribute('aria-pressed'), 'true', 'roof temp tab pressed');
fire($('tog-series-air'), 'click');
eq($('tog-series-air').getAttribute('aria-pressed'), 'false', 'air curve toggled off');

// Weather Tmin <= Tmax coupling
setVal($('ctl-tmax'), '24');
await sleep(180);
await settle();
eq(state.weather.Tmax, 24, 'Tmax updated to 24');
eq(state.weather.Tmin, 24, 'Tmin automatically clamped down to Tmax=24');

// Install / Disassemble / Restore actions + A guard
pick($('ctl-design-A'));
await settle();
fire($('btn-install'), 'click');
eq(state.actions.installSeq, 0, 'install blocked for baseline A');
ok(toastText().includes('A안'), 'baseline A toast shown');
fire($('btn-disassemble'), 'click');
eq(state.actions.disassembleSeq, 0, 'disassemble blocked for baseline A');

pick($('ctl-design-C'));
await settle();
fire($('btn-install'), 'click');
eq(state.actions.installSeq, 1, 'install increments installSeq for C');
fire($('btn-disassemble'), 'click');
eq(state.actions.disassembleSeq, 1, 'disassemble increments disassembleSeq for C');
fire($('btn-restore'), 'click');
eq(state.actions.restoreSeq, 1, 'restore increments restoreSeq');

ui.setInstall({ running: true, mode: 'disassemble', stepIndex: 1, steps: [{ title: '1', minutes: 5 }, { title: '2', minutes: 5 }], elapsedMin: 6, totalMin: 10 });
ok(!$('hud-install').hidden && $('hud-install-step').textContent === '해체 2/2', 'HUD displays disassemble step progress');
ok($('btn-disassemble').innerHTML.includes('해체 중…'), 'disassemble button shows active state');

// Custom site clamping
setVal($('ctl-site'), 'custom', 'change');
await settle();
ok(!$('custom-site').hidden, 'custom site box revealed');
setVal($('ctl-lat'), '95', 'change');
await settle();
eq(state.customSite.lat, 66, 'lat clamped to 66');
ok(toastText().includes('범위'), 'clamp toast shown');

// Scenario slots & reset confirm
setVal($('ctl-slot-name'), '현장_검증');
fire($('btn-slot-save'), 'click');
eq(slots.has('현장_검증'), true, 'slot saved');
eq($('slot-list').children.length, 1, 'slot row rendered');

clipboard.mode = 'ok';
fire($('btn-copy-link'), 'click');
await settle();
eq(clipboard.last, 'https://example.test/kroof/#s=abc123', 'clipboard received share URL');

fire($('btn-reset-all'), 'click');
eq(resetCalls, 0, 'first reset click arms confirm');
fire($('btn-reset-all'), 'click');
eq(resetCalls, 1, 'second reset click resets');

// CSV download
const realCreate = URL.createObjectURL;
let blobSeen = null;
URL.createObjectURL = (b) => { blobSeen = b; return realCreate.call(URL, b); };
fire($('btn-export-csv'), 'click');
await settle();
ok(blobSeen && blobSeen.type.startsWith('text/csv'), 'CSV blob generated');
URL.createObjectURL = realCreate;

// Scenario-less & phone mode
{
  doc.getElementById('controls').replaceChildren();
  phone = true;
  for (const k of [...store.keys()]) if (k.startsWith('kroof.ui.sec.')) store.delete(k);
  const ui2 = createUI({ state: defaultState(), set: () => {}, config: CFG });
  const order = $('controls').querySelector('.ctl-flow').children.map((e) => e.id);
  ok(!order.includes('sec-scenario'), 'scenario section hidden when scenario omitted');
  eq($('sec-weather').open, false, 'weather collapsed on phone');
  eq($('sec-design').open, true, 'design stays open on phone');
  ok(typeof ui2.renderResults === 'function', 'public API intact');
  phone = false;
}

ok(errors.length === 0, `no console.error during run (saw ${errors.length})`);
console.error = origError;
console.log(fails ? `\n${fails} check(s) failed (${passes} passed)` : `\nall ui checks passed (${passes})`);
assert.equal(fails, 0);
