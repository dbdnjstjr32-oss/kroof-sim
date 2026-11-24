// ui.js — control rail (#controls), HUD overlay (#hud) and results dashboard (#dashboard).
// Pure helpers are exported at the top so Node tests can validate calculations without a browser DOM.
import { chartsAvailable, readTheme, createTempChart } from './charts.js';
import * as CFG from '../config.js';

export const DASH = '—';
const MINUS = '−';
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function fmtNum(v, digits = 1) {
  if (!isNum(v)) return DASH;
  let s = v.toFixed(digits);
  if (Number(s) === 0) s = (0).toFixed(digits);
  return s.replace('-', MINUS);
}

export function fmtSigned(v, digits = 1) {
  if (!isNum(v)) return DASH;
  const abs = Math.abs(v).toFixed(digits);
  if (Number(abs) === 0) return abs;
  return (v > 0 ? '+' : MINUS) + abs;
}

export function fmtPlain(v) {
  if (!isNum(v)) return DASH;
  return String(Math.round(v * 1000) / 1000).replace('-', MINUS);
}

export function fmtHHMM(hour) {
  if (!isNum(hour)) return '--:--';
  const m = Math.round(Math.min(24, Math.max(0, hour)) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDate(month, day) { return `${month}월 ${day}일`; }
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function daysInMonth(month) { return MONTH_DAYS[(Math.round(month) - 1 + 12) % 12] || 31; }
export function clampDay(month, day) { return Math.max(1, Math.min(daysInMonth(month), Math.round(day) || 1)); }
export function decimalsOf(step) {
  const s = String(step); const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export const shortName = (id) => (id === 'Cp' ? 'C′안' : `${id}안`);

export function presetMatches(st, preset) {
  if (!st || !preset) return false;
  const w = st.weather || {};
  const eq = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) < 1e-6;
  return st.month === preset.month && st.day === preset.day
    && eq(w.Tmax, preset.Tmax) && eq(w.Tmin, preset.Tmin) && eq(w.windSpeed, preset.windSpeed) && eq(w.clearness, preset.clearness);
}

const pctChange = (x, base) => (isNum(x) && isNum(base) && Math.abs(base) > 1e-9 ? ((x - base) / base) * 100 : null);

/**
 * Cooling load reduction formula (§12.3):
 *   [(A안 냉방부하 - 해당 설계안 냉방부하) / A안 냉방부하] × 100
 *   - If A안 cooling load <= 0: returns 'N/A' (cannot divide by zero)
 *   - If A안 cooling load > 0 and isBaseline: returns 0.0%
 *   - Negative reduction is preserved as negative (never clamped to 0)
 */
export function computeCoolingSaving(baseKWh, targetKWh, isBaseline = false) {
  if (!isNum(baseKWh) || !isNum(targetKWh) || baseKWh <= 0) {
    return { valid: false, pct: null, text: 'N/A' };
  }
  if (isBaseline) return { valid: true, pct: 0, text: '0.0' };
  const pct = ((baseKWh - targetKWh) / baseKWh) * 100;
  return { valid: true, pct, text: fmtNum(pct, 1) };
}

/** Extracts the AC OFF and AC ON summary from a thermal entry (supports { off, on } or flat result). */
function getSummaries(entry) {
  if (!entry) return { off: null, on: null };
  if (entry.off && entry.on) return { off: entry.off.summary || null, on: entry.on.summary || null };
  return { off: entry.summary || null, on: entry.summary || null };
}

/**
 * Four core KPI tiles (§11):
 *   1) 지붕 강판 하면 최고온도 (°C, 냉방 OFF)
 *   2) 실내 최고온도 (°C, 냉방 OFF)
 *   3) 일일 지붕 열유입량 (kWh, 냉방 OFF)
 *   4) 일일 냉방부하 (kWh, 냉방 ON 08:00~18:00) & A안 대비 절감률 (%)
 */
export function computeKpis({ sel, thermal, setpoint = 26 }) {
  const { off: sOff, on: sOn } = getSummaries(thermal?.[sel]);
  const { off: bOff, on: bOn } = getSummaries(thermal?.A);
  const isBase = sel === 'A';
  const tone = (d) => (!isNum(d) || Math.abs(d) < 1e-9 ? 'neutral' : d < 0 ? 'good' : 'bad');

  const dRoof = !isBase && sOff && bOff ? sOff.TroofBotMax - bOff.TroofBotMax : null;
  const dTin = !isBase && sOff && bOff ? sOff.TinMax - bOff.TinMax : null;
  const dHeat = !isBase && sOff && bOff ? pctChange(sOff.roofHeatKWh, bOff.roofHeatKWh) : null;
  const sav = sOn && bOn ? computeCoolingSaving(bOn.coolingKWh, sOn.coolingKWh, isBase) : null;

  return [
    {
      key: 'roofBot', label: '지붕 강판 하면 최고온도', value: sOff?.TroofBotMax, digits: 1, unit: '°C',
      empty: !sOff, delta: dRoof, tone: tone(dRoof),
      deltaText: isBase ? '기준 모델 (A안)' : isNum(dRoof) ? `A안 대비 ${fmtSigned(dRoof, 1)} °C` : '',
      sub: `냉방 OFF 기준 · 기존 1.2T 강판 하면${sOff && isNum(sOff.TroofMaxHour) ? ` (${fmtHHMM(sOff.TroofMaxHour)})` : ''}`,
    },
    {
      key: 'tinMax', label: '실내 최고온도', value: sOff?.TinMax, digits: 1, unit: '°C',
      empty: !sOff, delta: dTin, tone: tone(dTin),
      deltaText: isBase ? '기준 모델 (A안)' : isNum(dTin) ? `A안 대비 ${fmtSigned(dTin, 1)} °C` : '',
      sub: '냉방 OFF 기준 · 24시간 최고 실내 공기온도',
    },
    {
      key: 'roofHeat', label: '일일 지붕 열유입량', value: sOff?.roofHeatKWh, digits: 2, unit: 'kWh',
      empty: !sOff, delta: dHeat, tone: tone(dHeat),
      deltaText: isBase ? '기준 모델 (A안)' : isNum(dHeat) ? `A안 대비 ${fmtSigned(dHeat, 1)} %` : '',
      sub: '냉방 OFF 기준 · 실내 방향 양의 열유입 누적',
    },
    {
      key: 'cooling', label: '일일 냉방부하 (열에너지)', value: sOn?.coolingKWh, digits: 2, unit: 'kWh',
      empty: !sOn, delta: sav?.valid ? -sav.pct : null, tone: sav?.valid ? (sav.pct > 0 ? 'good' : sav.pct < 0 ? 'bad' : 'neutral') : 'neutral',
      deltaText: !sOn ? '' : !sav?.valid ? 'A안 대비 절감률 N/A' : isBase ? 'A안 대비 절감률 0.0 %' : `A안 대비 절감률 ${sav.text} %`,
      sub: `냉방 ON (08:00~18:00 · 설정 ${fmtPlain(setpoint)}°C · 소비전력량 아님)`,
    },
  ];
}

// §12.2 Required 6 comparison columns (first sticky col = 설계안 명칭)
export const COMPARE_COLUMNS = [
  { key: 'TroofBotMax', label: '지붕 강판 하면 최고온도', unit: '°C', group: 'off', better: 'min', digits: 1 },
  { key: 'TinMax', label: '실내 최고온도', unit: '°C', group: 'off', better: 'min', digits: 1 },
  { key: 'roofHeatKWh', label: '일일 지붕 열유입량', unit: 'kWh', group: 'off', better: 'min', digits: 2 },
  { key: 'coolingKWh', label: '일일 냉방부하', unit: 'kWh', group: 'on', better: 'min', digits: 2 },
  { key: 'savingPct', label: 'A안 대비 냉방부하 절감률', unit: '%', group: 'on', better: 'max', digits: 1 },
];

export function buildCompareRows(config, results = {}) {
  const ids = config.ALL_IDS || ['A', 'B', 'C', 'Cp'];
  const getD = (id) => (typeof config.getDesign === 'function' ? config.getDesign(id) : (id === 'A' ? config.BASELINE : config.DESIGNS?.[id]));
  const th = results.thermal || {};
  const { on: baseOn } = getSummaries(th.A);

  const rows = ids.map((id) => {
    const d = getD(id) || {};
    const { off: sOff, on: sOn } = getSummaries(th[id]);
    const isBase = id === 'A';
    const c = {};
    c.TroofBotMax = { v: sOff?.TroofBotMax, text: sOff ? fmtNum(sOff.TroofBotMax, 1) : '…' };
    c.TinMax = { v: sOff?.TinMax, text: sOff ? fmtNum(sOff.TinMax, 1) : '…' };
    c.roofHeatKWh = { v: sOff?.roofHeatKWh, text: sOff ? fmtNum(sOff.roofHeatKWh, 2) : '…' };
    c.coolingKWh = { v: sOn?.coolingKWh, text: sOn ? fmtNum(sOn.coolingKWh, 2) : '…' };
    if (sOn && baseOn) {
      const sav = computeCoolingSaving(baseOn.coolingKWh, sOn.coolingKWh, isBase);
      c.savingPct = { v: sav.valid ? sav.pct : null, text: sav.valid ? `${sav.text}%` : 'N/A', na: !sav.valid };
    } else {
      c.savingPct = { v: null, text: '…' };
    }
    return { id, short: shortName(id), name: d.fullName || d.name || id, color: d.color, cells: c };
  });

  for (const col of COMPARE_COLUMNS) {
    const cand = rows.filter((r) => isNum(r.cells[col.key]?.v));
    if (cand.length < 2) continue;
    const vals = cand.map((r) => r.cells[col.key].v);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (Math.abs(hi - lo) < 1e-9) continue;
    const target = col.better === 'min' ? lo : hi;
    for (const r of cand) if (Math.abs(r.cells[col.key].v - target) < 1e-9) r.cells[col.key].best = true;
  }
  return { columns: COMPARE_COLUMNS, rows };
}

const xy = (hours, arr) => hours.map((h, i) => ({ x: h, y: isNum(arr?.[i]) ? arr[i] : null }));

/**
 * 24-hour temperature series (§12.1).
 * Compares A, B, C, C′ simultaneously + ambient air temperature.
 * Automatically switches between AC OFF and AC ON curves based on `acOn`.
 */
export function buildTempSeries(thermal, { design = 'C', acOn = false, viewTab = 'both', visible = {} } = {}, config = {}) {
  const getD = (id) => (typeof config.getDesign === 'function' ? config.getDesign(id) : (id === 'A' ? config.BASELINE : config.DESIGNS?.[id])) || {};
  const all = config.ALL_IDS || ['A', 'B', 'C', 'Cp'];
  const branch = acOn ? 'on' : 'off';
  const out = [];
  let airSrc = null;

  for (const id of all) {
    const entry = thermal?.[id];
    const r = entry?.[branch] || entry;
    if (!r || !Array.isArray(r.hours)) continue;
    airSrc = airSrc || r;
    if (visible[id] === false) continue;
    const d = getD(id);
    const emph = id === design;
    const color = d.color || null;
    const nm = shortName(id);
    if (viewTab === 'roof' || viewTab === 'both') {
      out.push({
        id, key: `${id}:roof`, kind: 'roof', label: `${nm} 지붕 강판 하면`,
        color, order: emph ? 0 : 1, dash: [], width: emph ? 2.8 : 1.9,
        data: xy(r.hours, r.TroofBot || r.Troof),
      });
    }
    if (viewTab === 'indoor' || viewTab === 'both') {
      out.push({
        id, key: `${id}:indoor`, kind: 'indoor', label: `${nm} 실내 공기`,
        color, order: emph ? 0 : 1, dash: viewTab === 'both' ? [7, 4] : [], width: emph ? 2.4 : 1.7,
        data: xy(r.hours, r.Tin),
      });
    }
  }
  if (visible.air !== false && airSrc) {
    out.push({
      id: 'air', key: 'air', kind: 'air', label: '외기온도',
      color: null, order: 2, dash: [2, 3], width: 2.0,
      data: xy(airSrc.hours, airSrc.Ta),
    });
  }
  return out;
}

// Pure path/spec helpers
export const THEME_KEY = 'kroof.ui.theme';
export const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function nestedPatch(path, value) {
  const keys = String(path).split('.');
  const out = {};
  let cur = out;
  keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = value; else { cur[k] = {}; cur = cur[k]; } });
  return out;
}

export function customDefaultMap(config = CFG) {
  const map = {};
  for (const [p, s] of Object.entries(config?.CUSTOM_SPEC || {})) map[p] = s.default;
  const flatten = (o, pre) => {
    for (const [k, v] of Object.entries(o || {})) {
      const p = pre ? `${pre}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p); else map[p] = v;
    }
  };
  if (typeof config?.customDefaults === 'function') flatten(config.customDefaults(), '');
  return map;
}
let defaultMapCache = null;

export function isDefault(st, paths, defaults) {
  const def = defaults || (defaultMapCache = defaultMapCache || customDefaultMap());
  for (const p of paths || []) {
    if (!(p in def)) continue;
    const cur = getPath(st, p);
    if (cur === undefined) continue;
    const d = def[p];
    if (isNum(d) && isNum(cur)) { if (Math.abs(cur - d) > 1e-6) return false; } else if (cur !== d) return false;
  }
  return true;
}

export function fmtSpec(sp, v) {
  if (!isNum(v)) return DASH;
  const n = fmtNum(v, decimalsOf(sp?.step ?? 1));
  const u = sp?.unit;
  return u ? `${n} ${u}` : n;
}

export function parseNumInput(raw, sp, { decimals = 4 } = {}) {
  const s = String(raw ?? '').trim().replace(/−/g, '-').replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, value: null, clamped: false };
  let v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, value: null, clamped: false };
  let clamped = false;
  if (sp && isNum(sp.min) && v < sp.min) { v = sp.min; clamped = true; }
  if (sp && isNum(sp.max) && v > sp.max) { v = sp.max; clamped = true; }
  const f = 10 ** decimals;
  v = Math.round(v * f) / f;
  if (Object.is(v, -0)) v = 0;
  return { ok: true, value: v, clamped };
}

export function fmtLatLon(cs) {
  if (!cs || !isNum(cs.lat) || !isNum(cs.lon)) return DASH;
  return `${Math.abs(cs.lat).toFixed(2)}°${cs.lat < 0 ? 'S' : 'N'}, ${Math.abs(cs.lon).toFixed(2)}°${cs.lon < 0 ? 'W' : 'E'}`;
}
export function siteLabel(siteId, sites = [], customSite = null) {
  if (siteId === 'custom') return `직접 입력 (${fmtLatLon(customSite)})`;
  return sites.find((s) => s.id === siteId)?.name || siteId || '';
}
export function cleanSlotName(raw, max = 24) {
  return Array.from(String(raw ?? '').replace(/[\r\n\t]+/g, ' ').trim()).slice(0, max).join('').trim();
}
export function fmtSlotTime(ts) {
  if (!isNum(ts)) return DASH;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return DASH;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function createConfirmGate(ms = 3000, clock = () => Date.now()) {
  let armedAt = -Infinity;
  const gate = {
    armed: () => clock() - armedAt < ms,
    press() { if (gate.armed()) { armedAt = -Infinity; return true; } armedAt = clock(); return false; },
    cancel() { armedAt = -Infinity; },
  };
  return gate;
}
export function normalizeTheme(v) { return v === 'light' || v === 'dark' ? v : 'auto'; }
export function applyThemePref(root, pref) {
  const p = normalizeTheme(pref);
  if (!root) return p;
  if (p === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', p);
  return p;
}

export function installTimeline(steps = []) {
  let t = 0;
  const rows = (steps || []).map((s, i) => {
    const min = isNum(s.minutes) ? s.minutes : 0;
    const row = { i, title: s.title || `단계 ${i + 1}`, minutes: min, start: t, end: t + min };
    t += min;
    return row;
  });
  return { rows, total: t };
}

export function installProgress({ stepIndex = 0, steps = [], elapsedMin = 0, totalMin, mode = 'install' } = {}) {
  const n = steps.length;
  const total = isNum(totalMin) && totalMin > 0 ? totalMin : installTimeline(steps).total;
  const i = Math.max(0, Math.min(n - 1, stepIndex));
  const verb = mode === 'disassemble' ? '해체' : '설치';
  return {
    stepText: n ? `${verb} ${i + 1}/${n}` : verb,
    title: steps[i]?.title || '',
    timeText: `${fmtNum(elapsedMin, 0)} / ${fmtNum(total, 0)} 분`,
    pct: total > 0 ? Math.max(0, Math.min(100, (elapsedMin / total) * 100)) : 0,
  };
}

const csvCell = (v) => {
  const s = String(v ?? '').replace(/^−/, '-');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(compareModel, meta = {}) {
  const lines = [];
  if (compareModel && Array.isArray(compareModel.rows)) {
    const cols = compareModel.columns || COMPARE_COLUMNS;
    lines.push(['설계안 명칭', ...cols.map((c) => `${c.label} (${c.unit})`)]);
    for (const r of compareModel.rows) lines.push([r.name, ...cols.map((c) => r.cells?.[c.key]?.text ?? '')]);
  }
  if (meta.conditions) { lines.push([]); lines.push(['해석 조건', meta.conditions]); }
  return `\uFEFF${lines.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ================================================================ DOM helpers
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c && c.nodeType ? c : String(c));
  }
  return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const svgPlay = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.2v9.6L10.6 6z"/></svg>';
const svgPause = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.2h3v9.6H2zM7 1.2h3v9.6H7z"/></svg>';

function throttle(fn, ms) {
  let last = -Infinity, timer = null, pending = null;
  const run = () => { timer = null; last = now(); const a = pending; pending = null; if (a) fn(...a); };
  const t = (...args) => {
    pending = args;
    const wait = ms - (now() - last);
    if (wait <= 0) { if (timer) { clearTimeout(timer); timer = null; } run(); }
    else if (!timer) timer = setTimeout(run, wait);
  };
  t.flush = () => { if (pending) { if (timer) { clearTimeout(timer); timer = null; } run(); } };
  return t;
}

function lsGet(k) { try { return globalThis.localStorage?.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* ignore */ } }

const DEFAULT_LEGEND_CSS = 'linear-gradient(90deg, #313695, #4575b4, #74add1, #abd9e9, #fee090, #fdae61, #f46d43, #d73027, #a50026)';

// ================================================================ createUI
export function createUI({ state, set, config, legend, getState, scenario } = {}) {
  if (typeof document === 'undefined') throw new Error('createUI() needs a DOM');
  const cfg = config || {};
  const S = () => (typeof getState === 'function' ? getState() : state) || {};
  const ALL = cfg.ALL_IDS || ['A', 'B', 'C', 'Cp'];
  const SITES = cfg.SITES || [];
  const PRESETS = cfg.WEATHER_PRESETS || [];
  const getD = (id) => (typeof cfg.getDesign === 'function' ? cfg.getDesign(id) : (id === 'A' ? cfg.BASELINE : cfg.DESIGNS?.[id])) || {};
  const SPEC = cfg.CUSTOM_SPEC || CFG.CUSTOM_SPEC || {};
  const spec = (path) => SPEC[path] || {};
  const DEFAULTS = customDefaultMap({ CUSTOM_SPEC: SPEC, customDefaults: cfg.customDefaults || CFG.customDefaults });
  const siteName = (id) => siteLabel(id, SITES, S().customSite);
  const siteShort = (id) => (id === 'custom' ? '직접 입력' : siteLabel(id, SITES));

  const viewport = document.getElementById('viewport');
  let hudRoot = document.getElementById('hud');
  if (!hudRoot && viewport) { hudRoot = h('div', { id: 'hud' }); viewport.append(hudRoot); }
  const controlsRoot = document.getElementById('controls');
  const dashRoot = document.getElementById('dashboard');

  let themePref = applyThemePref(document.documentElement, lsGet(THEME_KEY));

  const results = { thermal: null };
  let resultsVersion = 0;
  let install = { running: false, mode: 'install', stepIndex: -1, steps: [], elapsedMin: 0, totalMin: 0 };
  let assumptions = { thermal: [] };
  let clock = { hour: null, sun: null, sample: null };
  let sunTimes = null;
  let legendState = legend || null;
  let busy = false;
  let tempTab = 'both';
  const visible = { A: true, B: true, C: true, Cp: true, air: true };

  const binders = [];
  const lastEdit = new WeakMap();
  let dragEl = null;
  const touched = (el) => lastEdit.set(el, now());
  const editing = (el) => dragEl === el || (lastEdit.has(el) && now() - lastEdit.get(el) < 500);
  document.addEventListener('pointerup', () => { dragEl = null; }, true);
  document.addEventListener('pointercancel', () => { dragEl = null; }, true);

  let syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => { syncQueued = false; syncFromState(); });
  }
  function doSet(patch) {
    try { if (typeof set === 'function') set(patch); } catch (e) { console.error('[ui] set() failed', e); }
    scheduleSync();
  }

  function paintRange(input) {
    const min = Number(input.min), max = Number(input.max), v = Number(input.value);
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', `${pct}%`);
  }
  function setRangeValue(input, v) {
    if (!isNum(v) || editing(input)) return;
    const s = String(v);
    if (input.value !== s || input._painted !== s) { input.value = s; input._painted = s; paintRange(input); }
  }
  function setText(el, txt) { if (el && el.textContent !== txt) el.textContent = txt; }

  // ================================================================ control builders
  function rangeField({ id, label, min, max, step, get, patch, fmt, heavy = false, footMin, footMax, onLocal }) {
    const input = h('input', { type: 'range', id, min, max, step });
    const out = h('output', { for: id, id: `${id}-out` });
    let lastOut = null;
    const renderOut = (v) => {
      const f = fmt(v);
      const key = typeof f === 'string' ? f : `${f.text}|${f.alt}`;
      if (key === lastOut) return;
      lastOut = key;
      if (typeof f === 'string') out.textContent = f;
      else { out.textContent = f.text; if (f.alt) out.append(h('small', { text: f.alt })); }
    };
    const field = h('div', { class: 'field' },
      h('div', { class: 'field-head' }, h('label', { for: id, text: label }), out),
      input,
      h('div', { class: 'field-foot' },
        h('span', { text: footMin ?? fmtPlain(min) }),
        h('span', { text: footMax ?? fmtPlain(max) })));
    const send = heavy ? throttle((v) => doSet(patch(v)), 140) : (v) => doSet(patch(v));
    input.addEventListener('pointerdown', () => { dragEl = input; });
    input.addEventListener('input', () => {
      touched(input);
      const v = Number(input.value);
      paintRange(input); renderOut(v);
      if (onLocal) onLocal(v);
      send(v);
    });
    input.addEventListener('change', () => { touched(input); if (send.flush) send.flush(); });
    binders.push((st) => {
      const v = get(st);
      setRangeValue(input, v);
      renderOut(editing(input) ? Number(input.value) : v);
    });
    return { field, input, out };
  }

  function segmented({ name, label, options, get, onPick }) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const pairs = options.map((o) => {
      const inp = h('input', { type: 'radio', name, id: o.id, value: String(o.value), class: 'sr' });
      inp.addEventListener('change', () => { if (inp.checked) onPick(o.value); });
      wrap.append(inp, h('label', { for: o.id, title: o.title || null, text: o.label }));
      return [inp, o];
    });
    binders.push((st) => { const cur = get(st); for (const [inp, o] of pairs) inp.checked = String(o.value) === String(cur); });
    return wrap;
  }

  function toggle({ id, label, get, onToggle }) {
    const inp = h('input', { type: 'checkbox', id, role: 'switch' });
    inp.addEventListener('change', () => onToggle(inp.checked));
    binders.push((st) => { inp.checked = !!get(st); });
    return h('label', { class: 'switch', for: id }, inp, h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', { text: label }));
  }

  function selectField({ id, label, options, get, onPick, cls }) {
    const sel = h('select', { id }, options.map((o) => h('option', { value: String(o.value), text: o.label })));
    sel.addEventListener('change', () => onPick(sel.value));
    binders.push((st) => { if (document.activeElement !== sel) { const v = String(get(st)); if (sel.value !== v) sel.value = v; } });
    return h('div', { class: `field ${cls || ''}` }, h('label', { for: id, text: label }), sel);
  }

  function section({ id, title, open = true, body }) {
    const key = `kroof.ui.sec.${id}`;
    const stored = lsGet(key);
    const det = h('details', { class: 'ctl-sec', id });
    det.open = stored === null ? open : stored === '1';
    const dot = h('span', { class: 'chg-dot', title: '기본값에서 변경됨', hidden: true }, h('span', { class: 'sr', text: '(기본값에서 변경됨)' }));
    const sum = h('span', { class: 'sec-sum', id: `${id}-sum` });
    det.append(h('summary', null, h('span', { class: 'sec-title', text: title }), dot, sum), h('div', { class: 'sec-body' }, body));
    det.addEventListener('toggle', () => lsSet(key, det.open ? '1' : '0'));
    return { det, sum, dot };
  }

  function trackChanges(sec, paths, extra) {
    binders.push((st) => {
      const changed = !isDefault(st, paths, DEFAULTS) || (extra ? !!extra(st) : false);
      if (sec.dot.hidden === changed) sec.dot.hidden = !changed;
    });
  }

  function setInputValue(el, v) {
    if (!isNum(v)) return;
    const s = String(Math.round(v * 1e4) / 1e4);
    if (el.value !== s) el.value = s;
  }
  function commitNumber(el, path, decimals) {
    const sp = spec(path);
    const cur = getPath(S(), path);
    const r = parseNumInput(el.value, sp, { decimals });
    if (!r.ok) {
      setInputValue(el, isNum(cur) ? cur : sp.default);
      toast(`${sp.label || path}: 숫자를 입력하세요`);
      return;
    }
    if (r.clamped) toast(`${sp.label || path}: ${fmtPlain(sp.min)}~${fmtPlain(sp.max)}${sp.unit || ''} 범위로 조정했습니다`);
    setInputValue(el, r.value);
    if (!isNum(cur) || Math.abs(cur - r.value) > 1e-9) doSet(nestedPatch(path, r.value));
  }
  function numberInput({ id, path, decimals = 4, describedBy }) {
    const sp = spec(path);
    const inp = h('input', { type: 'number', id, class: 'txt-in', min: sp.min, max: sp.max, step: sp.step, inputmode: 'decimal', 'aria-describedby': describedBy });
    const commit = () => commitNumber(inp, path, decimals);
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(); } });
    binders.push((st) => { if (document.activeElement !== inp) setInputValue(inp, getPath(st, path) ?? sp.default); });
    return inp;
  }

  function setThemePref(v) {
    themePref = applyThemePref(document.documentElement, v);
    lsSet(THEME_KEY, themePref);
    onThemeChange();
    scheduleSync();
  }

  function writeClipboard(text) {
    try {
      const p = globalThis.navigator?.clipboard?.writeText(text);
      return p ? Promise.resolve(p).then(() => true, () => false) : Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  }

  // ================================================================ HUD
  const hud = {};
  function buildHud() {
    if (!hudRoot) return;
    hudRoot.replaceChildren();
    hud.play = h('button', { type: 'button', class: 'icon-btn', id: 'hud-play', 'aria-label': '시간 재생', 'aria-pressed': 'false', html: svgPlay });
    hud.play.addEventListener('click', () => doSet({ playing: !S().playing }));
    hud.clock = h('span', { class: 'hud-clock', id: 'hud-clock', text: '--:--' });
    hud.date = h('span', { class: 'hud-date', id: 'hud-date' });
    hud.sun = h('dd', { id: 'hud-sun', text: DASH });
    hud.ghi = h('dd', { id: 'hud-ghi', text: DASH });
    hud.ta = h('dd', { id: 'hud-ta', text: DASH });
    hud.roof = h('dd', { id: 'hud-roof', text: DASH });
    const tl = h('div', { class: 'hud-tl hud-panel' },
      h('div', { class: 'hud-clock-row' }, hud.play, hud.clock, hud.date),
      h('dl', { class: 'hud-grid' },
        h('div', { class: 'hud-row' }, h('dt', { text: '태양 방위/고도' }), hud.sun),
        h('div', { class: 'hud-row' }, h('dt', { text: '일사량' }), hud.ghi),
        h('div', { class: 'hud-row hud-opt' }, h('dt', { text: '외기온' }), hud.ta),
        h('div', { class: 'hud-row hud-roof hud-opt' }, h('dt', { text: '강판 하면' }), hud.roof)));

    const cams = [
      { v: 'iso', label: '원근', title: '원근 시점' },
      { v: 'section', label: '단면', title: '단면 시점' },
      { v: 'top', label: '상부', title: '상부 시점' },
      { v: 'gap', label: '공기층', title: '공기층 확인 시점' },
      { v: 'detail', label: '상세', title: '결속부·부재 상세 시점' },
      { v: 'yard', label: '현장', title: '현장 전체 시점 (4동 비교)' },
    ];
    hud.cams = cams.map((c) => {
      const b = h('button', { type: 'button', class: 'hud-btn', id: `cam-${c.v}`, title: c.title, 'aria-pressed': 'false', text: c.label });
      b.addEventListener('click', () => doSet({ camera: c.v }));
      return [b, c.v];
    });
    const tr = h('div', { class: 'hud-tr', role: 'group', 'aria-label': '카메라 시점' }, hud.cams.map(([b]) => b));

    hud.legendBar = h('div', { class: 'hud-legend-bar', id: 'hud-legend-bar' });
    hud.legendMin = h('span', { id: 'hud-legend-min' });
    hud.legendMax = h('span', { id: 'hud-legend-max' });
    const bl = h('div', { class: 'hud-bl hud-panel' },
      h('div', { class: 'hud-legend-title', text: '기존 지붕 강판 온도' }), hud.legendBar,
      h('div', { class: 'hud-legend-scale' }, hud.legendMin, hud.legendMax));

    hud.instStep = h('span', { id: 'hud-install-step' });
    hud.instTime = h('span', { id: 'hud-install-time' });
    hud.instTitle = h('div', { class: 'hud-install-title', id: 'hud-install-title' });
    hud.instBar = h('span');
    hud.install = h('div', { class: 'hud-bc hud-panel', id: 'hud-install', hidden: true, role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'hud-install-top' }, hud.instStep, hud.instTime), hud.instTitle, h('div', { class: 'bar' }, hud.instBar));

    hudRoot.append(tl, tr, bl, hud.install);
    applyLegend();
  }

  function applyLegend() {
    if (!hud.legendBar) return;
    const range = cfg.TEMP_RANGE || [20, 80];
    const L = legendState || {};
    hud.legendBar.style.background = L.css || DEFAULT_LEGEND_CSS;
    setText(hud.legendMin, `${fmtPlain(isNum(L.min) ? L.min : range[0])} °C`);
    setText(hud.legendMax, `${fmtPlain(isNum(L.max) ? L.max : range[1])} °C`);
  }

  // ================================================================ controls
  const ctl = {};
  function buildControls() {
    if (!controlsRoot) return;
    controlsRoot.replaceChildren();

    const modeBlock = h('div', { class: 'ctl-block' },
      h('div', { class: 'ctl-label', text: '보기 모드' }),
      segmented({
        name: 'mode', label: '보기 모드', get: (st) => st.mode,
        options: [
          { value: 'single', label: '단일 설계안', id: 'ctl-mode-single' },
          { value: 'compare', label: '4동 비교', id: 'ctl-mode-compare' },
        ],
        onPick: (v) => doSet({ mode: v }),
      }));

    // Design selection (A, B, C, Cp)
    const list = h('div', { class: 'design-list', role: 'radiogroup', 'aria-label': '설계안' });
    for (const id of ALL) {
      const d = getD(id);
      const inp = h('input', { type: 'radio', name: 'design', id: `ctl-design-${id}`, value: id, class: 'sr' });
      inp.addEventListener('change', () => { if (inp.checked) doSet({ design: id }); });
      const meta = [d.specs?.panel, d.specs?.gapMm ? `공기층 ${d.specs.gapMm}` : null].filter(Boolean).map((t) => h('span', { text: t }));
      list.append(inp, h('label', { for: inp.id, class: 'design-row', style: { '--c': d.color } },
        h('span', { class: 'dr-id', text: shortName(id) }),
        h('span', { class: 'dr-main' },
          h('span', { class: 'dr-name', text: d.name }),
          h('span', { class: 'dr-tag', text: d.tagline }),
          h('span', { class: 'dr-meta' }, meta)),
        h('span', { class: 'dr-radio', 'aria-hidden': 'true' })));
      binders.push((st) => { inp.checked = st.design === id; });
    }
    const secDesign = section({ id: 'sec-design', title: '설계안 선택', body: [list] });
    binders.push((st) => setText(secDesign.sum, `${shortName(st.design)} ${getD(st.design).name || ''}`));

    // Time & site
    const siteSel = selectField({
      id: 'ctl-site', label: '지역',
      options: [...SITES.map((s) => ({ value: s.id, label: s.name })), { value: 'custom', label: '직접 입력' }],
      get: (st) => st.siteId, onPick: (v) => doSet({ siteId: v }),
    });
    ctl.customBox = h('div', { class: 'custom-site', id: 'custom-site', hidden: true },
      h('div', { class: 'row-3 even' }, [['lat', 'ctl-lat', '위도', 4], ['lon', 'ctl-lon', '경도', 4], ['tz', 'ctl-tz', '표준시 (UTC+)', 2]].map(([key, id, label, dec]) =>
        h('div', { class: 'field' }, h('label', { for: id, text: label }),
          numberInput({ id, path: `customSite.${key}`, decimals: dec, describedBy: 'custom-site-hint' })))),
      h('p', { class: 'table-note', id: 'custom-site-hint', text: '위도 −60~66°, 경도 −180~180°' }));
    binders.push((st) => { const on = st.siteId === 'custom'; if (ctl.customBox.hidden === on) ctl.customBox.hidden = !on; });
    const monthSel = selectField({
      id: 'ctl-month', label: '월', options: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` })),
      get: (st) => st.month, onPick: (v) => { const m = Number(v); doSet({ month: m, day: clampDay(m, S().day) }); },
    });
    ctl.daySel = h('select', { id: 'ctl-day' });
    ctl.daySel.addEventListener('change', () => doSet({ day: Number(ctl.daySel.value) }));
    let dayOptsFor = null;
    binders.push((st) => {
      const n = daysInMonth(st.month || 7);
      if (dayOptsFor !== n) {
        dayOptsFor = n;
        ctl.daySel.replaceChildren(...Array.from({ length: n }, (_, i) => h('option', { value: String(i + 1), text: `${i + 1}일` })));
      }
      if (document.activeElement !== ctl.daySel) ctl.daySel.value = String(clampDay(st.month || 7, st.day || 1));
    });
    const dayField = h('div', { class: 'field' }, h('label', { for: 'ctl-day', text: '일' }), ctl.daySel);

    ctl.play = h('button', { type: 'button', class: 'icon-btn', id: 'btn-play', 'aria-label': '시간 재생', 'aria-pressed': 'false', html: svgPlay });
    ctl.play.addEventListener('click', () => doSet({ playing: !S().playing }));
    const hourF = rangeField({
      id: 'ctl-hour', label: '시각', min: 0, max: 24, step: 0.25,
      get: (st) => st.hour, fmt: (v) => fmtHHMM(v), footMin: '00:00', footMax: '24:00',
      patch: (v) => (S().playing ? { hour: v, playing: false } : { hour: v }),
    });
    ctl.hour = hourF.input;
    ctl.hourOut = hourF.out;
    const hourRow = h('div', { style: { display: 'grid', gridTemplateColumns: '30px minmax(0,1fr)', gap: '10px', alignItems: 'center' } }, ctl.play, hourF.field);
    const speedSeg = segmented({
      name: 'speed', label: '재생 속도', get: (st) => st.speed,
      options: [0.5, 1.5, 4].map((v) => ({ value: v, label: `${v}`, id: `ctl-speed-${String(v).replace('.', '_')}`, title: `${v} 시간/초` })),
      onPick: (v) => doSet({ speed: Number(v) }),
    });
    ctl.sunTimes = h('p', { class: 'table-note', id: 'out-suntimes' });
    const secTime = section({
      id: 'sec-time', title: '시간 · 장소', body: [
        h('div', { class: 'row-3' }, siteSel, monthSel, dayField),
        ctl.customBox,
        hourRow,
        h('div', { class: 'field' }, h('span', { class: 'field-head' }, h('span', { class: 'seg-caption', text: '재생 속도 (시뮬레이션 시간/초)' })), speedSeg),
        ctl.sunTimes,
      ],
    });
    ctl.timeSum = secTime.sum;

    // Weather conditions (§8.1)
    const presetSel = h('select', { id: 'ctl-preset' },
      PRESETS.map((p) => h('option', { value: p.id, text: `${p.name} · ${p.Tmax}/${p.Tmin} °C` })),
      h('option', { value: 'custom', text: '사용자 지정', disabled: true }));
    presetSel.addEventListener('change', () => {
      const p = PRESETS.find((x) => x.id === presetSel.value);
      if (!p) return;
      doSet({ weatherPreset: p.id, month: p.month, day: p.day, weather: { Tmax: p.Tmax, Tmin: p.Tmin, windSpeed: p.windSpeed, clearness: p.clearness } });
      toast(`${p.name} 기상 조건 적용`);
    });
    binders.push((st) => {
      if (document.activeElement === presetSel) return;
      const p = PRESETS.find((x) => x.id === st.weatherPreset);
      presetSel.value = p && presetMatches(st, p) ? p.id : 'custom';
    });
    const tmax = rangeField({
      id: 'ctl-tmax', label: '외기 최고온도', min: 20, max: 40, step: 0.5, heavy: true,
      get: (st) => st.weather?.Tmax, fmt: (v) => `${fmtNum(v, 1)} °C`,
      patch: (v) => { const w = S().weather || {}; return { weatherPreset: 'custom', weather: { Tmax: v, Tmin: Math.min(w.Tmin ?? 26, v) } }; },
    });
    const tmin = rangeField({
      id: 'ctl-tmin', label: '외기 최저온도', min: 10, max: 32, step: 0.5, heavy: true,
      get: (st) => st.weather?.Tmin, fmt: (v) => `${fmtNum(v, 1)} °C`,
      patch: (v) => { const w = S().weather || {}; return { weatherPreset: 'custom', weather: { Tmin: v, Tmax: Math.max(w.Tmax ?? 35, v) } }; },
    });
    const wspd = rangeField({
      id: 'ctl-windspeed', label: '외부 풍속', min: 0, max: 8, step: 0.1, heavy: true,
      get: (st) => st.weather?.windSpeed, fmt: (v) => `${fmtNum(v, 1)} m/s`,
      patch: (v) => ({ weatherPreset: 'custom', weather: { windSpeed: v } }),
    });
    const clear = rangeField({
      id: 'ctl-clearness', label: '맑음 지수 (Clear Sky Index)', min: 0.3, max: 1.0, step: 0.05, heavy: true,
      get: (st) => st.weather?.clearness, fmt: (v) => fmtNum(v, 2),
      patch: (v) => ({ weatherPreset: 'custom', weather: { clearness: v } }),
    });
    const secWeather = section({
      id: 'sec-weather', title: '기상 조건', body: [
        h('div', { class: 'field' }, h('label', { for: 'ctl-preset', text: '대표 기상 프리셋' }), presetSel),
        tmax.field, tmin.field, wspd.field, clear.field,
      ],
    });
    binders.push((st) => setText(secWeather.sum, `${fmtNum(st.weather?.Tmax, 1)}/${fmtNum(st.weather?.Tmin, 1)}°C · ${fmtNum(st.weather?.windSpeed, 1)}m/s`));

    // Roof insulation (0mm / 50mm) & Cooling settings (§3.4, §9.1)
    const insSeg = segmented({
      name: 'ins', label: '지붕 단열재 두께', get: (st) => st.roof?.insulationMm,
      options: [
        { value: 0, label: '0 mm (기본)', id: 'ctl-ins-0' },
        { value: 50, label: '50 mm (적용)', id: 'ctl-ins-50' },
      ],
      onPick: (v) => doSet({ roof: { insulationMm: Number(v) } }),
    });
    const acToggle = toggle({
      id: 'ctl-ac', label: '냉방 가동 (08:00~18:00 그래프 반영)',
      get: (st) => st.interior?.acOn,
      onToggle: (on) => doSet({ interior: { acOn: on } }),
    });
    const spField = rangeField({
      id: 'ctl-setpoint', label: '냉방 설정온도', min: 20, max: 30, step: 0.5, heavy: true,
      get: (st) => st.interior?.setpoint, fmt: (v) => `${fmtNum(v, 1)} °C`,
      patch: (v) => ({ interior: { setpoint: v } }),
    });
    const secRoof = section({
      id: 'sec-roof', title: '단열재 · 냉방 설정', body: [
        h('div', { class: 'field' }, h('span', { class: 'field-head' }, h('span', { class: 'seg-caption', text: '지붕 단열재 두께 (k = 0.035 W/m·K)' })), insSeg),
        acToggle,
        spField.field,
        h('p', { class: 'table-note', text: '비교표의 지붕·실내 최고온도 및 열유입량은 냉방 OFF, 일일 냉방부하·절감률은 냉방 ON으로 동시 산출됩니다.' }),
      ],
    });
    binders.push((st) => setText(secRoof.sum, `단열 ${st.roof?.insulationMm ?? 0}mm · ${st.interior?.acOn ? `냉방 ON (${fmtNum(st.interior?.setpoint, 0)}°C)` : '냉방 OFF'}`));
    trackChanges(secRoof, ['roof.insulationMm', 'interior.setpoint']);

    // 3D display & Install / Disassemble animation (§10)
    const VIEW = [
      ['heatmap', '지붕 열지도'], ['flow', '공기층 기류'], ['rays', '태양광선'],
      ['labels', '부재 라벨'], ['sunPath', '태양궤적'], ['section', '단면 보기'],
    ];
    const toggles = VIEW.map(([k, label]) => toggle({ id: `ctl-view-${k}`, label, get: (st) => st.view?.[k], onToggle: (on) => doSet({ view: { [k]: on } }) }));
    const explode = rangeField({
      id: 'ctl-explode', label: '분해도', min: 0, max: 1, step: 0.05,
      get: (st) => st.view?.explode, fmt: (v) => (v <= 0 ? '조립' : `${Math.round(v * 100)} %`), footMin: '조립', footMax: '분해',
      patch: (v) => ({ view: { explode: v } }),
    });
    ctl.installBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-install', html: `설치 과정 ${svgPlay}` });
    ctl.installBtn.addEventListener('click', triggerInstall);
    ctl.disassembleBtn = h('button', { type: 'button', class: 'btn btn-sun', id: 'btn-disassemble', html: `해체 과정 ${svgPlay}` });
    ctl.disassembleBtn.addEventListener('click', triggerDisassemble);
    ctl.restoreBtn = h('button', { type: 'button', class: 'btn btn-full', id: 'btn-restore', text: '조립 완료 상태 복원' });
    ctl.restoreBtn.addEventListener('click', triggerRestore);

    const secView = section({
      id: 'sec-display', title: '3D 표시 · 설치/해체', body: [
        h('div', { class: 'row-2' }, toggles),
        explode.field,
        h('div', { class: 'anim-btns' }, ctl.installBtn, ctl.disassembleBtn, ctl.restoreBtn),
      ],
    });
    binders.push((st) => {
      const on = VIEW.filter(([k]) => st.view?.[k]).length;
      setText(secView.sum, `${on}/${VIEW.length} 켜짐`);
    });

    // Screen & performance
    const THEME_LABEL = { auto: '자동', light: '라이트', dark: '다크' };
    const QUALITY_LABEL = { auto: '자동', low: '낮음', medium: '보통', high: '높음' };
    const themeSeg = segmented({
      name: 'theme', label: '테마', get: () => themePref,
      options: ['auto', 'light', 'dark'].map((v) => ({ value: v, label: THEME_LABEL[v], id: `ctl-theme-${v}` })),
      onPick: (v) => setThemePref(v),
    });
    const qualitySeg = segmented({
      name: 'quality', label: '3D 화질', get: (st) => st.ui?.quality ?? 'auto',
      options: ['auto', 'low', 'medium', 'high'].map((v) => ({ value: v, label: QUALITY_LABEL[v], id: `ctl-quality-${v}` })),
      onPick: (v) => doSet({ ui: { quality: v } }),
    });
    const rotate = toggle({ id: 'ctl-autorotate', label: '자동 회전 (3D 뷰)', get: (st) => !!st.ui?.autoRotate, onToggle: (on) => doSet({ ui: { autoRotate: on } }) });
    const secApp = section({
      id: 'sec-app', title: '화면 · 성능', open: false, body: [
        h('div', { class: 'field' }, h('span', { class: 'field-head' }, h('span', { class: 'seg-caption', text: '테마' })), themeSeg),
        h('div', { class: 'field' }, h('span', { class: 'field-head' }, h('span', { class: 'seg-caption', text: '3D 화질' })), qualitySeg),
        rotate,
      ],
    });
    binders.push((st) => setText(secApp.sum, `${THEME_LABEL[themePref]} · ${QUALITY_LABEL[st.ui?.quality] || QUALITY_LABEL.auto}`));
    trackChanges(secApp, ['ui.quality', 'ui.autoRotate'], () => themePref !== 'auto');

    const secScen = buildScenarioSection();

    const small = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
    const secs = [secDesign, secTime, secWeather, secRoof, secView, secApp, secScen].filter(Boolean);
    if (small) for (const s of [secWeather, secApp, secScen]) if (s && lsGet(`kroof.ui.sec.${s.det.id}`) === null) s.det.open = false;

    controlsRoot.append(modeBlock, h('div', { class: 'ctl-flow' }, secs.map((s) => s.det)));
  }

  function buildScenarioSection() {
    if (!scenario || typeof scenario !== 'object') return null;
    const slotsApi = scenario.slots && typeof scenario.slots.list === 'function' ? scenario.slots : null;
    const afterChange = () => { scheduleSync(); scheduleDash(0); };

    const nameIn = h('input', { type: 'text', id: 'ctl-slot-name', class: 'txt-in', maxlength: '24', placeholder: '설정 이름 (최대 24자)', autocomplete: 'off', enterkeyhint: 'done' });
    const slotList = h('ul', { class: 'slot-list', id: 'slot-list' });
    let secScenRef = null;
    const readSlots = () => {
      try { return [...(slotsApi?.list?.() || [])].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); } catch { return []; }
    };
    function renderSlots() {
      const items = readSlots();
      if (!items.length) slotList.replaceChildren(h('li', { class: 'slot-empty muted', text: '저장된 설정이 없습니다' }));
      else {
        slotList.replaceChildren(...items.map((it) => h('li', { class: 'slot-row', 'data-name': it.name },
          h('span', { class: 'slot-main' }, h('span', { class: 'slot-name', title: it.name, text: it.name }), h('span', { class: 'slot-time num', text: fmtSlotTime(it.savedAt) })),
          h('button', { type: 'button', class: 'btn btn-sm', text: '불러오기', onclick: () => loadSlot(it.name) }),
          h('button', { type: 'button', class: 'btn btn-sm', text: '삭제', onclick: () => removeSlot(it.name) }))));
      }
      if (secScenRef) setText(secScenRef.sum, items.length ? `저장 ${items.length}개` : '저장 없음');
    }
    function saveSlot() {
      const name = cleanSlotName(nameIn.value);
      if (!name) { toast('저장할 설정 이름을 입력하세요'); nameIn.focus(); return; }
      const saved = !!slotsApi.save(name);
      if (!saved) { toast('저장하지 못했습니다'); return; }
      nameIn.value = ''; renderSlots();
      toast(`"${name}" 설정을 저장했습니다`);
    }
    function loadSlot(name) {
      const ok = !!slotsApi.load(name);
      toast(ok ? `"${name}" 설정을 불러왔습니다` : '설정을 불러오지 못했습니다');
      if (ok) afterChange();
    }
    function removeSlot(name) { slotsApi.remove(name); renderSlots(); toast(`"${name}" 설정을 삭제했습니다`); }
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveSlot(); } });
    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-slot-save', text: '저장', onclick: saveSlot });
    const slotBlock = slotsApi ? [h('div', { class: 'ctl-label', text: '설정 저장 · 불러오기' }), h('div', { class: 'name-row' }, nameIn, saveBtn), slotList] : [];

    const shareIn = h('input', { type: 'text', id: 'ctl-share-url', class: 'txt-in share-url', readonly: true, hidden: true });
    shareIn.addEventListener('focus', () => shareIn.select());
    const copyBtn = h('button', { type: 'button', class: 'btn', id: 'btn-copy-link', text: '링크 복사' });
    copyBtn.addEventListener('click', () => {
      const url = String(scenario.shareUrl?.() ?? '');
      if (!url) { toast('공유 링크를 만들지 못했습니다'); return; }
      writeClipboard(url).then((ok) => {
        if (ok) { shareIn.hidden = true; toast('공유 링크를 복사했습니다'); }
        else { shareIn.value = url; shareIn.hidden = false; shareIn.focus(); shareIn.select(); toast('링크를 복사하세요'); }
      });
    });

    const gate = createConfirmGate(3000);
    let confirmTimer = null;
    const resetBtn = h('button', { type: 'button', class: 'btn', id: 'btn-reset-all', text: '설정 초기화' });
    const disarm = () => { clearTimeout(confirmTimer); confirmTimer = null; gate.cancel(); resetBtn.textContent = '설정 초기화'; resetBtn.classList.remove('is-confirm'); };
    resetBtn.addEventListener('click', () => {
      if (gate.press()) { disarm(); scenario.reset?.(); toast('모든 설정을 초기값으로 되돌렸습니다'); afterChange(); }
      else { resetBtn.textContent = '정말 초기화? (다시 클릭)'; resetBtn.classList.add('is-confirm'); clearTimeout(confirmTimer); confirmTimer = setTimeout(disarm, 3000); }
    });
    resetBtn.addEventListener('blur', disarm);

    const csvBtn = h('button', { type: 'button', class: 'btn', id: 'btn-export-csv', text: '비교표 CSV 저장', onclick: exportCsv });
    const sec = section({
      id: 'sec-scenario', title: '시나리오 · 내보내기', open: false, body: [
        ...slotBlock,
        h('div', { class: 'ctl-label', text: '공유 · 내보내기' }),
        h('div', { class: 'row' }, copyBtn, csvBtn),
        shareIn,
        h('div', { class: 'row between' }, h('span', { class: 'table-note', text: '기본 기상·해석 조건으로 초기화' }), resetBtn),
      ],
    });
    secScenRef = sec;
    renderSlots();
    return sec;
  }

  function exportCsv() {
    const st = S();
    if (!results.thermal) { toast('계산이 끝난 뒤에 저장할 수 있습니다'); return; }
    const compare = buildCompareRows(cfg, results);
    const w = st.weather || {};
    const csv = buildCsv(compare, {
      conditions: `${siteName(st.siteId)} · ${fmtDate(st.month, st.day)} · 기온 ${fmtPlain(w.Tmax)}/${fmtPlain(w.Tmin)} °C · 풍속 ${fmtPlain(w.windSpeed)} m/s · 맑음 ${fmtPlain(w.clearness)} · 단열 ${st.roof?.insulationMm ?? 0} mm · 냉방 설정 ${fmtPlain(st.interior?.setpoint)} °C`,
    });
    const p2 = (n) => String(n).padStart(2, '0');
    const fileName = `kroof-${st.siteId || 'site'}-${p2(st.month)}${p2(st.day)}.csv`;
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = h('a', { href: url, download: fileName, rel: 'noopener', style: { display: 'none' } });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('CSV 파일을 저장했습니다');
    } catch { toast('CSV 저장이 차단되었습니다'); }
  }

  function triggerInstall() {
    const st = S();
    if (st.design === 'A') { toast('A안은 추가 차열 구조물이 없는 기준 모델입니다. C안 또는 C′안을 선택하세요.'); return; }
    doSet({ actions: { installSeq: (st.actions?.installSeq || 0) + 1 } });
  }
  function triggerDisassemble() {
    const st = S();
    if (st.design === 'A') { toast('A안은 해체할 차열 구조물이 없습니다. C안 또는 C′안을 선택하세요.'); return; }
    doSet({ actions: { disassembleSeq: (st.actions?.disassembleSeq || 0) + 1 } });
  }
  function triggerRestore() {
    const st = S();
    doSet({ actions: { restoreSeq: (st.actions?.restoreSeq || 0) + 1 } });
  }

  // ================================================================ dashboard
  const dash = {};
  function head(title, units, id) {
    return h('header', { class: 'dash-head' }, h('h2', { id, text: title }), units ? h('span', { class: 'dash-units', text: units }) : null);
  }

  function buildDashboard() {
    if (!dashRoot) return;
    dashRoot.replaceChildren();

    dash.ov = h('div', { class: 'ov' });
    dash.kpi = h('div', { class: 'kpi-grid dash-data', id: 'kpi-grid' });
    const rowTop = h('div', { class: 'dash-row two' },
      h('section', { class: 'dash-sec', id: 'sec-overview', 'aria-labelledby': 'h-overview' },
        h('header', { class: 'dash-head' }, h('h2', { id: 'h-overview', text: '선택 설계안 개요' }), h('span', { class: 'dash-units' }, h('span', { class: 'src src-doc', text: '설계 사양' }))),
        dash.ov),
      h('section', { class: 'dash-sec', id: 'sec-kpi', 'aria-labelledby': 'h-kpi' },
        head('핵심 성능 지표 (4종)', '선택안 vs A안 (기준)', 'h-kpi'), dash.kpi));

    // 24-hour temperature chart
    const tabWrap = h('div', { class: 'temp-tabs', role: 'group', 'aria-label': '온도 위치 선택' });
    const TABS = [['both', '통합 (강판하면+실내)'], ['roof', '지붕 강판 하면 온도'], ['indoor', '실내 공기 온도']];
    const tabBtns = TABS.map(([k, label]) => {
      const b = h('button', { type: 'button', id: `tab-temp-${k}`, 'aria-pressed': String(tempTab === k), text: label });
      b.addEventListener('click', () => {
        tempTab = k;
        for (const [bk, btn] of tabBtns) btn.setAttribute('aria-pressed', String(bk === tempTab));
        renderTemp(S(), true);
      });
      return [k, b];
    });
    tabWrap.append(...tabBtns.map(([, b]) => b));

    dash.acChartBtn = h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-chart-ac', 'aria-pressed': 'false', text: '그래프: 냉방 OFF' });
    dash.acChartBtn.addEventListener('click', () => doSet({ interior: { acOn: !S().interior?.acOn } }));

    const visWrap = h('div', { class: 'series-toggles', role: 'group', 'aria-label': '곡선 표시/숨김' },
      [...ALL.map((id) => [id, shortName(id), getD(id).color]), ['air', '외기온도', null]].map(([k, label, col]) => {
        const chip = col ? `<span class="sw-chip" style="--c:${esc(col)}"></span>` : '';
        const b = h('button', {
          type: 'button', class: 'stog', id: `tog-series-${k}`, 'aria-pressed': String(visible[k] !== false),
          html: `${chip}${esc(label)}`,
        });
        b.addEventListener('click', () => {
          visible[k] = !(visible[k] !== false);
          b.setAttribute('aria-pressed', String(visible[k]));
          renderTemp(S(), true);
        });
        return b;
      }));

    dash.tempLegend = h('div', { class: 'chart-legend', id: 'temp-legend' });
    dash.tempCanvas = h('canvas', { id: 'chart-temp', role: 'img', 'aria-label': '24시간 지붕 강판 하면 온도, 실내 공기 온도 및 외기온도 비교 그래프' });
    dash.tempEmpty = h('div', { class: 'chart-empty', text: '계산 중…' });
    dash.tempNote = h('p', { class: 'table-note', id: 'temp-note' });
    const secTemp = h('section', { class: 'dash-sec', id: 'sec-temp', 'aria-labelledby': 'h-temp' },
      head('24시간 온도 변화 그래프 (00:00~24:00)', '마지막 24시간 안정화 결과 · °C', 'h-temp'),
      h('div', { class: 'chart-tools' }, tabWrap, dash.acChartBtn, visWrap),
      dash.tempLegend,
      h('div', { class: 'chart-box dash-data' }, dash.tempCanvas, dash.tempEmpty),
      dash.tempNote);

    // Final 4-design thermal comparison table (§12.2)
    dash.cmpBody = h('tbody');
    const offCols = COMPARE_COLUMNS.filter((c) => c.group === 'off').length;
    const onCols = COMPARE_COLUMNS.length - offCols;
    const cmpHead = h('thead', null,
      h('tr', null,
        h('th', { class: 'sticky-col', scope: 'col', rowspan: '2' }, '설계안 명칭'),
        h('th', { class: 'grp', colspan: String(offCols), text: '냉방 OFF 조건 (24시간)' }),
        h('th', { class: 'grp on', colspan: String(onCols), text: '냉방 ON 조건 (08:00~18:00)' })),
      h('tr', null, COMPARE_COLUMNS.map((c, i) => h('th', {
        scope: 'col',
        class: c.group === 'on' && COMPARE_COLUMNS[i - 1]?.group === 'off' ? 'col-on-first' : null,
        id: `th-${c.key}`,
      }, c.label, c.unit ? h('small', { text: c.unit }) : null))));
    const cmpTable = h('table', { class: 'cmp', id: 'compare-table' },
      h('caption', { class: 'sr', text: '설계안별 최종 비교표' }), cmpHead, dash.cmpBody);
    dash.cmpBody.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) doSet({ design: tr.dataset.id }); });
    dash.cmpBody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) { e.preventDefault(); doSet({ design: tr.dataset.id }); }
    });
    dash.cmpNote = h('p', { class: 'table-note', id: 'cmp-note' });
    const secCmp = h('section', { class: 'dash-sec', id: 'sec-compare', 'aria-labelledby': 'h-compare' },
      head('설계안별 최종 비교표 (A안 · B안 · C안 · C′안)', '행을 클릭하면 3D 뷰 설계안 전환', 'h-compare'),
      h('div', { class: 'table-wrap dash-data' }, cmpTable), dash.cmpNote);

    // Structural specification comparison table
    const SPEC_FIELDS = [
      ['panel', '차열패널'],
      ['gapMm', '공기층 높이'],
      ['topFinish', '패널 상부 마감'],
      ['botFinish', '패널 하부 마감'],
      ['rib', '패널 보강재'],
      ['crossbar', '크로스바'],
      ['pad', '받침 구성'],
      ['panelFix', '패널 모듈 고정'],
      ['tieDown', '컨테이너 결속'],
      ['auxFix', '보조 고정 부품'],
      ['installType', '설치 방식'],
    ];
    const specBody = h('tbody', null, SPEC_FIELDS.map(([k, label]) =>
      h('tr', null, h('th', { scope: 'row', text: label }), ...ALL.map((id) => h('td', { text: getD(id).specs?.[k] || '—' })))));
    const specTable = h('table', { class: 'spec-table', id: 'spec-table' },
      h('thead', null, h('tr', null, h('th', { text: '구분' }), ...ALL.map((id) => h('th', { text: `${shortName(id)} (${getD(id).name})` })))),
      specBody);
    const secSpec = h('section', { class: 'dash-sec', id: 'sec-specs', 'aria-labelledby': 'h-specs' },
      head('설계안별 주요 사양 및 구조 비교', '상세 요청자료 기준', 'h-specs'),
      h('div', { class: 'table-wrap' }, specTable));

    // Install / Disassemble sequence (§10.4)
    dash.steps = h('ol', { class: 'steps', id: 'install-steps' });
    dash.stepsNote = h('p', { class: 'table-note' });
    dash.installBtn2 = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'btn-install-2', html: `설치 재생 ${svgPlay}` });
    dash.installBtn2.addEventListener('click', triggerInstall);
    dash.disassembleBtn2 = h('button', { type: 'button', class: 'btn btn-sun btn-sm', id: 'btn-disassemble-2', html: `해체 재생 ${svgPlay}` });
    dash.disassembleBtn2.addEventListener('click', triggerDisassemble);
    dash.restoreBtn2 = h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-restore-2', text: '복원' });
    dash.restoreBtn2.addEventListener('click', triggerRestore);

    const secInstall = h('section', { class: 'dash-sec', id: 'sec-install', 'aria-labelledby': 'h-install' },
      h('header', { class: 'dash-head' },
        h('h2', { id: 'h-install', text: '설치 · 해체 및 재사용 과정' }),
        h('span', { class: 'dash-units', style: { display: 'inline-flex', gap: '6px' } }, dash.installBtn2, dash.disassembleBtn2, dash.restoreBtn2)),
      dash.steps, dash.stepsNote);

    // Assumptions
    dash.assThermal = h('ul');
    const assume = h('details', { class: 'assume', id: 'sec-assumptions' },
      h('summary', null, '해석 조건 및 단순화 가정', h('span', { class: 'src', text: '상세 요청자료 기준' })),
      h('div', { class: 'assume-body' },
        h('p', { class: 'assume-note', text: '본 시뮬레이션은 동일한 대표 여름 기상 조건에서 A안·B안·C안·C′안의 상대적 열성능을 객관적으로 비교하기 위한 1차원 과도 열수지 해석입니다. 상세 경제성 분석 및 정밀 구조 안전성(풍하중 안전율·한계풍속) 검토는 별도 수행 범위로 본 계산에서 제외되었습니다.' }),
        dash.assThermal));

    dashRoot.append(rowTop, secTemp, secCmp, secSpec, secInstall, assume);
    renderAssumptions();
    renderInstallList();
  }

  let ovSig = null;
  function renderOverview(st) {
    const sig = `${st.design}|${st.roof?.insulationMm}`;
    if (sig === ovSig || !dash.ov) return;
    ovSig = sig;
    const id = st.design, d = getD(id);
    const parts = [
      h('div', { class: 'ov-head' },
        h('span', { class: 'dr-id', style: { '--c': d.color }, text: shortName(id) }),
        h('h3', { text: d.fullName || d.name })),
    ];
    if (d.tagline) parts.push(h('p', { class: 'ov-tagline', text: d.tagline }));
    if (d.description) parts.push(h('p', { class: 'ov-desc', text: d.description }));
    if (Array.isArray(d.callouts) && d.callouts.length) {
      parts.push(h('ol', { class: 'ov-callouts', 'aria-label': '부품 구성' },
        d.callouts.map((c) => h('li', null, h('span', { class: 'cn', 'aria-hidden': 'true', text: String(c.n) }),
          h('span', null, c.text, c.sub ? h('span', { class: 'cs', text: c.sub }) : null)))));
    }
    if (d.gapText) parts.push(h('p', { class: 'ov-gap' }, h('span', { class: 'gap-chip', text: '공기층' }), d.gapText));
    dash.ov.replaceChildren(...parts);
  }

  function renderKpis(st) {
    if (!dash.kpi) return;
    const tiles = computeKpis({ sel: st.design, thermal: results.thermal, setpoint: st.interior?.setpoint ?? 26 });
    dash.kpi.innerHTML = tiles.map((t) => {
      const val = t.empty ? '<span class="skel" aria-label="계산 중"></span>'
        : `<span class="v">${esc(fmtNum(t.value, t.digits))}</span><span class="u">${esc(t.unit)}</span>`;
      const delta = t.empty ? '<span class="muted">계산 중…</span>' : esc(t.deltaText || '');
      return `<div class="kpi" data-key="${t.key}">
        <div class="kpi-top"><span class="kpi-label">${esc(t.label)}</span><span class="src">계산값</span></div>
        <div class="kpi-value">${val}</div>
        <div class="kpi-delta ${t.tone || ''}">${delta}</div>
        <div class="kpi-sub"><span>${esc(t.sub || '')}</span></div>
      </div>`;
    }).join('');
  }

  let tempChart = null, theme = null;
  function ensureCharts() {
    if (!chartsAvailable()) {
      if (dash.tempEmpty) dash.tempEmpty.textContent = '차트 라이브러리를 불러오지 못했습니다. 아래 비교표를 참고하세요.';
      return false;
    }
    theme = theme || readTheme();
    try {
      if (!tempChart && dash.tempCanvas) tempChart = createTempChart(dash.tempCanvas, theme);
    } catch (e) { console.error('[ui] chart init failed', e); return false; }
    return true;
  }

  let tempKey = null;
  function renderTemp(st, force = false) {
    if (!dash.tempLegend) return;
    const acOn = !!st.interior?.acOn;
    const key = `${st.design}|${acOn}|${tempTab}|${JSON.stringify(visible)}|${resultsVersion}|${chartsAvailable()}`;
    if (!force && key === tempKey && tempChart) return;
    tempKey = key;

    if (dash.acChartBtn) {
      dash.acChartBtn.setAttribute('aria-pressed', String(acOn));
      dash.acChartBtn.textContent = acOn ? `그래프: 냉방 ON (${fmtPlain(st.interior?.setpoint ?? 26)}°C)` : '그래프: 냉방 OFF';
    }

    const series = buildTempSeries(results.thermal, { design: st.design, acOn, viewTab: tempTab, visible }, cfg);
    const has = series.length > 0;
    dash.tempEmpty.hidden = has && chartsAvailable();
    if (has) dash.tempEmpty.textContent = '계산 중…';

    const ids = [...new Set(series.filter((s) => s.id !== 'air').map((s) => s.id))];
    dash.tempLegend.innerHTML = ids.map((id) => {
      const d = getD(id);
      return `<span class="${id === st.design ? 'lg-emph' : ''}"><span class="sw-chip" style="--c:${esc(d.color)}"></span>${esc(shortName(id))} ${esc(d.name)}</span>`;
    }).join('') + (series.some((s) => s.id === 'air') ? '<span><span class="sw-chip" style="--c:var(--ink-3)"></span>외기온도 (점선)</span>' : '')
      + (tempTab === 'both' ? '<span class="muted">실선: 지붕 강판 하면 · 파선: 실내 공기</span>' : '');

    if (dash.tempNote) {
      const ins = st.roof?.insulationMm ?? 0;
      dash.tempNote.textContent = ins > 0
        ? `현재 지붕 단열재 ${ins} mm 적용 상태입니다. 그래프의 '지붕 강판 하면 온도'는 단열재 실내측 표면이 아닌 기존 1.2T 강판의 하부 표면 온도를 의미합니다.`
        : '현재 지붕 단열재 0 mm(기본) 상태입니다. 마우스를 그래프 위에 올리면 시각별 정확한 온도값을 확인할 수 있습니다.';
    }

    if (!ensureCharts() || !tempChart) return;
    tempChart.setSeries(series);
    tempChart.setCursor(isNum(clock.hour) ? clock.hour : st.hour, fmtHHMM(isNum(clock.hour) ? clock.hour : st.hour));
  }

  function renderCompare(st) {
    if (!dash.cmpBody) return;
    const model = buildCompareRows(cfg, results);
    const cols = model.columns;
    dash.cmpBody.innerHTML = model.rows.map((r) => {
      const sel = r.id === st.design;
      const cells = cols.map((c, i) => {
        const cell = r.cells[c.key];
        const cls = [
          cell.best ? 'best' : '',
          cell.na ? 'na' : '',
          c.group === 'on' && cols[i - 1]?.group === 'off' ? 'col-on-first' : '',
        ].filter(Boolean).join(' ');
        return `<td${cls ? ` class="${cls}"` : ''}>${esc(cell.text)}</td>`;
      }).join('');
      return `<tr data-id="${esc(r.id)}" tabindex="0" class="${sel ? 'is-sel' : ''}" aria-selected="${sel}">
        <td><span class="id-cell"><span class="sw-chip" style="--c:${esc(r.color)}"></span>${esc(r.name)}</span></td>${cells}</tr>`;
    }).join('');
    if (dash.cmpNote) {
      dash.cmpNote.textContent = `냉방부하는 냉방기 소비전력이 아니라 08:00~18:00 동안 실내 설정온도(${fmtPlain(st.interior?.setpoint ?? 26)}°C)를 유지하기 위해 제거해야 하는 열에너지량(kWh)입니다. 강조된 셀은 동일 항목에서 가장 유리한 수치입니다.`;
    }
  }

  function renderInstallList() {
    if (!dash.steps) return;
    const st = S();
    const { rows } = installTimeline(install.steps);
    if (!rows.length) {
      const msg = st.design === 'A'
        ? 'A안은 별도 차열 지붕을 설치하지 않는 기존 컨테이너(기준 모델)입니다.'
        : '설치 단계를 불러오는 중…';
      dash.steps.replaceChildren(h('li', null, h('span'), h('span', { class: 'muted', text: msg }), h('span')));
      setText(dash.stepsNote, '');
      return;
    }
    dash.steps.replaceChildren(...rows.map((r) => {
      const running = install.running && r.i === install.stepIndex;
      const done = install.running ? r.i < install.stepIndex : false;
      return h('li', { class: running ? 'is-running' : done ? 'is-done' : null, 'aria-current': running ? 'step' : null },
        h('span', { class: 'sn', text: String(r.i + 1) }),
        h('span', { class: 'st', text: r.title }),
        h('span', { class: 'sm', text: `${r.i + 1}단계` }));
    }));
    const note = st.design === 'C' || st.design === 'Cp'
      ? `${shortName(st.design)}은 무천공 모듈식 탈부착 구조로, 해체 시 결속 해제 후 개별 패널 모듈과 크로스바·받침 부재를 그대로 회수하여 재사용할 수 있습니다.`
      : 'B안은 공기층 없이 ACP 4T를 직접 밀착하는 구조입니다.';
    setText(dash.stepsNote, note);
  }

  function renderAssumptions() {
    if (!dash.assThermal) return;
    const arr = assumptions.thermal || [];
    dash.assThermal.replaceChildren(...(arr.length ? arr.map((t) => h('li', { text: t })) : [h('li', { class: 'muted', text: '불러오는 중…' })]));
  }

  let dashTimer = null;
  function scheduleDash(delay = 40) {
    if (dashTimer) return;
    dashTimer = setTimeout(() => { dashTimer = null; renderDash(); }, delay);
  }
  function renderDash() {
    const st = S();
    const safe = (fn) => { try { fn(st); } catch (e) { console.error('[ui] render failed', e); } };
    safe(renderOverview);
    safe(renderKpis);
    safe(renderTemp);
    safe(renderCompare);
  }

  function renderHeader(st) {
    setText(document.getElementById('tb-site'), `${siteName(st.siteId)} · ${fmtDate(st.month, st.day)}`);
    const d = getD(st.design);
    setText(document.getElementById('tb-mode'), st.mode === 'compare'
      ? `4동 비교 · 선택 ${shortName(st.design)}`
      : `단일 · ${shortName(st.design)} ${d.name || ''}`);
  }
  function renderStatus() {
    const el = document.getElementById('tb-status');
    if (!el) return;
    const hasAny = !!results.thermal;
    el.replaceChildren(busy || !hasAny
      ? h('span', { class: 'spinner', 'aria-hidden': 'true' })
      : h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: busy || !hasAny ? '계산 중…' : '최신' }));
  }

  let dashSig = null;
  function syncFromState() {
    const st = S();
    if (!st) return;
    for (const b of binders) { try { b(st); } catch (e) { console.error('[ui] bind failed', e); } }
    const playing = !!st.playing;
    for (const b of [ctl.play, hud.play]) {
      if (!b) continue;
      if (b.getAttribute('aria-pressed') !== String(playing)) {
        b.setAttribute('aria-pressed', String(playing));
        b.innerHTML = playing ? svgPause : svgPlay;
        b.setAttribute('aria-label', playing ? '시간 일시정지' : '시간 재생');
      }
    }
    for (const [b, v] of hud.cams || []) b.setAttribute('aria-pressed', String(st.camera === v));
    if (hud.date) setText(hud.date, `${fmtDate(st.month, st.day)} · ${siteName(st.siteId)}`);
    if (!isNum(clock.hour)) updateClockText(st.hour);
    renderTimeSummary(st);
    renderHeader(st);
    const sig = [st.mode, st.design, st.interior?.acOn, st.interior?.setpoint, st.roof?.insulationMm].join('|');
    if (sig !== dashSig) {
      const designChanged = !dashSig || dashSig.split('|')[1] !== st.design;
      dashSig = sig;
      if (designChanged) renderInstallList();
      scheduleDash(0);
    }
  }

  function renderTimeSummary(st) {
    const hr = isNum(clock.hour) ? clock.hour : st.hour;
    if (ctl.timeSum) setText(ctl.timeSum, `${siteShort(st.siteId)} · ${st.month}/${st.day} ${fmtHHMM(hr)}`);
    if (ctl.sunTimes) {
      const t = sunTimes;
      setText(ctl.sunTimes, t && isNum(t.sunrise) && isNum(t.sunset)
        ? `일출 ${fmtHHMM(t.sunrise)} · 일몰 ${fmtHHMM(t.sunset)}${isNum(t.solarNoon) ? ` · 남중 ${fmtHHMM(t.solarNoon)}` : ''}`
        : '');
    }
  }

  let lastClockText = '';
  function updateClockText(hour) {
    const t = fmtHHMM(hour);
    if (t !== lastClockText) { lastClockText = t; if (hud.clock) hud.clock.textContent = t; }
  }
  function setClock({ hour, sun, sample } = {}) {
    const st = S();
    if (isNum(hour)) clock.hour = hour;
    if (sun !== undefined) clock.sun = sun;
    if (sample !== undefined) clock.sample = sample;
    if (sun && (isNum(sun.sunrise) || isNum(sun.sunset))) sunTimes = { sunrise: sun.sunrise, sunset: sun.sunset, solarNoon: sun.solarNoon };
    const hr = isNum(clock.hour) ? clock.hour : st.hour;
    updateClockText(hr);
    if (ctl.hour && isNum(hr)) {
      setRangeValue(ctl.hour, hr);
      if (!editing(ctl.hour)) setText(ctl.hourOut, fmtHHMM(hr));
    }
    const s = clock.sun;
    if (hud.sun) {
      if (s && isNum(s.elevation)) {
        setText(hud.sun, s.elevation > 0 ? `${fmtNum(s.azimuth, 0)}° / ${fmtNum(s.elevation, 0)}°` : `해 없음 (${fmtNum(s.elevation, 0)}°)`);
        setText(hud.ghi, `${fmtNum(Math.max(0, s.ghi ?? 0), 0)} W/m²`);
      } else { setText(hud.sun, DASH); setText(hud.ghi, DASH); }
    }
    const smp = clock.sample || {};
    const cur = smp[st.design] || smp.A || Object.values(smp)[0];
    const ta = cur && isNum(cur.Ta) ? cur.Ta : s && isNum(s.Ta) ? s.Ta : null;
    if (hud.ta) setText(hud.ta, isNum(ta) ? `${fmtNum(ta, 1)} °C` : DASH);
    if (hud.roof) {
      const b = smp.A, sel = st.design !== 'A' ? smp[st.design] : null;
      const key = `${st.design}|${fmtNum(b?.TroofBot, 1)}|${fmtNum(sel?.TroofBot, 1)}`;
      if (hud.roof.dataset.k !== key) {
        hud.roof.dataset.k = key;
        const part = (id, v) => `<span class="hud-sw" style="--c:${esc(getD(id).color)}"></span>${esc(shortName(id))} ${esc(fmtNum(v?.TroofBot, 1))}°`;
        hud.roof.innerHTML = b ? part('A', b) + (sel ? ` → ${part(st.design, sel)}` : '') : DASH;
      }
    }
    if (tempChart && isNum(hr)) tempChart.setCursor(hr, fmtHHMM(hr));
    renderTimeSummary(st);
  }

  function renderResults(res = {}) {
    if (!res || typeof res !== 'object') return;
    if ('thermal' in res) results.thermal = res.thermal || null;
    resultsVersion++;
    renderStatus();
    scheduleDash();
  }

  function setInstall(info = {}) {
    install = { ...install, ...info };
    if (!Array.isArray(install.steps)) install.steps = [];
    const running = !!install.running && install.steps.length > 0;
    if (hud.install) {
      hud.install.hidden = !running;
      hudRoot.classList.toggle('is-installing', running);
      if (running) {
        const p = installProgress(install);
        setText(hud.instStep, p.stepText);
        setText(hud.instTime, p.timeText);
        setText(hud.instTitle, p.title);
        hud.instBar.style.width = `${p.pct}%`;
      }
    }
    const sig = `${running}|${install.mode}|${install.stepIndex}|${install.steps.map((s) => s.title).join('/')}`;
    if (sig !== install._sig) { install._sig = sig; renderInstallList(); }
    const instLabel = running && install.mode === 'install' ? '설치 중…' : '설치 과정';
    const disLabel = running && install.mode === 'disassemble' ? '해체 중…' : '해체 과정';
    for (const b of [ctl.installBtn, dash.installBtn2]) if (b) b.innerHTML = `${esc(instLabel)} ${running ? '' : svgPlay}`;
    for (const b of [ctl.disassembleBtn, dash.disassembleBtn2]) if (b) b.innerHTML = `${esc(disLabel)} ${running ? '' : svgPlay}`;
  }

  function setAssumptions(a = {}) {
    assumptions = { thermal: a.thermal || assumptions.thermal || [] };
    renderAssumptions();
  }

  function setBusy(b) {
    busy = !!b;
    if (dashRoot) dashRoot.classList.toggle('is-busy', busy);
    renderStatus();
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = String(msg ?? '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function setLegend(L) { legendState = L || null; applyLegend(); }
  function setSunTimes(t) { sunTimes = t || null; renderTimeSummary(S()); }

  let themeQueued = false;
  function onThemeChange() {
    if (themeQueued) return;
    themeQueued = true;
    requestAnimationFrame(() => {
      themeQueued = false;
      theme = readTheme();
      try { tempChart?.applyTheme(theme); } catch (e) { console.error('[ui] theme apply failed', e); }
    });
  }
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', onThemeChange); else if (mq.addListener) mq.addListener(onThemeChange);
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }

  buildHud();
  buildControls();
  buildDashboard();
  syncFromState();
  renderStatus();

  return {
    renderResults, setClock, setInstall, setAssumptions, setBusy, toast,
    syncFromState, setLegend, setSunTimes,
  };
}
