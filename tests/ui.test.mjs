// ui.test.mjs — node tests/ui.test.mjs   (exit code ≠ 0 on any failure)
// 1. pure helpers added for the customisation UI (CSV, isDefault, coatings, site label, econ table, …)
// 2. a createUI() smoke run on a tiny fake DOM: builds every section, drives the new controls and checks state + DOM.
import * as CFG from '../js/config.js';
import {
  buildCsv, isDefault, matchCoating, siteLabel, fmtLatLon, parseNumInput, nestedPatch, getPath, defaultsPatch, customDefaultMap,
  fmtSpec, cleanSlotName, fmtSlotTime, createConfirmGate, normalizeTheme, applyThemePref,
  buildEconRows, econSummary, ECON_COLUMNS, buildCompareRows, createUI,
} from '../js/ui/ui.js';
import { computeEconomics, formatPayback } from '../js/econ.js';

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) passes++;
  else { fails++; console.log(`  ✗ ${msg}`); }
}
const eq = (a, b, msg) => ok(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fixtures
const IDS = CFG.DESIGN_IDS;
const ACREF = { '0': 10, A: 8, B: 9.5, C: 7, D: 10.2, E: 8.5 };            // kWh/day with AC on
const TROOF = { '0': 70, A: 45, B: 50, C: 47, D: 55, E: 48 };
function fakeThermal() {
  const th = {};
  for (const id of CFG.ALL_IDS) {
    th[id] = { summary: { TroofMax: TROOF[id], TroofMaxHour: 13.5, TinMax: 30, TinMaxFree: 33, roofHeatKWh: 5, acKWh: ACREF[id], acKWhRef: ACREF[id], peakAcW: 900 } };
  }
  return th;
}
function fakeWind() {
  const w = {};
  for (const id of IDS) w[id] = { sf: 2.1, status: 'ok', criticalV: 33, q: 400, upliftN: 1000, dragN: 300, weightN: 800, stages: [], governing: null };
  return w;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
function defaultState() {
  const p = CFG.WEATHER_PRESETS[0];
  return {
    mode: 'single', design: 'A', siteId: 'seoul', month: p.month, day: p.day, hour: 13.5, playing: false, speed: 1.5,
    weatherPreset: p.id, weather: { Tmax: p.Tmax, Tmin: p.Tmin, windSpeed: p.windSpeed, clearness: p.clearness },
    roof: { alpha: CFG.ROOF.alpha, eps: CFG.ROOF.eps, insulationMm: CFG.ROOF.insulationMm },
    interior: { acOn: true, setpoint: CFG.INTERIOR.setpoint, internalGainW: CFG.INTERIOR.internalGainW, wallU: CFG.INTERIOR.wallU,
      windowArea: CFG.INTERIOR.windowArea, achInfil: CFG.INTERIOR.achInfil, acCOP: CFG.INTERIOR.acCOP },
    gust: 26, windDirDeg: 270,
    params: Object.fromEntries(IDS.map((id) => [id, CFG.defaultParams(id)])),
    view: { heatmap: true, flow: true, rays: true, labels: true, sunPath: true, section: false, explode: 0, windSim: false },
    camera: 'iso', actions: { installSeq: 0, blowSeq: 0 },
    ...clone(CFG.customDefaults()),
  };
}

// ================================================================== 1. pure helpers
section('getPath / nestedPatch / defaults');
{
  eq(getPath({ a: { b: { c: 5 } } }, 'a.b.c'), 5, 'getPath deep');
  eq(getPath({ a: 1 }, 'a.b.c'), undefined, 'getPath missing link');
  eq(nestedPatch('econ.cost.A', 45), { econ: { cost: { A: 45 } } }, 'nestedPatch 3 levels');
  eq(nestedPatch('gust', 12), { gust: 12 }, 'nestedPatch 1 level');
  const def = customDefaultMap(CFG);
  eq(def['surface.topAlpha'], 0.25, 'default surface.topAlpha');
  eq(def['surface.underside'], 'foil', 'default underside from customDefaults()');
  eq(def['ui.autoRotate'], false, 'default autoRotate');
  eq(def['econ.cost.C'], 17.5, 'default econ.cost.C');
  eq(def['interior.acCOP'], CFG.INTERIOR.acCOP, 'default acCOP from spec');
  const patch = defaultsPatch(['interior.wallU', 'roof.eps', 'roof.insulationMm', 'nope.x'], def);
  eq(patch, { interior: { wallU: CFG.INTERIOR.wallU }, roof: { eps: CFG.ROOF.eps, insulationMm: CFG.ROOF.insulationMm } }, 'defaultsPatch builds a nested reset patch (unknown paths skipped)');
}

section('isDefault');
{
  const st = defaultState();
  ok(isDefault(st, ['surface.topAlpha', 'surface.underside', 'surface.foilEps']), 'fresh state is default');
  ok(isDefault(st, ['roof.eps', 'interior.acCOP', 'econ.cost.A', 'ui.quality']), 'fresh state: more paths');
  st.surface.topAlpha = 0.6;
  ok(!isDefault(st, ['surface.topAlpha']), 'alpha 0.6 differs');
  ok(isDefault(st, ['surface.underside', 'surface.foilEps']), 'other paths unaffected');
  st.surface.topAlpha = 0.25 + 1e-9;
  ok(isDefault(st, ['surface.topAlpha']), 'float noise tolerated');
  st.ui.autoRotate = true;
  ok(!isDefault(st, ['ui.autoRotate']), 'boolean differs');
  st.ui.autoRotate = false; st.ui.quality = 'low';
  ok(!isDefault(st, ['ui.quality']), 'enum differs');
  st.econ.cost.C = 20;
  ok(!isDefault(st, ['econ.price', 'econ.cost.C']), 'nested econ cost differs');
  ok(isDefault({}, ['surface.topAlpha', 'econ.cost.A']), 'paths missing from the state count as default');
  ok(isDefault(st, ['not.a.key']), 'unknown path ignored');
  ok(isDefault(st, []), 'empty path list is default');
  ok(!isDefault({ surface: { underside: 'paint' } }, ['surface.underside'], customDefaultMap(CFG)), 'explicit defaults argument');
}

section('coating presets');
{
  eq(matchCoating(0.25), 'white', 'α 0.25 → white');
  eq(matchCoating(0.35), 'silver', 'α 0.35 → silver');
  eq(matchCoating(0.6), 'gray', 'α 0.60 → gray');
  eq(matchCoating(0.92), 'black', 'α 0.92 → black');
  eq(matchCoating(0.25 + 1e-12), 'white', 'tolerant to float noise');
  eq(matchCoating(0.47), null, 'α 0.47 → no preset (사용자 지정)');
  eq(matchCoating(undefined), null, 'missing α → null');
  eq(matchCoating(0.3, [{ id: 'x', alpha: 0.3 }]), 'x', 'custom coating list');
}

section('site label / lat-lon');
{
  eq(siteLabel('seoul', CFG.SITES), '서울', 'known site');
  eq(siteLabel('custom', CFG.SITES, { lat: 37.5665, lon: 126.978, tz: 9 }), '직접 입력 (37.57°N, 126.98°E)', 'custom site label (spec example)');
  eq(siteLabel('custom', CFG.SITES, { lat: -33.8688, lon: -70.6483 }), '직접 입력 (33.87°S, 70.65°W)', 'southern / western hemisphere');
  eq(siteLabel('custom', CFG.SITES, null), '직접 입력 (—)', 'custom without coordinates');
  eq(siteLabel('mystery', CFG.SITES), 'mystery', 'unknown id falls back to the id');
  eq(fmtLatLon({ lat: 0, lon: 0 }), '0.00°N, 0.00°E', 'equator / prime meridian');
}

section('number input parsing');
{
  const lat = CFG.CUSTOM_SPEC['customSite.lat'];
  eq(parseNumInput('37.5665', lat), { ok: true, value: 37.5665, clamped: false }, 'plain decimal');
  eq(parseNumInput(' 12,5 ', lat).value, 12.5, 'comma decimal + spaces');
  eq(parseNumInput('−10', lat).value, -10, 'unicode minus');
  eq(parseNumInput('95', lat), { ok: true, value: 66, clamped: true }, 'clamped to max 66');
  eq(parseNumInput('-90', lat), { ok: true, value: -60, clamped: true }, 'clamped to min −60');
  eq(parseNumInput('abc', lat).ok, false, 'text rejected');
  eq(parseNumInput('', lat).ok, false, 'empty rejected');
  eq(parseNumInput('1e3', lat).ok, false, 'exponent rejected');
  eq(parseNumInput('12.34567', lat, { decimals: 2 }).value, 12.35, 'rounded to decimals');
  eq(parseNumInput('-0.0001', lat, { decimals: 2 }).value, 0, 'no negative zero');
  eq(parseNumInput('600', CFG.CUSTOM_SPEC['econ.cost.A']), { ok: true, value: 500, clamped: true }, 'cost clamped to 500');
}

section('spec formatting');
{
  eq(fmtSpec(CFG.CUSTOM_SPEC['roof.eps'], 0.9), '0.90', 'roof.eps');
  eq(fmtSpec(CFG.CUSTOM_SPEC['roof.insulationMm'], 75), '75 mm', 'insulation');
  eq(fmtSpec(CFG.CUSTOM_SPEC['windAdj.capScale'], 0.85), '0.85×', 'scale with × attached');
  eq(fmtSpec(CFG.CUSTOM_SPEC['interior.acCOP'], 3), '3.0', 'COP has no unit');
  eq(fmtSpec(CFG.CUSTOM_SPEC['econ.price'], 170), '170 원/kWh', 'price');
  eq(fmtSpec(CFG.CUSTOM_SPEC['interior.windowArea'], 2.4), '2.4 m²', 'window area');
  eq(fmtSpec(CFG.CUSTOM_SPEC['interior.wallU'], 0.6), '0.60 W/m²K', 'wall U');
}

section('scenario helpers');
{
  eq(cleanSlotName('  내 설정  '), '내 설정', 'trim');
  eq(cleanSlotName('a\nb\tc'), 'a b c', 'newlines → spaces');
  eq(cleanSlotName('x'.repeat(40)).length, 24, 'capped at 24 chars');
  eq(Array.from(cleanSlotName('😀'.repeat(30))).length, 24, 'capped by code points, not UTF-16 units');
  eq(cleanSlotName('   '), '', 'blank → empty');
  eq(cleanSlotName(undefined), '', 'undefined → empty');
  eq(fmtSlotTime(new Date(2026, 9, 3, 7, 5).getTime()), '10/3 07:05', 'M/D HH:MM');
  eq(fmtSlotTime(new Date(2026, 0, 12, 23, 59).getTime()), '1/12 23:59', 'two-digit day, 23:59');
  eq(fmtSlotTime(NaN), '—', 'bad timestamp');
  let t = 1000;
  const gate = createConfirmGate(3000, () => t);
  eq(gate.press(), false, 'first press only arms');
  ok(gate.armed(), 'armed after first press');
  t += 2900;
  eq(gate.press(), true, 'second press within 3 s confirms');
  ok(!gate.armed(), 'disarmed after confirming');
  eq(gate.press(), false, 're-arms');
  t += 3100;
  ok(!gate.armed(), 'expires after 3 s');
  eq(gate.press(), false, 'press after expiry arms again');
  gate.cancel();
  ok(!gate.armed(), 'cancel disarms');
}

section('theme attribute');
{
  const attrs = new Map();
  const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
  eq(normalizeTheme('dark'), 'dark', 'dark'); eq(normalizeTheme('light'), 'light', 'light');
  eq(normalizeTheme('purple'), 'auto', 'unknown → auto'); eq(normalizeTheme(null), 'auto', 'null → auto');
  eq(applyThemePref(root, 'dark'), 'dark', 'returns applied pref');
  eq(attrs.get('data-theme'), 'dark', 'data-theme=dark');
  applyThemePref(root, 'light');
  eq(attrs.get('data-theme'), 'light', 'data-theme=light');
  applyThemePref(root, 'auto');
  ok(!attrs.has('data-theme'), 'auto removes data-theme');
}

section('economics table model');
{
  const results = { thermal: fakeThermal() };
  const st = defaultState();
  const model = buildEconRows(CFG, results, st);
  eq(model.rows.map((r) => r.id), IDS, 'one row per design A–E (no baseline row)');
  const A = model.rows.find((r) => r.id === 'A'), B = model.rows.find((r) => r.id === 'B');
  const C = model.rows.find((r) => r.id === 'C'), D = model.rows.find((r) => r.id === 'D');
  eq(A.cells.cost.text, '30', 'A cost');
  eq(C.cells.cost.text, '17.5', 'C cost keeps its decimal');
  eq(A.cells.saveKWhDay.text, '2.00', 'A saves 2 kWh/day');
  eq(A.cells.saveManYear.text, '3.1', 'A saves 3.06 만원/yr');
  eq(A.cells.payback.text, '9.8년', 'A payback 30 / 3.06');
  eq(B.cells.payback.text, '78년', 'B payback');
  eq(D.status, 'none', 'D saves nothing');
  eq(D.cells.payback.text, '절감 없음', 'no-saving rows read 절감 없음');
  eq(D.cells.payback.v, null, 'no payback value for no-saving rows');
  ok(C.cells.payback.best, 'C has the best (shortest) payback');
  ok(!A.cells.payback.best && !B.cells.payback.best, 'only one best payback');
  ok(C.cells.saveManYear.best, 'C saves the most per year');
  eq(A.cells.roofDrop.text, '25.0', 'roof drop A = 70 − 45');
  ok(D.cells.roofDrop.best === undefined, 'D (smallest drop) is not highlighted');
  ok(model.rows.find((r) => r.cells.roofDrop.best)?.id === 'A', 'A has the biggest roof drop');
  eq(econSummary(model, 'A'), 'A: 연 3.1만원 절감, 설치비 회수 9.8년', 'summary sentence (spec example shape)');
  eq(econSummary(model, 'D'), 'D: 현재 조건에서는 냉방 전력 절감이 없어 설치비를 회수할 수 없습니다', 'summary for a no-saving design');
  ok(econSummary(model, '0').includes('기존 지붕'), 'summary for the baseline');
  eq(econSummary(buildEconRows(CFG, { thermal: null }, st), 'A'), 'A: 계산 중…', 'summary while results are pending');

  // price / days / cost drive the numbers
  st.econ.price = 340; st.econ.cost.A = 15;
  const m2 = buildEconRows(CFG, results, st);
  eq(m2.rows.find((r) => r.id === 'A').cells.payback.text, '2.5년', 'A payback after doubling price and halving cost');
  st.econ.days = 10;
  eq(buildEconRows(CFG, results, st).rows.find((r) => r.id === 'A').cells.payback.text, '22년', 'fewer cooling days → longer payback');

  // pending / matches econ.js
  const pending = buildEconRows(CFG, { thermal: { '0': results.thermal['0'] } }, defaultState());
  ok(pending.rows.every((r) => r.status === 'pending' && r.cells.payback.text === '…'), 'pending rows show …');
  const raw = computeEconomics({ results, state: defaultState(), designIds: IDS });
  eq(raw.rows.length, buildEconRows(CFG, results, defaultState()).rows.length, 'same row count as computeEconomics');
  eq(formatPayback(27.2), '27년', 'formatPayback sanity');
  ok(ECON_COLUMNS.length === 5, '5 econ columns');
}

section('buildCsv');
{
  const results = { thermal: fakeThermal(), wind: fakeWind() };
  const st = defaultState();
  const compare = buildCompareRows(CFG, results, { acOn: true, gust: 26 });
  const econ = buildEconRows(CFG, results, st);
  const csv = buildCsv(compare, econ, { price: 170, days: 90, conditions: '서울 · 7월 25일' });
  ok(csv.charCodeAt(0) === 0xFEFF, 'starts with a BOM');
  ok(csv.endsWith('\r\n') && !csv.includes('\n\n'), 'CRLF lines, trailing newline');
  const lines = csv.slice(1).split('\r\n');
  const head = lines[0].split(',');
  ok(head[0] === '설계안' && head[1] === '이름', 'header starts with 설계안,이름');
  ok(head.includes('지붕 최고 (°C)') && head.includes('한계풍속 (m/s)') && head.includes('비용 (만원)') && head.includes('설치 (분)'), 'header carries the units');
  ok(head.includes('안전율 (@26 m/s)'), 'SF header shows the gust speed');
  ok(head.length === 2 + compare.columns.length, `header has ${2 + compare.columns.length} columns`);
  eq(lines.slice(1, 7).map((l) => l.split(',')[0]), ['기존', 'A', 'B', 'C', 'D', 'E'], 'all six rows in order');
  ok(lines[1].includes('기존 지붕'), 'baseline row name');
  const rowA = lines[2];
  ok(rowA.includes('비계 캐노피형'), 'A row name');
  ok(rowA.includes('25–35'), "document range '25–35' kept as text (en dash)");
  ok(lines[7] === '', 'blank line between the tables');
  ok(lines[8].startsWith('설계안,이름,설치비 (만원),하루 냉방 절감 (kWh),연 전기료 절감 (만원),회수기간,지붕 최고온도 저감 (°C)'), 'econ header');
  eq(lines.slice(9, 14).map((l) => l.split(',')[0]), IDS, 'econ rows A–E');
  ok(lines[9].split(',')[5] === '9.8년', 'A payback in the econ table');
  ok(lines.some((l) => l.startsWith('전기요금 (원/kWh),170')) && lines.some((l) => l.startsWith('연간 냉방일수 (일),90')), 'assumption rows');
  ok(lines.includes('조건,서울 · 7월 25일'), 'conditions row');
  ok(!csv.includes('−'), 'no unicode minus left in the numbers');

  // escaping
  const tricky = {
    columns: [{ key: 'x', label: '값', unit: 'kg' }, { key: 'y', label: '메모', unit: '' }],
    rows: [{ id: 'A', name: '비계, "캐노피"', cells: { x: { text: '−3.4' }, y: { text: '줄1\n줄2' } } }, { id: '0', name: '기존 지붕', cells: { x: { text: '25–35' }, y: {} } }],
  };
  const t = buildCsv(tricky, null).slice(1).split('\r\n');
  eq(t[0], '설계안,이름,값 (kg),메모', 'minimal model header');
  eq(t[1], 'A,"비계, ""캐노피""",-3.4,"줄1\n줄2"', 'commas / quotes / newlines are quoted, minus normalised');
  eq(t[2], '기존,기존 지붕,25–35,', 'range kept, missing cell empty');
  eq(buildCsv(null, null, {}), '\uFEFF\r\n', 'nothing to export → just the BOM');
  const onlyRows = buildCsv(null, econ.rows);
  ok(onlyRows.includes('설치비 (만원)'), 'econ rows array accepted');
}

// ================================================================== 2. createUI on a fake DOM
section('createUI smoke (fake DOM)');

class FakeText { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class FakeEl {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.parentNode = null; this.attrs = new Map(); this.listeners = {};
    this._text = ''; this._html = null; this.value = ''; this.checked = false; this.open = false;
    const props = new Map();
    this.style = new Proxy({ setProperty: (k, v) => props.set(k, String(v)), getPropertyValue: (k) => props.get(k) ?? '' }, {
      set(t, k, v) { t[k] = v; return true; },
    });
    this._styleProps = props;
    this.dataset = new Proxy({}, {
      get: (_, k) => this.getAttribute(`data-${String(k)}`) ?? undefined,
      set: (_, k, v) => { this.setAttribute(`data-${String(k)}`, v); return true; },
    });
  }
  // attributes / reflected properties
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get min() { return this.getAttribute('min') ?? ''; }
  get max() { return this.getAttribute('max') ?? ''; }
  get step() { return this.getAttribute('step') ?? ''; }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
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
  // tree
  _adopt(c) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; }
  append(...nodes) {
    for (const n of nodes.flat()) {
      const node = typeof n === 'string' ? new FakeText(n) : n;
      if (node.nodeType === 1) this._adopt(node);
      this.children.push(node);
    }
  }
  after(node) { const p = this.parentNode; if (!p) return; node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1); node.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, node); }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this._html = null; this.append(...nodes); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._html = null; this._text = String(v); }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(v) { this.children = []; this._text = ''; this._html = String(v); }
  // queries
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
  // events / behaviour
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  click() { fire(this, 'click'); }
  focus() { this.ownerDocument.activeElement = this; fire(this, 'focus'); }
  blur() { if (this.ownerDocument.activeElement === this) { this.ownerDocument.activeElement = null; fire(this, 'blur'); } }
  select() { this._selected = true; }
  setSelectionRange() {}
}
function fire(el, type, extra = {}) {
  const ev = { type, target: el, key: undefined, isComposing: false, preventDefault() {}, ...extra };
  for (const fn of el.listeners[type] || []) fn(ev);
  return ev;
}

const rafQueue = [];
const flushRaf = () => { let n = 0; while (rafQueue.length && n++ < 50) rafQueue.splice(0).forEach((f) => f()); };
const settle = async () => { flushRaf(); await sleep(60); flushRaf(); await sleep(60); flushRaf(); };
// a slider that was just edited ignores state echoes for 500 ms (so it never fights the drag): wait that out, then re-sync
const settleLong = async (ui) => { await sleep(520); ui.syncFromState(); await settle(); };

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

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

const state = defaultState();
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (isObj(v) && isObj(dst[k])) deepMerge(dst[k], v); else dst[k] = v; } return dst; };
const sets = [];
const set = (patch) => { sets.push(patch); deepMerge(state, patch); };

// in-memory scenario backend
const slots = new Map();
let resetCalls = 0, shareCalls = 0;
const scenario = {
  snapshot: () => clone(state),
  apply: () => {},
  reset: () => { resetCalls++; },
  shareUrl: () => { shareCalls++; return 'https://example.test/kroof/#s=abc123'; },
  slots: {
    list: () => [...slots].map(([name, savedAt]) => ({ name, savedAt })),
    save: (name) => { slots.set(name, Date.now()); return true; },
    load: (name) => slots.has(name),
    remove: (name) => { slots.delete(name); },
  },
};

store.set('kroof.ui.theme', 'dark');   // a saved preference must be applied at construction time
const ui = createUI({ state, set, config: CFG, legend: { css: 'x', min: 20, max: 80 }, scenario });
const $ = (id) => doc.getElementById(id);
const toastText = () => $('toast').textContent;
const pick = (el) => { el.checked = true; fire(el, 'change'); };
const setVal = (el, v, type = 'input') => { el.value = String(v); fire(el, type); };

eq(doc.documentElement.getAttribute('data-theme'), 'dark', 'saved theme applied at createUI');
ok(observers.some((o) => o.opts?.attributeFilter?.includes('data-theme') && o.target === doc.documentElement), 'MutationObserver watches <html data-theme> (charts re-read tokens)');

// ---- structure
const SECTION_ORDER = ['sec-design', 'sec-params', 'sec-time', 'sec-weather', 'sec-roof', 'sec-room', 'sec-surface', 'sec-wind', 'sec-econ', 'sec-display', 'sec-app', 'sec-scenario'];
eq($('controls').querySelector('.ctl-flow').children.map((e) => e.id), SECTION_ORDER, 'control sections in the requested order');
for (const id of SECTION_ORDER) ok($(`${id}-sum`) !== null, `${id} has a summary slot`);
ok($('sec-econ-dash') && $('econ-table') && $('econ-summary') && $('econ-note'), 'dashboard economics section exists');
{
  const dashIds = $('dashboard').children.map((e) => e.id);
  ok(dashIds.indexOf('sec-econ-dash') === dashIds.indexOf('sec-compare') + 1, 'econ section sits right after the comparison table');
}
for (const id of ['ctl-coat-white', 'ctl-coat-silver', 'ctl-coat-gray', 'ctl-coat-black', 'ctl-coat-custom', 'ctl-surf-alpha', 'ctl-underside-foil', 'ctl-underside-paint', 'ctl-foil-eps',
  'ctl-roof-eps', 'ctl-ins-mm', 'ctl-gain', 'ctl-wall-u', 'ctl-window', 'ctl-ach', 'ctl-cop', 'btn-room-reset', 'ctl-cap-scale', 'ctl-cp-scale', 'out-windadj',
  'ctl-lat', 'ctl-lon', 'ctl-tz', 'ctl-econ-price', 'ctl-econ-days', ...IDS.map((i) => `ctl-cost-${i}`), 'btn-econ-reset',
  'ctl-theme-auto', 'ctl-theme-light', 'ctl-theme-dark', 'ctl-quality-auto', 'ctl-quality-low', 'ctl-quality-medium', 'ctl-quality-high', 'ctl-autorotate',
  'ctl-slot-name', 'btn-slot-save', 'slot-list', 'btn-copy-link', 'btn-reset-all', 'btn-export-csv', 'ctl-ins-0', 'ctl-ins-50', 'ctl-ins-75', 'ctl-ins-100']) {
  ok($(id) !== null, `control #${id} exists`);
}
ok($('ctl-site').children.some((o) => o.getAttribute('value') === 'custom' && o.textContent === '직접 입력'), 'site select has the 직접 입력 option');
ok($('ctl-cost-A').getAttribute('min') === '0' && $('ctl-cost-A').getAttribute('step') === '1', 'cost input min/step from spec');
ok($('ctl-roof-eps').getAttribute('min') === '0.3' && $('ctl-roof-eps').getAttribute('max') === '0.95', 'roof ε slider range from spec');
ok($('ctl-ins-mm').getAttribute('max') === '150', 'insulation slider 0–150');
ok($('ctl-cap-scale').parentNode.querySelector('.field-foot').textContent.includes('0.3 심한 노후·부식'), 'cap-scale footer text');
ok($('ctl-surf-alpha').parentNode.querySelector('.field-foot').textContent.includes('0.1 백색계') && $('ctl-surf-alpha').parentNode.querySelector('.field-foot').textContent.includes('0.95 흑색계'), 'α footer text');
ok($('sec-surface').textContent.includes('설계안 A·B·C·E에 적용됩니다 (D 차광망 제외)'), 'surface hint text');
ok($('custom-site-hint').textContent === '위도 −60~66°, 경도 −180~180°', 'custom-site hint text');
ok($('sec-app').textContent.includes('느린 기기·6동 비교에서 끊기면 낮춤'), 'quality hint text');
ok($('ctl-coat-custom').disabled, 'custom coating tile is informational only');
eq($('sec-surface').open, true, 'surface section open on desktop');
eq($('sec-room').open, false, 'advanced room section starts collapsed');

await settle();
ui.renderResults({ thermal: fakeThermal(), wind: fakeWind(), curves: {} });
ui.setBusy(false);
await settle();

// ---- initial summaries / bindings
eq($('sec-surface-sum').textContent, 'α 0.25 · 은박', 'surface summary');
eq($('ctl-coat-white').checked, true, 'default α matches the white preset');
eq($('ctl-coat-custom').checked, false, 'custom tile not active by default');
eq($('ctl-ins-50').checked, true, 'insulation 50 segmented selected');
eq($('ctl-ins-mm').value, '50', 'insulation slider shows 50');
eq($('sec-econ-sum').textContent, '170원/kWh · 90일', 'econ summary');
eq($('sec-app-sum').textContent, '다크 · 화질 자동', 'app summary shows the saved theme');
eq($('ctl-theme-dark').checked, true, 'theme segmented shows dark');
eq($('sec-scenario-sum').textContent, '저장 없음', 'scenario summary (no slots)');
eq($('slot-list').textContent, '저장된 설정이 없습니다', 'empty-slot text');
ok($('sec-surface').querySelector('.chg-dot').hidden, 'no 변경됨 dot at defaults');
ok($('sec-room').querySelector('.chg-dot').hidden && $('sec-econ').querySelector('.chg-dot').hidden, 'no dots on room / econ at defaults');
ok(!$('sec-app').querySelector('.chg-dot').hidden, 'theme ≠ auto marks 화면·성능 as changed');
ok($('out-windadj').hidden, 'wind adjustment readout hidden at 1×');
ok($('custom-site').hidden, 'custom-site inputs hidden for a preset site');
ok(!$('ctl-cop').disabled, 'COP enabled with AC on');
ok(!$('ctl-foil-eps').disabled, 'foil ε enabled with foil underside');
eq($('tb-site').textContent, '서울 · 7월 25일', 'header site text');
{
  const html = $('econ-table').querySelector('tbody').innerHTML;
  ok(html.includes('9.8년') && html.includes('절감 없음'), 'econ table rendered with payback and no-saving cell');
  ok(html.includes('class="best"'), 'best cells highlighted');
  ok(html.includes('data-id="A"') && html.includes('is-sel'), 'rows carry data-id; selected design marked');
  ok(!html.includes('data-id="0"'), 'no baseline row in the econ table');
}
eq($('econ-summary').textContent, 'A: 연 3.1만원 절감, 설치비 회수 9.8년', 'econ summary sentence for the selected design');
ok($('econ-note').textContent.startsWith('선택한 날짜·기상의 하루 결과를 냉방일수만큼 반복한 추정입니다.'), 'econ note text');

// ---- 1. surface material
pick($('ctl-coat-black'));
eq(state.surface.topAlpha, 0.92, 'black preset sets α 0.92');
await settle();
eq($('ctl-surf-alpha').value, '0.92', 'α slider follows the preset');
eq($('ctl-coat-black').checked, true, 'black tile active');
eq($('sec-surface-sum').textContent, 'α 0.92 · 은박', 'summary follows α');
ok(!$('sec-surface').querySelector('.chg-dot').hidden, '변경됨 dot on after changing α');
setVal($('ctl-surf-alpha'), '0.47');
fire($('ctl-surf-alpha'), 'change');
await settle();
eq(state.surface.topAlpha, 0.47, 'slider writes surface.topAlpha');
eq($('ctl-coat-custom').checked, true, 'custom tile active for α 0.47');
eq($('ctl-coat-black').checked, false, 'black tile released');
ok($('ctl-coat-custom').parentNode.querySelector('.coat-custom').textContent.includes('α 0.47'), 'custom tile shows the α');
pick($('ctl-coat-white'));
await settle();
ok($('sec-surface').querySelector('.chg-dot').hidden, 'dot hides again when back at defaults');
pick($('ctl-underside-paint'));
await settle();
eq(state.surface.underside, 'paint', 'underside → paint');
ok($('ctl-foil-eps').disabled && $('ctl-foil-eps').parentNode.classList.contains('is-disabled'), 'foil ε slider disabled + .is-disabled under paint');
eq($('sec-surface-sum').textContent, 'α 0.25 · 도장', 'summary says 도장');
pick($('ctl-underside-foil'));
await settle();
ok(!$('ctl-foil-eps').disabled, 'foil ε enabled again');
setVal($('ctl-foil-eps'), '0.3');
await settle();
eq(state.surface.foilEps, 0.3, 'foil ε slider writes surface.foilEps');

// ---- 2. room
setVal($('ctl-ins-mm'), '75');
await settle();
eq(state.roof.insulationMm, 75, 'insulation slider writes roof.insulationMm');
eq($('ctl-ins-75').checked, true, 'segmented follows the slider (75)');
setVal($('ctl-ins-mm'), '85');
await settle();
ok(!$('ctl-ins-0').checked && !$('ctl-ins-50').checked && !$('ctl-ins-75').checked && !$('ctl-ins-100').checked, 'segmented shows none for 85 mm');
pick($('ctl-ins-100'));
await settleLong(ui);
eq(state.roof.insulationMm, 100, 'segmented writes roof.insulationMm');
eq($('ctl-ins-mm').value, '100', 'slider follows the segmented control');
setVal($('ctl-gain'), '800'); setVal($('ctl-wall-u'), '1.2'); setVal($('ctl-window'), '4'); setVal($('ctl-ach'), '1.5'); setVal($('ctl-cop'), '4.2'); setVal($('ctl-roof-eps'), '0.6');
await settle();
eq([state.interior.internalGainW, state.interior.wallU, state.interior.windowArea, state.interior.achInfil, state.interior.acCOP, state.roof.eps], [800, 1.2, 4, 1.5, 4.2, 0.6], 'room sliders write their paths');
ok(!$('sec-room').querySelector('.chg-dot').hidden, 'room dot on');
eq($('sec-room-sum').textContent, '800W · U 1.2 · 창 4m²', 'room summary');
fire($('btn-room-reset'), 'click');
await settle();
eq([state.interior.internalGainW, state.interior.wallU, state.interior.windowArea, state.interior.achInfil, state.interior.acCOP, state.roof.eps, state.roof.insulationMm],
  [CFG.INTERIOR.internalGainW, CFG.INTERIOR.wallU, CFG.INTERIOR.windowArea, CFG.INTERIOR.achInfil, CFG.INTERIOR.acCOP, CFG.ROOF.eps, CFG.ROOF.insulationMm], 'room reset restores the group');
eq(state.surface.foilEps, 0.3, 'room reset leaves other groups alone');
ok($('sec-room').querySelector('.chg-dot').hidden, 'room dot off after reset');
eq($('ctl-ins-50').checked, true, 'segmented back at 50 after reset');
set({ interior: { acOn: false } });   // set() bypasses doSet's scheduled sync, so sync explicitly
ui.syncFromState();
await settle();
ok($('ctl-cop').disabled && $('ctl-setpoint').disabled, 'COP + setpoint disabled with AC off');
ok($('econ-note').textContent.includes('에어컨이 꺼져 있어도'), 'econ note mentions AC-off basis');
set({ interior: { acOn: true } });
ui.syncFromState();
await settle();

// ---- 3. wind adjusters
setVal($('ctl-cap-scale'), '0.6'); setVal($('ctl-cp-scale'), '1.2');
await settle();
eq([state.windAdj.capScale, state.windAdj.cpScale], [0.6, 1.2], 'wind adjusters write windAdj.*');
ok(!$('out-windadj').hidden, 'readout shown when ≠ 1');
ok($('out-windadj-text').textContent.includes('×0.60') && $('out-windadj-text').textContent.includes('×1.20'), 'readout text');
ok($('sec-wind-sum').textContent.endsWith('보정'), 'wind summary flags the adjustment');
fire($('btn-windadj-reset'), 'click');
await settle();
eq([state.windAdj.capScale, state.windAdj.cpScale], [1, 1], 'adjustment reset');
ok($('out-windadj').hidden, 'readout hidden again');

// ---- 4. custom site
setVal($('ctl-site'), 'custom', 'change');
await settle();
eq(state.siteId, 'custom', 'site select → custom');
ok(!$('custom-site').hidden, 'custom inputs revealed');
eq($('ctl-lat').value, '37.5665', 'lat input shows the state value');
eq($('tb-site').textContent, '직접 입력 (37.57°N, 126.98°E) · 7월 25일', 'header shows the custom label');
ok($('hud-date').textContent.includes('직접 입력 (37.57°N, 126.98°E)'), 'HUD shows the custom label');
eq($('sec-time-sum').textContent.startsWith('직접 입력 ·'), true, 'time summary uses the short label');
setVal($('ctl-lat'), '95', 'change');
await settle();
eq(state.customSite.lat, 66, 'lat clamped to 66');
eq($('ctl-lat').value, '66', 'input shows the clamped value');
ok(toastText().includes('범위로 조정'), 'clamp toast');
setVal($('ctl-lon'), '-73.9', 'change');
await settle();
eq(state.customSite.lon, -73.9, 'lon written');
eq($('tb-site').textContent, '직접 입력 (66.00°N, 73.90°W) · 7월 25일', 'label follows lat/lon');
setVal($('ctl-lat'), 'abc', 'change');
eq(state.customSite.lat, 66, 'invalid text leaves the state alone');
eq($('ctl-lat').value, '66', 'invalid text reverts the field');
ok(toastText().includes('숫자'), 'invalid toast');
setVal($('ctl-tz'), '5.5');
fire($('ctl-tz'), 'keydown', { key: 'Enter' });
eq(state.customSite.tz, 5.5, 'Enter commits');
setVal($('ctl-site'), 'seoul', 'change');
await settle();
ok($('custom-site').hidden, 'custom inputs hidden again');
eq($('tb-site').textContent, '서울 · 7월 25일', 'header back to 서울');

// ---- 5. economics
const before = $('econ-table').querySelector('tbody').innerHTML;
setVal($('ctl-cost-A'), '15', 'change');
await settle();
eq(state.econ.cost.A, 15, 'cost input writes econ.cost.A');
ok($('econ-table').querySelector('tbody').innerHTML !== before, 'econ table re-rendered after a cost edit');
eq($('econ-summary').textContent, 'A: 연 3.1만원 절감, 설치비 회수 4.9년', 'summary follows the cost');
setVal($('ctl-econ-price'), '340');
await settle();
eq(state.econ.price, 340, 'price slider writes econ.price');
eq($('econ-summary').textContent, 'A: 연 6.1만원 절감, 설치비 회수 2.5년', 'summary follows the price');
setVal($('ctl-cost-B'), '9999', 'change');
eq(state.econ.cost.B, 500, 'cost clamped to the spec max');
ok(!$('sec-econ').querySelector('.chg-dot').hidden, 'econ dot on');
fire($('btn-econ-reset'), 'click');
await settle();
eq([state.econ.price, state.econ.days, state.econ.cost.A, state.econ.cost.B, state.econ.cost.C], [170, 90, 30, 60, 17.5], 'econ reset restores defaults');
pick($('ctl-design-D'));
await settle();
eq($('econ-summary').textContent, 'D: 현재 조건에서는 냉방 전력 절감이 없어 설치비를 회수할 수 없습니다', 'summary for the no-saving design');
pick($('ctl-design-0'));
await settle();
ok($('econ-summary').textContent.includes('기존 지붕은 비교 기준'), 'summary for the baseline');
pick($('ctl-design-A'));
await settle();

// ---- 6. screen & performance
pick($('ctl-theme-light'));
eq(doc.documentElement.getAttribute('data-theme'), 'light', 'theme light → data-theme=light');
eq(store.get('kroof.ui.theme'), 'light', 'theme persisted');
pick($('ctl-theme-auto'));
eq(doc.documentElement.getAttribute('data-theme'), null, 'theme auto removes the attribute');
eq(store.get('kroof.ui.theme'), 'auto', 'auto persisted');
await settle();
ok($('sec-app').querySelector('.chg-dot').hidden, 'app dot off at auto/auto/off');
pick($('ctl-quality-low'));
eq(state.ui.quality, 'low', 'quality → ui.quality');
$('ctl-autorotate').checked = true; fire($('ctl-autorotate'), 'change');
eq(state.ui.autoRotate, true, 'auto-rotate → ui.autoRotate');
await settle();
eq($('sec-app-sum').textContent, '자동 · 화질 낮음', 'app summary');
ok(!$('sec-app').querySelector('.chg-dot').hidden, 'app dot on');

// ---- 7. scenario
{
  setVal($('ctl-slot-name'), '   ');
  fire($('btn-slot-save'), 'click');
  ok(toastText().includes('이름을 입력'), 'empty name rejected');
  setVal($('ctl-slot-name'), `  ${'가'.repeat(30)}  `);
  fire($('ctl-slot-name'), 'keydown', { key: 'Enter' });
  eq([...slots.keys()][0], '가'.repeat(24), 'Enter saves; name capped at 24');
  eq($('ctl-slot-name').value, '', 'name field cleared after saving');
  setVal($('ctl-slot-name'), '내 설정');
  fire($('btn-slot-save'), 'click');
  eq([...slots.keys()].length, 2, 'second slot saved');
  setVal($('ctl-slot-name'), '내 설정');
  fire($('btn-slot-save'), 'click');
  eq([...slots.keys()].length, 2, 'same name replaces');
  ok(toastText().includes('덮어썼습니다'), 'overwrite toast');
  const rows = $('slot-list').children;
  eq(rows.length, 2, 'two rows listed');
  ok(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(rows[0].querySelector('.slot-time').textContent), 'row time looks like M/D HH:MM');
  eq($('sec-scenario-sum').textContent, '저장 2개', 'scenario summary counts slots');
  const btns = rows[0].querySelectorAll('button');
  eq(btns.map((b) => b.textContent), ['불러오기', '삭제'], 'row buttons');
  btns[0].click();
  ok(toastText().includes('불러왔습니다'), 'load toast');
  btns[1].click();
  eq([...slots.keys()].length, 1, 'delete removes the slot');
  eq($('slot-list').children.length, 1, 'list re-rendered');
}

// link copy
clipboard.mode = 'ok';
fire($('btn-copy-link'), 'click');
await settle();
eq(clipboard.last, 'https://example.test/kroof/#s=abc123', 'clipboard receives shareUrl()');
eq(toastText(), '공유 링크를 복사했습니다', 'copy success toast');
ok($('ctl-share-url').hidden, 'fallback input stays hidden on success');
clipboard.mode = 'deny';
fire($('btn-copy-link'), 'click');
await settle();
ok(!$('ctl-share-url').hidden && $('ctl-share-url').value === 'https://example.test/kroof/#s=abc123', 'rejection → readonly input with the URL');
ok($('ctl-share-url').hasAttribute('readonly') && $('ctl-share-url')._selected === true, 'fallback input is readonly and pre-selected');
eq(toastText(), '링크를 길게 눌러 복사하세요', 'fallback toast');
clipboard.mode = 'ok';

// reset: inline two-step confirm
eq($('btn-reset-all').textContent, '설정 초기화', 'reset label');
fire($('btn-reset-all'), 'click');
eq($('btn-reset-all').textContent, '정말 초기화? (다시 클릭)', 'first click arms');
ok($('btn-reset-all').classList.contains('is-confirm'), 'armed styling');
eq(resetCalls, 0, 'nothing reset yet');
fire($('btn-reset-all'), 'click');
eq(resetCalls, 1, 'second click resets');
eq($('btn-reset-all').textContent, '설정 초기화', 'label restored');
fire($('btn-reset-all'), 'click');
fire($('btn-reset-all'), 'blur');
eq($('btn-reset-all').textContent, '설정 초기화', 'blur disarms');
fire($('btn-reset-all'), 'click');
eq(resetCalls, 1, 'click after blur re-arms instead of resetting');
fire($('btn-reset-all'), 'blur');

// CSV export
const realCreate = URL.createObjectURL;
let blobSeen = null, anchorSeen = null;
URL.createObjectURL = (b) => { blobSeen = b; return realCreate.call(URL, b); };
const origAppend = doc.body.append.bind(doc.body);
doc.body.append = (...n) => { for (const x of n) if (x.tagName === 'A') anchorSeen = x; return origAppend(...n); };
fire($('btn-export-csv'), 'click');
await settle();
ok(blobSeen && blobSeen.type.startsWith('text/csv'), 'CSV blob created');
{
  const bytes = Buffer.from(await blobSeen.arrayBuffer());
  ok(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, 'blob starts with the UTF-8 BOM bytes');
  const text = bytes.toString('utf8').slice(1);
  ok(text.includes('지붕 최고 (°C)') && text.includes('회수기간') && text.includes('25–35'), 'blob carries both tables');
  ok(text.includes('조건,서울 · 7월 25일'), 'conditions line');
}
eq(anchorSeen?.getAttribute('download'), 'kroof-seoul-0725.csv', 'download file name');
eq(toastText(), 'CSV 파일을 저장했습니다 (엑셀에서 열 수 있습니다)', 'download toast');
ok(errors.length === 0, `no console.error during the run${errors.length ? `: ${errors[0]}` : ''}`);
URL.createObjectURL = () => { throw new Error('blocked'); };
clipboard.last = null;
fire($('btn-export-csv'), 'click');
await settle();
eq(toastText(), '이 환경에서는 파일 저장이 막혀 있어 클립보드로 복사했습니다', 'blocked download → clipboard toast');
ok(clipboard.last && clipboard.last.charCodeAt(0) === 0xFEFF && clipboard.last.includes('회수기간'), 'CSV text copied to the clipboard');
ok(errors.length === 1 && errors[0].includes('csv download failed'), 'the blocked download is logged once');
URL.createObjectURL = realCreate;
doc.body.append = origAppend;

// ---- no scenario → section hidden; phones collapse
{
  errors.length = 0;
  const saveSet = state.siteId;
  doc.getElementById('controls').replaceChildren();
  phone = true; store.delete('kroof.ui.sec.sec-room');
  // rebuild on a fresh state without a scenario object; section prefs are cleared like a first visit
  for (const k of [...store.keys()]) if (k.startsWith('kroof.ui.sec.')) store.delete(k);
  const ui2 = createUI({ state: defaultState(), set: () => {}, config: CFG });
  const order = $('controls').querySelector('.ctl-flow').children.map((e) => e.id);
  ok(!order.includes('sec-scenario'), 'section hidden when no scenario object is passed');
  eq(order[order.length - 1], 'sec-app', 'screen & performance becomes the last section');
  for (const id of ['sec-weather', 'sec-roof', 'sec-room', 'sec-surface', 'sec-econ', 'sec-display', 'sec-app']) {
    eq($(id).open, false, `${id} starts collapsed on phones`);
  }
  eq($('sec-design').open, true, 'design section stays open on phones');
  ok(typeof ui2.renderResults === 'function' && typeof ui2.toast === 'function', 'createUI keeps its public API');
  ok(errors.length === 0, `no console.error on the scenario-less build${errors.length ? `: ${errors[0]}` : ''}`);
  eq(saveSet, state.siteId, 'untouched');
  phone = false;
}

console.error = origError;
console.log(fails ? `\n${fails} check(s) failed (${passes} passed)` : `\nall ui checks passed (${passes})`);
process.exit(fails ? 1 : 0);
