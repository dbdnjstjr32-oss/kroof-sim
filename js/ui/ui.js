// ui.js — control rail (#controls), HUD overlay (#hud) and results dashboard (#dashboard).
// DOM code runs only inside createUI(); every formatting / derivation helper below is pure and exported
// so Node tests can import this module without a browser.
import { chartsAvailable, readTheme, createTempChart, createWindChart, SF_AXIS_MAX } from './charts.js';

// ================================================================ pure helpers
export const DASH = '—';
const MINUS = '−';
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fixed-digit number with a real minus sign; '—' for missing values; never '-0.0'. */
export function fmtNum(v, digits = 1) {
  if (!isNum(v)) return DASH;
  let s = v.toFixed(digits);
  if (Number(s) === 0) s = (0).toFixed(digits);
  return s.replace('-', MINUS);
}
/** Signed number: '+1.2', '−3.4', '0.0'. */
export function fmtSigned(v, digits = 1) {
  if (!isNum(v)) return DASH;
  const abs = Math.abs(v).toFixed(digits);
  if (Number(abs) === 0) return abs;
  return (v > 0 ? '+' : MINUS) + abs;
}
/** Shortest natural representation: 0.5, 1, 0.09. */
export function fmtPlain(v) {
  if (!isNum(v)) return DASH;
  return String(Math.round(v * 1000) / 1000).replace('-', MINUS);
}
/** Document ranges: [25,35] → '25–35', [75,75] → '75'. */
export function fmtRange(r, sep = '–') {
  if (!Array.isArray(r)) return isNum(r) ? fmtPlain(r) : DASH;
  const [a, b] = r;
  if (!isNum(a)) return isNum(b) ? fmtPlain(b) : DASH;
  if (!isNum(b) || a === b) return fmtPlain(a);
  return `${fmtPlain(a)}${sep}${fmtPlain(b)}`;
}
export function rangeMid(r) {
  if (!Array.isArray(r)) return isNum(r) ? r : NaN;
  const [a, b] = r;
  if (isNum(a) && isNum(b)) return (a + b) / 2;
  return isNum(a) ? a : isNum(b) ? b : NaN;
}
/** Decimal hour → 'HH:MM' (clamped to 00:00–24:00). */
export function fmtHHMM(hour) {
  if (!isNum(hour)) return '--:--';
  const m = Math.round(Math.min(24, Math.max(0, hour)) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function fmtDate(month, day) { return `${month}월 ${day}일`; }
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function daysInMonth(month) { return MONTH_DAYS[(Math.round(month) - 1 + 12) % 12] || 31; }
export function clampDay(month, day) { return Math.max(1, Math.min(daysInMonth(month), Math.round(day) || 1)); }
/** 1 → '①' … 20 → '⑳' (the document's circled callout numbers). */
export function circled(n) { return n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : `(${n})`; }
export function decimalsOf(step) {
  const s = String(step); const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

// Meteorological wind direction = where the wind blows FROM.
export const DIRECTIONS = [
  { deg: 0, ko: '북', en: 'N' }, { deg: 45, ko: '북동', en: 'NE' }, { deg: 90, ko: '동', en: 'E' },
  { deg: 135, ko: '남동', en: 'SE' }, { deg: 180, ko: '남', en: 'S' }, { deg: 225, ko: '남서', en: 'SW' },
  { deg: 270, ko: '서', en: 'W' }, { deg: 315, ko: '북서', en: 'NW' },
];
export function nearestDirection(deg) {
  const d = (((isNum(deg) ? deg : 0) % 360) + 360) % 360;
  return DIRECTIONS[Math.round(d / 45) % 8];
}
export function windDirLabel(deg) { const d = nearestDirection(deg); return `${d.ko}풍 (${d.en})`; }

export const STATUS_TEXT = { ok: '적합', warn: '주의', fail: '위험' };
export const STATUS_GLYPH = { ok: '✓', warn: '!', fail: '✕' };
/** SF → status using the contract thresholds (ok ≥ 1.5, warn 1.0–1.5, fail < 1.0). */
export function statusOf(sf) {
  if (sf === Infinity) return 'ok';
  if (!isNum(sf)) return null;
  return sf >= 1.5 ? 'ok' : sf >= 1.0 ? 'warn' : 'fail';
}
/** Highest reference marker at or below V (e.g. current KMA warning level), or null. */
export function windLevel(V, markers = []) {
  let hit = null;
  for (const m of [...markers].sort((a, b) => a.V - b.V)) if (isNum(V) && V >= m.V) hit = m;
  return hit;
}

/** '강풍주의보 (평균 14)' → '강풍주의보 (평균)'; '태풍 "강" (33)' → '태풍 "강"' (the number is shown separately). */
export function markerShort(label) {
  return String(label ?? '')
    .replace(/\s*\(\s*[\d.]+\s*\)\s*$/, '')
    .replace(/\(([^)]*?)\s*[\d.]+\)/, '($1)')
    .trim();
}

// Document ranges for the design variables (source document pp. 3–7).
export const DOC_RANGES = {
  A: { gap: '0.5~1 m' },
  B: { gap: '8~10 cm' },
  C: { gap: '8~10 cm', strapLC: 'LC 4~20 kN급' },
  D: { gap: '0.7~1 m', shade: '70~90 %' },
  E: { gap: '8~10 cm' },
};
export function docRange(id, key, p) { return (p && p.docRange) || DOC_RANGES[id]?.[key] || null; }

/** Slider value text for a design parameter: { text, alt }. Fractions without unit (shade) → %. */
export function paramText(key, p, v) {
  if (!isNum(v)) return { text: DASH, alt: '' };
  if (key === 'shade' || (p && p.unit === '' && p.max <= 1)) {
    return { text: `${Math.round(v * 100)} %`, alt: `투과 ${Math.round((1 - v) * 100)} %` };
  }
  const d = decimalsOf(p?.step ?? 0.01);
  const unit = p?.unit ? ` ${p.unit}` : '';
  const alt = p?.unit === 'm' && v < 0.3 ? `${Math.round(v * 100)} cm` : '';
  return { text: `${v.toFixed(d)}${unit}`, alt };
}

/** True when month/day and weather values equal the preset's (so the preset select can show it). */
export function presetMatches(st, preset) {
  if (!st || !preset) return false;
  const w = st.weather || {};
  const eq = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) < 1e-6;
  return st.month === preset.month && st.day === preset.day &&
    eq(w.Tmax, preset.Tmax) && eq(w.Tmin, preset.Tmin) && eq(w.windSpeed, preset.windSpeed) && eq(w.clearness, preset.clearness);
}

/** Document meta as label/value chips. */
export function metaChips(d) {
  const m = d?.meta;
  if (!m || !m.partKinds) return [];
  const chips = [
    { k: '부품', v: m.partKindsText || String(m.partKinds), u: '종' },
    { k: '무게', v: fmtRange(m.weightKg), u: 'kg' },
    { k: '비용', v: fmtRange(m.costManwon), u: '만원' },
    { k: '설치', v: fmtRange(m.installMin), u: m.crew ? `분 · ${m.crew}인` : '분' },
  ];
  if (m.toolsFree) chips.push({ k: '공구', v: '불필요', u: '' });
  return chips;
}

export function eNote(E) {
  const L = E?.layout || { cols: 4, rows: 5, panelL: 1.4, panelW: 0.6, docCount: 50 };
  return `문서 표기 '${L.docCount}장'은 3×6m 지붕·65kg과 맞지 않아 ${L.panelL}×${L.panelW}m 패널 ${L.cols * L.rows}장(${L.cols}×${L.rows})으로 모델링함`;
}

const pctChange = (x, base) => (isNum(x) && isNum(base) && Math.abs(base) > 1e-9 ? ((x - base) / base) * 100 : null);
export const shortName = (id) => (id === '0' ? '기존' : id);

/**
 * KPI tiles for the selected design vs baseline.
 * → [{ key, label, value, digits, unit, delta, deltaText, tone, sub, status, source, empty }]
 */
export function computeKpis({ sel, thermal, wind, acOn, gust }) {
  const s = thermal?.[sel]?.summary;
  const b = thermal?.['0']?.summary;
  const isBase = sel === '0';
  const tone = (d) => (!isNum(d) || Math.abs(d) < 1e-9 ? 'neutral' : d < 0 ? 'good' : 'bad');
  const tiles = [];

  const dRoof = !isBase && s && b ? s.TroofMax - b.TroofMax : null;
  tiles.push({
    key: 'roof', label: '지붕 최고온도', value: s?.TroofMax, digits: 1, unit: '°C', source: 'sim', empty: !s,
    delta: dRoof, tone: tone(dRoof),
    deltaText: isBase ? '기준 (차열 없음)' : isNum(dRoof) ? `기존 대비 ${fmtSigned(dRoof, 1)} °C` : '',
    sub: s && isNum(s.TroofMaxHour) ? `${fmtHHMM(s.TroofMaxHour)} 최고` : '',
  });

  if (acOn) {
    const p = !isBase && s && b ? pctChange(s.acKWh, b.acKWh) : null;
    tiles.push({
      key: 'ac', label: '냉방 전력량', value: s?.acKWh, digits: 2, unit: 'kWh/일', source: 'sim', empty: !s,
      delta: p, tone: tone(p),
      deltaText: isBase ? '기준 (차열 없음)' : isNum(p) ? `절감률 ${fmtNum(-p, 0)} %` : '',
      sub: s && isNum(s.peakAcW) ? `피크 ${fmtNum(s.peakAcW, 0)} W` : '',
    });
  } else {
    const d = !isBase && s && b ? s.TinMax - b.TinMax : null;
    tiles.push({
      key: 'tin', label: '실내 최고온도', value: s?.TinMax, digits: 1, unit: '°C', source: 'sim', empty: !s,
      delta: d, tone: tone(d),
      deltaText: isBase ? '기준 (차열 없음)' : isNum(d) ? `기존 대비 ${fmtSigned(d, 1)} °C` : '',
      sub: '에어컨 끔 기준',
    });
  }

  const pq = !isBase && s && b ? pctChange(s.roofHeatKWh, b.roofHeatKWh) : null;
  tiles.push({
    key: 'heat', label: '지붕 유입열', value: s?.roofHeatKWh, digits: 2, unit: 'kWh/일', source: 'sim', empty: !s,
    delta: pq, tone: tone(pq),
    deltaText: isBase ? '기준 (차열 없음)' : isNum(pq) ? `기존 대비 ${fmtSigned(pq, 0)} %` : '',
    sub: '지붕을 통해 실내로 들어온 열',
  });

  const w = wind?.[sel];
  if (isBase) {
    tiles.push({ key: 'wind', label: '한계풍속', value: null, digits: 0, unit: 'm/s', source: 'sim', empty: false, none: true,
      deltaText: '', sub: '차열 구조물 없음 · 해당 없음', status: null });
  } else {
    const st = w ? (w.status || statusOf(w.sf)) : null;
    const cv = w?.criticalV;
    tiles.push({
      key: 'wind', label: '한계풍속', value: cv, digits: 0, unit: 'm/s', source: 'sim', empty: !w,
      valueText: w ? (cv === Infinity || (isNum(cv) && cv > 50) ? '> 50' : undefined) : undefined,
      status: st, sf: w?.sf,
      deltaText: w ? `안전율 ${fmtSF(w.sf)} @ ${fmtPlain(gust)} m/s` : '',
      tone: 'neutral', sub: '가정 부재 용량 기준',
    });
  }
  return tiles;
}

export function fmtSF(sf) {
  if (sf === Infinity) return '∞';
  if (!isNum(sf)) return DASH;
  return sf >= 10 ? '> 10' : sf.toFixed(2);
}

export const COMPARE_COLUMNS = [
  { key: 'TroofMax', label: '지붕 최고', unit: '°C', group: 'sim', better: 'min', digits: 1 },
  { key: 'TinMax', label: '실내 최고(AC off)', unit: '°C', group: 'sim', better: 'min', digits: 1 },
  { key: 'roofHeatKWh', label: '지붕 유입열', unit: 'kWh', group: 'sim', better: 'min', digits: 2 },
  { key: 'acKWh', label: '냉방', unit: 'kWh', group: 'sim', better: 'min', digits: 2 },
  { key: 'saving', label: '절감', unit: '%', group: 'sim', better: 'max', digits: 0 },
  { key: 'criticalV', label: '한계풍속', unit: 'm/s', group: 'sim', better: 'max', digits: 0 },
  { key: 'sf', label: '안전율', unit: '@V', group: 'sim', better: 'max', digits: 2 },
  { key: 'weight', label: '무게', unit: 'kg', group: 'doc', better: 'min' },
  { key: 'cost', label: '비용', unit: '만원', group: 'doc', better: 'min' },
  { key: 'install', label: '설치', unit: '분', group: 'doc', better: 'min' },
  { key: 'parts', label: '부품', unit: '종', group: 'doc', better: 'min' },
  { key: 'tools', label: '공구', unit: '', group: 'doc', better: 'true' },
];

/**
 * Comparison table model for all ids. Best value per column (designs only, baseline excluded,
 * no highlight when all equal).  → { columns, rows:[{ id, name, color, cells:{key:{v,text,status,best}} }] }
 */
export function buildCompareRows(config, results = {}, { acOn = true, gust } = {}) {
  const ids = config.ALL_IDS || ['0', ...(config.DESIGN_IDS || Object.keys(config.DESIGNS || {}))];
  const getD = (id) => (id === '0' ? config.BASELINE : config.DESIGNS[id]);
  const th = results.thermal || {}, wi = results.wind || {};
  const base = th['0']?.summary;
  const rows = ids.map((id) => {
    const d = getD(id) || {};
    const s = th[id]?.summary;
    const w = wi[id];
    const m = d.meta || {};
    const isBase = id === '0';
    const c = {};
    const pending = (key) => (th[id] ? DASH : '…');
    c.TroofMax = { v: s?.TroofMax, text: s ? fmtNum(s.TroofMax, 1) : pending() };
    const tin = s ? (isNum(s.TinMaxFree) ? s.TinMaxFree : s.TinMax) : undefined;   // free-floating peak (AC off)
    c.TinMax = { v: tin, text: s ? fmtNum(tin, 1) : pending() };
    c.roofHeatKWh = { v: s?.roofHeatKWh, text: s ? fmtNum(s.roofHeatKWh, 2) : pending() };
    if (acOn) {
      c.acKWh = { v: s?.acKWh, text: s ? fmtNum(s.acKWh, 2) : pending() };
      const sav = !isBase && s && base ? pctChange(s.acKWh, base.acKWh) : null;
      c.saving = { v: isNum(sav) ? -sav : null, text: isBase ? '기준' : isNum(sav) ? fmtNum(-sav, 0) : s ? DASH : '…' };
    } else {
      c.acKWh = { v: null, text: '끔' };
      c.saving = { v: null, text: DASH };
    }
    if (isBase) {
      c.criticalV = { v: null, text: DASH };
      c.sf = { v: null, text: DASH };
    } else {
      const cv = w?.criticalV;
      c.criticalV = { v: cv === Infinity ? 1e9 : cv, text: !w ? '…' : cv === Infinity || (isNum(cv) && cv > 50) ? '> 50' : fmtNum(cv, 0) };
      c.sf = { v: w?.sf === Infinity ? 1e9 : w?.sf, text: w ? fmtSF(w.sf) : '…', status: w ? (w.status || statusOf(w.sf)) : null };
    }
    if (isBase) {
      for (const k of ['weight', 'cost', 'install', 'parts', 'tools']) c[k] = { v: null, text: DASH };
    } else {
      c.weight = { v: rangeMid(m.weightKg), text: fmtRange(m.weightKg) };
      c.cost = { v: rangeMid(m.costManwon), text: fmtRange(m.costManwon) };
      c.install = { v: rangeMid(m.installMin), text: fmtRange(m.installMin) };
      c.parts = { v: m.partKinds, text: m.partKindsText || fmtPlain(m.partKinds) };
      c.tools = { v: m.toolsFree ? 1 : 0, text: m.toolsFree ? '불필요' : '필요' };
    }
    return { id, name: isBase ? '기존 지붕' : d.name, color: d.color, cells: c };
  });

  for (const col of COMPARE_COLUMNS) {
    const cand = rows.filter((r) => r.id !== '0' && isNum(r.cells[col.key].v));
    if (cand.length < 2) continue;
    const vals = cand.map((r) => r.cells[col.key].v);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (Math.abs(hi - lo) < 1e-9) continue;
    const target = col.better === 'min' ? lo : hi;
    for (const r of cand) if (Math.abs(r.cells[col.key].v - target) < 1e-9) r.cells[col.key].best = true;
  }
  return { columns: COMPARE_COLUMNS, rows, gust };
}

const xy = (hours, arr) => hours.map((h, i) => ({ x: h, y: isNum(arr?.[i]) ? arr[i] : null }));

/**
 * 24-h temperature series spec (pure). show = { roof, shade, indoor, air }.
 * Single mode: baseline + selected; compare: all six. Selected design drawn on top & thicker.
 */
export function buildTempSeries(thermal, { mode = 'single', design = '0', show = {} } = {}, config = {}) {
  const getD = (id) => (id === '0' ? config.BASELINE : config.DESIGNS?.[id]) || {};
  const all = config.ALL_IDS || ['0', 'A', 'B', 'C', 'D', 'E'];
  const ids = mode === 'compare' ? all : design === '0' ? ['0'] : ['0', design];
  const out = [];
  let airSrc = null;
  for (const id of ids) {
    const r = thermal?.[id];
    if (!r || !Array.isArray(r.hours)) continue;
    airSrc = airSrc || r;
    const d = getD(id);
    const emph = id === design;
    const color = d.color || null;
    const base = { id, color, order: emph ? 0 : 1 };
    const wRoof = emph ? 2.8 : mode === 'compare' ? 1.5 : 2;
    const nm = shortName(id);
    if (show.roof !== false) out.push({ ...base, key: `${id}:roof`, kind: 'roof', label: `${nm} 지붕`, dash: [], width: wRoof, data: xy(r.hours, r.Troof) });
    if (show.shade && id !== '0' && Array.isArray(r.Tshade) && r.Tshade.some(isNum)) {
      out.push({ ...base, key: `${id}:shade`, kind: 'shade', label: `${nm} 차열층`, dash: [7, 4], width: emph ? 2 : 1.4, data: xy(r.hours, r.Tshade) });
    }
    if (show.indoor) out.push({ ...base, key: `${id}:indoor`, kind: 'indoor', label: `${nm} 실내`, dash: [9, 3, 2, 3], width: emph ? 2 : 1.4, data: xy(r.hours, r.Tin) });
  }
  if (show.air !== false && airSrc) {
    out.push({ id: 'air', key: 'air', kind: 'air', label: '외기', color: null, order: 2, dash: [1.5, 3.5], width: 2, data: xy(airSrc.hours, airSrc.Ta) });
  }
  return out;
}

/** SF-vs-V series for A–E (pure). SF is clamped for plotting; raw value kept in `sf`. */
export function buildWindSeries(curves, { design } = {}, config = {}) {
  const ids = config.DESIGN_IDS || ['A', 'B', 'C', 'D', 'E'];
  const cap = SF_AXIS_MAX + 2;
  const out = [];
  ids.forEach((id, i) => {
    const c = curves?.[id];
    if (!Array.isArray(c) || !c.length) return;
    const d = config.DESIGNS?.[id] || {};
    out.push({
      key: id, id, label: `${id} ${d.name || ''}`.trim(), color: d.color, emph: id === design, styleIndex: i,
      data: c.filter((p) => isNum(p.V)).map((p) => ({ x: p.V, y: isNum(p.sf) ? Math.min(p.sf, cap) : p.sf === Infinity ? cap : null, sf: p.sf })),
    });
  });
  return out;
}

/** Load-path table rows for one windCheck result; flags the governing stage. */
export function loadPathRows(w) {
  if (!w || !Array.isArray(w.stages)) return [];
  const g = w.governing;
  let rows = w.stages.map((st, i) => {
    const items = Array.isArray(st.items) ? st.items : [];
    const itemsText = items.map((it) => (typeof it === 'string' ? it : `${it.name ?? ''}${it.count ? ` ×${it.count}` : ''}`)).join(', ');
    const isGov = (typeof g === 'number' && g === i) ||
      (typeof g === 'string' && (g === st.stage || items.some((it) => it && it.name === g))) ||
      (g && typeof g === 'object' && g.stage === st.stage);
    return {
      stage: st.stage ?? `단계 ${i + 1}`, items: itemsText,
      capKN: isNum(st.capacityN) ? st.capacityN / 1000 : null,
      demKN: isNum(st.demandN) ? st.demandN / 1000 : null,
      sf: st.sf, status: statusOf(st.sf), governing: !!isGov,
    };
  });
  if (!rows.some((r) => r.governing) && rows.length) {
    let k = -1, min = Infinity;
    rows.forEach((r, i) => { if (isNum(r.sf) && r.sf < min) { min = r.sf; k = i; } });
    if (k >= 0) rows = rows.map((r, i) => ({ ...r, governing: i === k }));
  }
  return rows;
}

/** Install steps with cumulative start/end minutes. */
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

/** HUD install progress text. */
export function installProgress({ stepIndex = 0, steps = [], elapsedMin = 0, totalMin } = {}) {
  const n = steps.length;
  const total = isNum(totalMin) && totalMin > 0 ? totalMin : installTimeline(steps).total;
  const i = Math.max(0, Math.min(n - 1, stepIndex));
  return {
    stepText: n ? `설치 ${i + 1}/${n}` : '설치',
    title: steps[i]?.title || '',
    timeText: `${fmtNum(elapsedMin, 0)} / ${fmtNum(total, 0)} 분`,
    pct: total > 0 ? Math.max(0, Math.min(100, (elapsedMin / total) * 100)) : 0,
  };
}

// ================================================================ DOM helpers (only called inside createUI)
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
function lsSet(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* storage unavailable */ } }

const DEFAULT_LEGEND_CSS = 'linear-gradient(90deg, #313695, #4575b4, #74add1, #abd9e9, #fee090, #fdae61, #f46d43, #d73027, #a50026)';

// ================================================================ createUI
export function createUI({ state, set, config, legend, getState } = {}) {
  if (typeof document === 'undefined') throw new Error('createUI() needs a DOM');
  const cfg = config || {};
  const S = () => (typeof getState === 'function' ? getState() : state) || {};
  const DESIGNS = cfg.DESIGNS || {};
  const BASELINE = cfg.BASELINE || { id: '0', name: '무대책 (기존 지붕)', tagline: '차열 구조물 없음', color: '#8b919a', meta: {}, params: {}, callouts: [] };
  const DIDS = cfg.DESIGN_IDS || Object.keys(DESIGNS);
  const ALL = cfg.ALL_IDS || ['0', ...DIDS];
  const SITES = cfg.SITES || [];
  const PRESETS = cfg.WEATHER_PRESETS || [];
  const MARKERS = cfg.WIND_MARKERS || [];
  const getD = (id) => (id === '0' ? BASELINE : DESIGNS[id]) || BASELINE;
  const siteName = (id) => SITES.find((s) => s.id === id)?.name || id || '';

  const viewport = document.getElementById('viewport');
  let hudRoot = document.getElementById('hud');
  if (!hudRoot && viewport) { hudRoot = h('div', { id: 'hud' }); viewport.append(hudRoot); }
  const controlsRoot = document.getElementById('controls');
  const dashRoot = document.getElementById('dashboard');

  // ---- UI-local state
  const results = { thermal: null, wind: null, curves: null };
  let resultsVersion = 0;
  let install = { running: false, stepIndex: -1, steps: [], elapsedMin: 0, totalMin: 0 };
  let assumptions = { thermal: [], wind: [] };
  let clock = { hour: null, sun: null, sample: null };
  let sunTimes = null;
  let legendState = legend || null;
  let busy = false;
  const show = { roof: true, shade: true, indoor: false, air: true };

  // ---- set() wrapper + state → control sync
  const binders = [];
  let paramBinders = [];
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
  function rangeField({ id, label, min, max, step, get, patch, fmt, doc, heavy = false, footMin, footMax, list = binders, onLocal }) {
    const input = h('input', { type: 'range', id, min, max, step });
    const out = h('output', { for: id, id: `${id}-out` });
    let lastOut = null;
    const renderOut = (v) => {
      const f = fmt(v);
      const key = typeof f === 'string' ? f : `${f.text}|${f.alt}`;
      if (key === lastOut) return;   // syncFromState runs after every set(): skip unchanged outputs
      lastOut = key;
      if (typeof f === 'string') out.textContent = f;
      else { out.textContent = f.text; if (f.alt) out.append(h('small', { text: f.alt })); }
    };
    const field = h('div', { class: 'field' },
      h('div', { class: 'field-head' }, h('label', { for: id, text: label }), out),
      input,
      h('div', { class: 'field-foot' },
        h('span', { text: footMin ?? fmtPlain(min) }),
        doc ? h('span', { class: 'doc', text: `문서 ${doc}` }) : null,
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
    list.push((st) => {
      const v = get(st);
      setRangeValue(input, v);
      renderOut(editing(input) ? Number(input.value) : v);
    });
    return { field, input, out };
  }

  function segmented({ name, label, options, get, onPick, list = binders }) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const pairs = options.map((o) => {
      const inp = h('input', { type: 'radio', name, id: o.id, value: String(o.value), class: 'sr' });
      inp.addEventListener('change', () => { if (inp.checked) onPick(o.value); });
      wrap.append(inp, h('label', { for: o.id, title: o.title || null, text: o.label }));
      return [inp, o];
    });
    list.push((st) => { const cur = get(st); for (const [inp, o] of pairs) inp.checked = String(o.value) === String(cur); });
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
    const sum = h('span', { class: 'sec-sum', id: `${id}-sum` });
    det.append(h('summary', null, h('span', { class: 'sec-title', text: title }), sum), h('div', { class: 'sec-body' }, body));
    det.addEventListener('toggle', () => lsSet(key, det.open ? '1' : '0'));
    return { det, sum };
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
    // .hud-row = display:contents wrapper so dt/dd pairs sit in the 2-col grid; .hud-opt rows hide on phones
    const tl = h('div', { class: 'hud-tl hud-panel' },
      h('div', { class: 'hud-clock-row' }, hud.play, hud.clock, hud.date),
      h('dl', { class: 'hud-grid' },
        h('div', { class: 'hud-row' }, h('dt', { text: '태양 방위/고도' }), hud.sun),
        h('div', { class: 'hud-row' }, h('dt', { text: '일사량' }), hud.ghi),
        h('div', { class: 'hud-row hud-opt' }, h('dt', { text: '외기온' }), hud.ta),
        h('div', { class: 'hud-row hud-roof hud-opt' }, h('dt', { text: '지붕 평균' }), hud.roof)));

    const cams = [
      { v: 'iso', label: '전경', title: '전경 (등각 투시)' },
      { v: 'section', label: '단면', title: '도면 단면' },
      { v: 'top', label: '상부', title: '상부 (평면)' },
      { v: 'gap', label: '공기층', title: '공기층 확대' },
      { v: 'yard', label: '단지', title: '단지 (6동 전체)' },
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
      h('div', { class: 'hud-legend-title', text: '지붕 표면온도' }), hud.legendBar,
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

    // 1. view mode (always visible)
    const modeBlock = h('div', { class: 'ctl-block' },
      h('div', { class: 'ctl-label', text: '보기 모드' }),
      segmented({
        name: 'mode', label: '보기 모드', get: (st) => st.mode,
        options: [
          { value: 'single', label: '단일 설계안', id: 'ctl-mode-single' },
          { value: 'compare', label: '6동 비교', id: 'ctl-mode-compare' },
        ],
        onPick: (v) => doSet({ mode: v }),
      }));

    // 2. design list
    const list = h('div', { class: 'design-list', role: 'radiogroup', 'aria-label': '설계안' });
    for (const id of ALL) {
      const d = getD(id);
      const inp = h('input', { type: 'radio', name: 'design', id: `ctl-design-${id}`, value: id, class: 'sr' });
      inp.addEventListener('change', () => { if (inp.checked) doSet({ design: id }); });
      const meta = id === '0'
        ? [h('span', { text: '구조물 없음 · 비교 기준' })]
        : [`${fmtRange(d.meta?.weightKg)} kg`, `${fmtRange(d.meta?.costManwon)} 만원`, `${fmtRange(d.meta?.installMin)} 분`].map((t) => h('span', { text: t }));
      list.append(inp, h('label', { for: inp.id, class: 'design-row', style: { '--c': d.color } },
        h('span', { class: 'dr-id', text: shortName(id) }),
        h('span', { class: 'dr-main' },
          h('span', { class: 'dr-name', text: id === '0' ? '기존 지붕' : d.name }),
          h('span', { class: 'dr-tag', text: id === '0' ? (d.tagline || '차열 구조물 없음') : d.tagline }),
          h('span', { class: 'dr-meta', title: '문서 값: 무게 · 비용 · 설치시간' }, meta)),
        h('span', { class: 'dr-radio', 'aria-hidden': 'true' })));
      binders.push((st) => { inp.checked = st.design === id; });
    }
    const secDesign = section({ id: 'sec-design', title: '설계안 선택', body: [list, h('p', { class: 'table-note', text: '무게·비용·설치시간은 문서 값' })] });
    binders.push((st) => setText(secDesign.sum, st.design === '0' ? '기존 지붕' : `${st.design} ${getD(st.design).name}`));

    // 3. design parameters (rebuilt when the design changes)
    ctl.paramsBody = h('div', { class: 'sec-body-inner', style: { display: 'grid', gap: '12px' } });
    const secParams = section({ id: 'sec-params', title: '설계 변수', body: ctl.paramsBody });
    ctl.paramsSum = secParams.sum;

    // 4. time & place
    const siteSel = selectField({ id: 'ctl-site', label: '지역', options: SITES.map((s) => ({ value: s.id, label: s.name })),
      get: (st) => st.siteId, onPick: (v) => doSet({ siteId: v }) });
    const monthSel = selectField({ id: 'ctl-month', label: '월', options: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` })),
      get: (st) => st.month, onPick: (v) => { const m = Number(v); doSet({ month: m, day: clampDay(m, S().day) }); } });
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
    const secTime = section({ id: 'sec-time', title: '시간 · 장소', body: [
      h('div', { class: 'row-3' }, siteSel, monthSel, dayField),
      hourRow,
      h('div', { class: 'field' }, h('span', { class: 'field-head' }, h('span', { class: 'seg-caption', text: '재생 속도 (시뮬레이션 시간/초)' })), speedSeg),
      ctl.sunTimes,
    ] });
    ctl.timeSum = secTime.sum;

    // 5. weather
    const presetSel = h('select', { id: 'ctl-preset' },
      PRESETS.map((p) => h('option', { value: p.id, text: `${p.name} · ${p.Tmax}/${p.Tmin} °C` })),
      h('option', { value: 'custom', text: '사용자 지정', disabled: true }));
    presetSel.addEventListener('change', () => {
      const p = PRESETS.find((x) => x.id === presetSel.value);
      if (!p) return;
      doSet({ weatherPreset: p.id, month: p.month, day: p.day, weather: { Tmax: p.Tmax, Tmin: p.Tmin, windSpeed: p.windSpeed, clearness: p.clearness } });
      toast(`${p.name} 기상 조건 적용: ${p.month}월 ${p.day}일, ${p.Tmax}/${p.Tmin} °C`);
    });
    binders.push((st) => {
      if (document.activeElement === presetSel) return;
      const p = PRESETS.find((x) => x.id === st.weatherPreset);
      presetSel.value = p && presetMatches(st, p) ? p.id : 'custom';
    });
    const tmax = rangeField({ id: 'ctl-tmax', label: '최고기온 Tmax', min: 20, max: 40, step: 0.5, heavy: true,
      get: (st) => st.weather?.Tmax, fmt: (v) => `${fmtNum(v, 1)} °C`,
      patch: (v) => { const w = S().weather || {}; return { weather: { Tmax: v, Tmin: Math.min(w.Tmin ?? v - 8, v - 1) } }; } });
    const tmin = rangeField({ id: 'ctl-tmin', label: '최저기온 Tmin', min: 10, max: 32, step: 0.5, heavy: true,
      get: (st) => st.weather?.Tmin, fmt: (v) => `${fmtNum(v, 1)} °C`,
      patch: (v) => { const w = S().weather || {}; return { weather: { Tmin: v, Tmax: Math.max(w.Tmax ?? v + 8, v + 1) } }; } });
    const wspd = rangeField({ id: 'ctl-windspeed', label: '평균 풍속 (대류용)', min: 0, max: 8, step: 0.1, heavy: true,
      get: (st) => st.weather?.windSpeed, fmt: (v) => `${fmtNum(v, 1)} m/s`, patch: (v) => ({ weather: { windSpeed: v } }) });
    const clear = rangeField({ id: 'ctl-clearness', label: '청명도 (맑음 = 1)', min: 0.3, max: 1, step: 0.05, heavy: true,
      get: (st) => st.weather?.clearness, fmt: (v) => fmtNum(v, 2), patch: (v) => ({ weather: { clearness: v } }) });
    const secWeather = section({ id: 'sec-weather', title: '기상', body: [
      h('div', { class: 'field' }, h('label', { for: 'ctl-preset', text: '기상 프리셋 (날짜 포함)' }), presetSel),
      tmax.field, tmin.field, wspd.field, clear.field,
    ] });
    binders.push((st) => setText(secWeather.sum, `${fmtNum(st.weather?.Tmax, 1)}/${fmtNum(st.weather?.Tmin, 1)} °C`));

    // 6. existing roof & interior
    const alpha = rangeField({ id: 'ctl-alpha', label: '기존 지붕 일사 흡수율 α', min: 0.3, max: 0.95, step: 0.05, heavy: true,
      get: (st) => st.roof?.alpha, fmt: (v) => fmtNum(v, 2), footMin: '0.3 백색', footMax: '0.95 흑색',
      patch: (v) => ({ roof: { alpha: v } }) });
    const ins = segmented({ name: 'ins', label: '단열 두께', get: (st) => st.roof?.insulationMm,
      options: [0, 50, 75, 100].map((v) => ({ value: v, label: v === 0 ? '없음' : `${v}`, id: `ctl-ins-${v}` })),
      onPick: (v) => doSet({ roof: { insulationMm: Number(v) } }) });
    const ac = toggle({ id: 'ctl-ac', label: '에어컨 가동', get: (st) => st.interior?.acOn, onToggle: (on) => doSet({ interior: { acOn: on } }) });
    const sp = rangeField({ id: 'ctl-setpoint', label: '에어컨 설정온도', min: 20, max: 30, step: 0.5, heavy: true,
      get: (st) => st.interior?.setpoint, fmt: (v) => `${fmtNum(v, 1)} °C`, patch: (v) => ({ interior: { setpoint: v } }) });
    binders.push((st) => {
      const on = !!st.interior?.acOn;
      sp.input.disabled = !on;
      sp.field.classList.toggle('is-disabled', !on);
    });
    const secRoof = section({ id: 'sec-roof', title: '기존 지붕 · 실내', body: [
      alpha.field,
      h('div', { class: 'field' }, h('span', { class: 'field-head' }, h('span', { class: 'seg-caption', text: '지붕 아래 단열 두께 (mm)' })), ins),
      ac, sp.field,
    ] });
    binders.push((st) => setText(secRoof.sum,
      `α ${fmtNum(st.roof?.alpha, 2)} · ${st.roof?.insulationMm ?? DASH}mm · ${st.interior?.acOn ? `AC ${fmtNum(st.interior?.setpoint, 0)}°C` : 'AC 끔'}`));

    // 7. wind check
    const gust = rangeField({ id: 'ctl-gust', label: '순간풍속 (3초 돌풍)', min: 0, max: 50, step: 1, heavy: true,
      get: (st) => st.gust, fmt: (v) => `${fmtNum(v, 0)} m/s`, footMin: ' ', footMax: ' ',
      patch: (v) => ({ gust: v }), onLocal: (v) => paintTicks(v) });
    gust.field.querySelector('.field-foot').remove();
    const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' });
    const tickEls = MARKERS.map((m) => {
      const f = m.V / 50;
      const t = h('span', { class: 'tick', title: m.label, style: { left: `calc(${f} * (100% - 18px) + 9px)` }, text: String(m.V) });
      ticks.append(t);
      return [t, m];
    });
    gust.input.after(ticks);
    ctl.level = h('div', { class: 'level-line', id: 'out-wind-level' });
    function paintTicks(V) {
      for (const [t, m] of tickEls) t.classList.toggle('is-hit', V >= m.V);
      const lv = windLevel(V, MARKERS);
      setText(ctl.level, lv ? `현재 ${fmtNum(V, 0)} m/s ≥ ${lv.label}` : `현재 ${fmtNum(V, 0)} m/s · 기상특보 기준 미만`);
    }
    binders.push((st) => paintTicks(editing(gust.input) ? Number(gust.input.value) : st.gust));
    const dirSel = selectField({ id: 'ctl-winddir', label: '풍향 (바람이 불어오는 방향)',
      options: DIRECTIONS.map((d) => ({ value: d.deg, label: `${d.ko}풍 (${d.en}, ${d.deg}°)` })),
      get: (st) => nearestDirection(st.windDirDeg).deg, onPick: (v) => doSet({ windDirDeg: Number(v) }) });
    ctl.blow = h('button', { type: 'button', class: 'btn btn-sun', id: 'btn-blow', 'aria-pressed': 'false', text: '바람 시뮬레이션' });
    ctl.blow.addEventListener('click', () => {
      const st = S();
      doSet({ actions: { blowSeq: (st.actions?.blowSeq || 0) + 1 }, view: { windSim: true } });
    });
    ctl.windReset = h('button', { type: 'button', class: 'btn', id: 'btn-wind-reset', text: '복구' });
    ctl.windReset.addEventListener('click', () => doSet({ view: { windSim: false } }));
    binders.push((st) => {
      const on = !!st.view?.windSim;
      ctl.blow.setAttribute('aria-pressed', String(on));
      ctl.windReset.disabled = !on;
    });
    ctl.windReadout = h('div', { class: 'readout', id: 'out-wind-sf', 'aria-live': 'polite' });
    const secWind = section({ id: 'sec-wind', title: '풍하중 점검', body: [
      h('div', { class: 'gust-track' }, gust.field), ctl.level, dirSel,
      h('div', { class: 'row' }, ctl.blow, ctl.windReset), ctl.windReadout,
    ] });
    binders.push((st) => setText(secWind.sum, `${fmtNum(st.gust, 0)} m/s · ${nearestDirection(st.windDirDeg).ko}풍`));

    // 8. display
    const VIEW = [
      ['heatmap', '지붕 열지도'], ['flow', '기류'], ['rays', '태양광선'],
      ['labels', '라벨'], ['sunPath', '태양궤적'], ['section', '단면 보기'],
    ];
    const toggles = VIEW.map(([k, label]) => toggle({ id: `ctl-view-${k}`, label, get: (st) => st.view?.[k], onToggle: (on) => doSet({ view: { [k]: on } }) }));
    const explode = rangeField({ id: 'ctl-explode', label: '분해도', min: 0, max: 1, step: 0.05,
      get: (st) => st.view?.explode, fmt: (v) => (v <= 0 ? '조립' : `${Math.round(v * 100)} %`), footMin: '조립', footMax: '분해',
      patch: (v) => ({ view: { explode: v } }) });
    ctl.installBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-install', html: `설치 시뮬레이션 ${svgPlay}` });
    ctl.installBtn.addEventListener('click', triggerInstall);
    const secView = section({ id: 'sec-display', title: '표시', body: [h('div', { class: 'row-2' }, toggles), explode.field, ctl.installBtn] });
    binders.push((st) => {
      const on = VIEW.filter(([k]) => st.view?.[k]).length;
      setText(secView.sum, `${on}/${VIEW.length} 켜짐`);
    });

    // phones: start with the long, less-used groups collapsed (unless the user chose otherwise before)
    const small = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
    if (small) for (const s of [secWeather, secRoof, secView]) if (lsGet(`kroof.ui.sec.${s.det.id}`) === null) s.det.open = false;

    const flow = h('div', { class: 'ctl-flow' }, secDesign.det, secParams.det, secTime.det, secWeather.det, secRoof.det, secWind.det, secView.det);
    controlsRoot.append(modeBlock, flow);
  }

  function triggerInstall() {
    const st = S();
    if (st.design === '0') { toast('기존 지붕은 설치할 구조물이 없습니다. 설계안 A–E 중 하나를 선택하세요.'); return; }
    doSet({ actions: { installSeq: (st.actions?.installSeq || 0) + 1 } });
  }

  let paramsFor = null;
  function rebuildParams(st) {
    const id = st.design;
    paramsFor = id;
    paramBinders = [];
    const body = ctl.paramsBody;
    body.replaceChildren();
    const d = getD(id);
    const entries = Object.entries(d.params || {});
    if (!entries.length) {
      body.append(h('p', { class: 'muted', style: { fontSize: '12.5px' }, text: '기존 지붕은 조정할 설계 변수가 없습니다. 설계안 A–E를 선택하세요.' }));
      return;
    }
    body.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', { class: 'ctl-label', text: `${id} ${d.name}` }),
      h('button', { type: 'button', class: 'btn btn-sm', id: `btn-param-reset-${id}`, text: '기본값',
        onclick: () => {
          const def = typeof cfg.defaultParams === 'function' ? cfg.defaultParams(id) : Object.fromEntries(entries.map(([k, p]) => [k, p.default]));
          doSet({ params: { [id]: def } });
        } })));
    for (const [key, p] of entries) {
      const f = rangeField({
        id: `ctl-param-${id}-${key}`, label: p.label || key, min: p.min, max: p.max, step: p.step, heavy: true,
        get: (s) => s.params?.[id]?.[key] ?? p.default,
        fmt: (v) => paramText(key, p, v),
        footMin: key === 'shade' ? `${Math.round(p.min * 100)}%` : `${fmtPlain(p.min)}`,
        footMax: key === 'shade' ? `${Math.round(p.max * 100)}%` : `${fmtPlain(p.max)} ${p.unit || ''}`.trim(),
        doc: docRange(id, key, p),
        patch: (v) => ({ params: { [id]: { [key]: v } } }),
        list: paramBinders,
      });
      body.append(f.field);
    }
  }

  // ================================================================ dashboard
  const dash = {};
  function head(title, units, id) {
    return h('header', { class: 'dash-head' }, h('h2', { id, text: title }), units ? h('span', { class: 'dash-units', text: units }) : null);
  }
  function buildDashboard() {
    if (!dashRoot) return;
    dashRoot.replaceChildren();

    // a + b
    dash.ov = h('div', { class: 'ov' });
    dash.kpi = h('div', { class: 'kpi-grid dash-data', id: 'kpi-grid' });
    const rowTop = h('div', { class: 'dash-row two' },
      h('section', { class: 'dash-sec', id: 'sec-overview', 'aria-labelledby': 'h-overview' },
        h('header', { class: 'dash-head' }, h('h2', { id: 'h-overview', text: '설계안 개요' }), h('span', { class: 'dash-units' }, h('span', { class: 'src src-doc', text: '문서' }))),
        dash.ov),
      h('section', { class: 'dash-sec', id: 'sec-kpi', 'aria-labelledby': 'h-kpi' },
        head('성능 지표', '선택안 vs 기존 지붕', 'h-kpi'), dash.kpi));

    // c. 24-h temperature
    const TOG = [
      ['roof', '지붕(평균)', '0'], ['indoor', '실내', '9 3 2 3'], ['shade', '차열층', '7 4'], ['air', '외기', '1.5 3.5'],
    ];
    const toggles = h('div', { class: 'series-toggles', role: 'group', 'aria-label': '표시할 온도 계열' },
      TOG.map(([k, label, dashArr]) => {
        const b = h('button', { type: 'button', class: 'stog', id: `tog-series-${k}`, 'aria-pressed': String(!!show[k]),
          html: `<svg viewBox="0 0 22 6" aria-hidden="true"><line x1="1" y1="3" x2="21" y2="3" stroke-dasharray="${dashArr === '0' ? 'none' : dashArr}" stroke-linecap="round"/></svg>${esc(label)}` });
        b.addEventListener('click', () => {
          show[k] = !show[k];
          b.setAttribute('aria-pressed', String(show[k]));
          lsSet('kroof.ui.series', JSON.stringify(show));
          renderTemp(S());
        });
        return b;
      }));
    dash.tempLegend = h('div', { class: 'chart-legend', id: 'temp-legend' });
    dash.tempCanvas = h('canvas', { id: 'chart-temp', role: 'img', 'aria-label': '24시간 지붕·차열층·외기 온도 그래프' });
    dash.tempEmpty = h('div', { class: 'chart-empty', text: '계산 중…' });
    const secTemp = h('section', { class: 'dash-sec', id: 'sec-temp', 'aria-labelledby': 'h-temp' },
      head('24시간 온도', '°C · 0–24 h · 시뮬레이션', 'h-temp'),
      h('div', { class: 'chart-tools' }, toggles, dash.tempLegend),
      h('div', { class: 'chart-box dash-data' }, dash.tempCanvas, dash.tempEmpty));

    // d. comparison table
    dash.cmpBody = h('tbody');
    const simCols = COMPARE_COLUMNS.filter((c) => c.group === 'sim').length;
    const docCols = COMPARE_COLUMNS.length - simCols;
    const thead = h('thead', null,
      h('tr', null, h('th', { class: 'sticky-col', scope: 'col', rowspan: '2' }, '설계안'),
        h('th', { class: 'grp', colspan: String(simCols), text: '시뮬레이션' }),
        h('th', { class: 'grp doc', colspan: String(docCols), text: '문서' })),
      h('tr', null, COMPARE_COLUMNS.map((c, i) => h('th', { scope: 'col', class: c.group === 'doc' && COMPARE_COLUMNS[i - 1]?.group === 'sim' ? 'col-doc-first' : null, id: `th-${c.key}` },
        c.label, c.unit ? h('small', { text: c.unit }) : null))));
    const table = h('table', { class: 'cmp', id: 'compare-table' }, h('caption', { class: 'sr', text: '설계안 6종 비교표' }), thead, dash.cmpBody);
    dash.cmpBody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) doSet({ design: tr.dataset.id });
    });
    dash.cmpBody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) { e.preventDefault(); doSet({ design: tr.dataset.id }); }
    });
    dash.cmpNote = h('p', { class: 'table-note' });
    const secCmp = h('section', { class: 'dash-sec', id: 'sec-compare', 'aria-labelledby': 'h-compare' },
      head('6동 비교표', '행을 누르면 해당 설계안 선택', 'h-compare'),
      h('div', { class: 'table-wrap dash-data' }, table), dash.cmpNote);

    // e. wind
    dash.windLegend = h('div', { class: 'chart-legend', id: 'wind-legend' });
    dash.windCanvas = h('canvas', { id: 'chart-wind', role: 'img', 'aria-label': '설계안별 순간풍속에 따른 안전율 곡선' });
    dash.windEmpty = h('div', { class: 'chart-empty', text: '계산 중…' });
    const markerKey = h('div', { class: 'marker-key', 'aria-label': '기상특보 기준 풍속' }, MARKERS.map((m) => h('span', null, h('b', { text: String(m.V) }), markerShort(m.label))));
    const secWindChart = h('section', { class: 'dash-sec', id: 'sec-windchart', 'aria-labelledby': 'h-wind' },
      head('풍하중 점검 · 안전율 곡선', 'SF vs V · 가정값 기반', 'h-wind'),
      dash.windLegend,
      h('div', { class: 'chart-box wind-box dash-data' }, dash.windCanvas, dash.windEmpty),
      markerKey);
    dash.lpTitle = h('h2', { id: 'h-loadpath', text: '하중 경로' });
    dash.lpSummary = h('div', { class: 'lp-summary', id: 'lp-summary' });
    dash.lpBody = h('tbody');
    dash.lpWrap = h('div', { class: 'table-wrap dash-data' },
      h('table', { class: 'lp', id: 'loadpath-table' },
        h('thead', null, h('tr', null, ['단계', '부재', '용량 kN', '수요 kN', '안전율'].map((t) => h('th', { scope: 'col', text: t })))),
        dash.lpBody));
    dash.lpEmpty = h('p', { class: 'table-note' });
    dash.fuse = h('p', { class: 'fuse-note', hidden: true });
    const secLoad = h('section', { class: 'dash-sec', id: 'sec-loadpath', 'aria-labelledby': 'h-loadpath' },
      h('header', { class: 'dash-head' }, dash.lpTitle, h('span', { class: 'dash-units', id: 'lp-units' })),
      dash.lpSummary, dash.lpWrap, dash.lpEmpty, dash.fuse);
    const rowWind = h('div', { class: 'dash-row wind' }, secWindChart, secLoad);

    // f. install steps
    dash.steps = h('ol', { class: 'steps', id: 'install-steps' });
    dash.stepsNote = h('p', { class: 'table-note' });
    dash.installBtn2 = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'btn-install-2', html: `설치 시뮬레이션 ${svgPlay}` });
    dash.installBtn2.addEventListener('click', triggerInstall);
    const secInstall = h('section', { class: 'dash-sec', id: 'sec-install', 'aria-labelledby': 'h-install' },
      h('header', { class: 'dash-head' }, h('h2', { id: 'h-install', text: '설치 순서' }), h('span', { class: 'dash-units' }, dash.installBtn2)),
      dash.steps, dash.stepsNote);

    // g. assumptions
    dash.assThermal = h('ul');
    dash.assWind = h('ul');
    const assume = h('details', { class: 'assume', id: 'sec-assumptions' },
      h('summary', null, '모델 가정', h('span', { class: 'src', text: '가정값' })),
      h('div', { class: 'assume-body' },
        h('p', { class: 'assume-note', text: '열·풍하중 계수(도장 흡수율, 풍압계수, 부재 용량, 열용량 등)는 이 시뮬레이션을 위한 가정값입니다. 무게·비용·설치시간·부품 종류·공기층 범위는 원문서(Kroof_design_options, pp. 3–7)의 값입니다. 결과는 설계안 간 상대 비교용이며 구조 계산서를 대신하지 않습니다.' }),
        h('div', { class: 'assume-cols' },
          h('div', null, h('h3', { text: '열 모델' }), dash.assThermal),
          h('div', null, h('h3', { text: '풍하중 모델' }), dash.assWind))));

    dashRoot.append(rowTop, secTemp, secCmp, rowWind, secInstall, assume);
    renderAssumptions();
    renderInstallList();
  }

  // ---- a. overview
  let ovSig = null;
  function renderOverview(st) {
    const sig = `${st.design}|${st.roof?.alpha}|${st.roof?.insulationMm}`;
    if (sig === ovSig || !dash.ov) return;
    ovSig = sig;
    const id = st.design, d = getD(id);
    const isBase = id === '0';
    const parts = [];
    parts.push(h('div', { class: 'ov-head' },
      h('span', { class: 'dr-id', style: { '--c': d.color }, text: shortName(id) }),
      h('h3', { text: isBase ? d.name : `${d.name}` })));
    if (d.tagline) parts.push(h('p', { class: 'ov-tagline', text: d.tagline }));
    if (d.analogy) parts.push(h('p', { class: 'ov-analogy' }, h('b', { text: '비유' }), d.analogy));
    const desc = isBase
      ? `차열 구조물이 없는 기존 컨테이너 지붕(1.2T 강판)입니다. 현재 설정: 일사 흡수율 α ${fmtNum(st.roof?.alpha, 2)}, 지붕 아래 단열 ${st.roof?.insulationMm ?? DASH} mm. 모든 설계안의 비교 기준이 됩니다.`
      : d.description;
    if (desc) parts.push(h('p', { class: 'ov-desc', text: desc }));
    if (Array.isArray(d.callouts) && d.callouts.length) {
      parts.push(h('ol', { class: 'ov-callouts', 'aria-label': '부품 구성' },
        d.callouts.map((c) => h('li', null, h('span', { class: 'cn', 'aria-hidden': 'true', text: String(c.n) }),
          h('span', null, h('span', { class: 'sr', text: `${c.n}. ` }), c.text, c.sub ? h('span', { class: 'cs', text: c.sub }) : null)))));
    }
    if (d.gapText) parts.push(h('p', { class: 'ov-gap' }, h('span', { class: 'gap-chip', text: '공기층' }), d.gapText));
    const chips = metaChips(d);
    if (chips.length) {
      parts.push(h('dl', { class: 'ov-meta', 'aria-label': '문서 사양' },
        chips.map((c) => h('div', null, h('dt', { text: c.k }), h('dd', null, c.v, c.u ? h('small', { text: c.u }) : null)))));
    }
    if (id === 'E') parts.push(h('p', { class: 'ov-note' }, h('b', { text: '모델링 주석 ' }), eNote(DESIGNS.E)));
    dash.ov.replaceChildren(...parts);
  }

  // ---- b. KPI tiles
  function renderKpis(st) {
    if (!dash.kpi) return;
    const tiles = computeKpis({ sel: st.design, thermal: results.thermal, wind: results.wind, acOn: !!st.interior?.acOn, gust: st.gust });
    dash.kpi.innerHTML = tiles.map((t) => {
      const val = t.none ? `<span class="v">${DASH}</span>`
        : t.empty ? '<span class="skel" aria-label="계산 중"></span>'
          : `<span class="v">${esc(t.valueText ?? fmtNum(t.value, t.digits))}</span><span class="u">${esc(t.unit)}</span>`;
      const pill = t.status ? `<span class="pill ${t.status}">${STATUS_GLYPH[t.status]} ${STATUS_TEXT[t.status]}</span>` : '';
      const delta = t.empty ? '<span class="muted">계산 중…</span>' : esc(t.deltaText || '');
      return `<div class="kpi" data-key="${t.key}">
        <div class="kpi-top"><span class="kpi-label">${esc(t.label)}</span><span class="src">시뮬레이션</span></div>
        <div class="kpi-value">${val}</div>
        <div class="kpi-delta ${t.tone || ''}">${delta}</div>
        <div class="kpi-sub">${pill}<span>${esc(t.sub || '')}</span></div>
      </div>`;
    }).join('');
  }

  // ---- charts (created lazily)
  let tempChart = null, windChart = null, theme = null;
  function ensureCharts() {
    if (!chartsAvailable()) {
      if (dash.tempEmpty) dash.tempEmpty.textContent = '차트 라이브러리를 불러오지 못했습니다. 비교표의 수치를 참고하세요.';
      if (dash.windEmpty) dash.windEmpty.textContent = '차트 라이브러리를 불러오지 못했습니다. 하중 경로 표를 참고하세요.';
      return false;
    }
    theme = theme || readTheme();
    try {
      if (!tempChart && dash.tempCanvas) tempChart = createTempChart(dash.tempCanvas, theme);
      if (!windChart && dash.windCanvas) windChart = createWindChart(dash.windCanvas, theme);
    } catch (e) { console.error('[ui] chart init failed', e); return false; }
    return true;
  }

  // ---- c. temperature chart
  let tempKey = null;
  function renderTemp(st, force = false) {
    if (!dash.tempLegend) return;
    const key = `${st.mode}|${st.design}|${show.roof}${show.shade}${show.indoor}${show.air}|${resultsVersion}|${chartsAvailable()}`;
    if (!force && key === tempKey && tempChart) return;   // gust/AC/etc. changes don't touch this chart
    tempKey = key;
    const series = buildTempSeries(results.thermal, { mode: st.mode, design: st.design, show }, cfg);
    const has = series.length > 0;
    dash.tempEmpty.hidden = has && chartsAvailable();
    if (has) dash.tempEmpty.textContent = '계산 중…';
    // legend: designs present + line-style key lives in the toggles
    const ids = [...new Set(series.filter((s) => s.id !== 'air').map((s) => s.id))];
    dash.tempLegend.innerHTML = ids.map((id) => {
      const d = getD(id);
      return `<span class="${id === st.design ? 'lg-emph' : ''}"><span class="sw-chip" style="--c:${esc(d.color)}"></span>${esc(id === '0' ? '기존 지붕' : `${id} ${d.name}`)}</span>`;
    }).join('') + (series.some((s) => s.id === 'air') ? '<span><span class="sw-chip" style="--c:var(--ink-3)"></span>외기</span>' : '');
    if (!ensureCharts() || !tempChart) return;
    tempChart.setSeries(series);
    tempChart.setCursor(isNum(clock.hour) ? clock.hour : st.hour, fmtHHMM(isNum(clock.hour) ? clock.hour : st.hour));
  }

  // ---- d. comparison table
  function renderCompare(st) {
    if (!dash.cmpBody) return;
    const model = buildCompareRows(cfg, results, { acOn: !!st.interior?.acOn, gust: st.gust });
    const cols = model.columns;
    dash.cmpBody.innerHTML = model.rows.map((r) => {
      const sel = r.id === st.design;
      const cells = cols.map((c, i) => {
        const cell = r.cells[c.key];
        const cls = [cell.best ? 'best' : '', c.group === 'doc' && cols[i - 1]?.group === 'sim' ? 'col-doc-first' : ''].filter(Boolean).join(' ');
        let inner = esc(cell.text);
        if (c.key === 'sf' && cell.status) inner = `<span class="pill ${cell.status}" title="${STATUS_TEXT[cell.status]}">${STATUS_GLYPH[cell.status]} ${esc(cell.text)}</span>`;
        return `<td${cls ? ` class="${cls}"` : ''}>${inner}</td>`;
      }).join('');
      return `<tr data-id="${esc(r.id)}" tabindex="0" class="${sel ? 'is-sel' : ''}" aria-selected="${sel}">
        <td><span class="id-cell"><span class="sw-chip" style="--c:${esc(r.color)}"></span><b>${esc(shortName(r.id))}</b> ${esc(r.name)}</span></td>${cells}</tr>`;
    }).join('');
    setText(dash.cmpNote, `안전율은 현재 순간풍속 ${fmtPlain(st.gust)} m/s 기준. 강조된 칸은 A–E 중 가장 유리한 값(기존 지붕 제외). 문서 값의 범위는 "25–35"처럼 표기하고 비교는 중간값으로 함.${st.interior?.acOn ? '' : ' 에어컨이 꺼져 있어 냉방·절감 열은 비어 있음.'}`);
  }

  // ---- e. wind chart + load path
  function renderWind(st) {
    if (!dash.windLegend) return;
    const series = buildWindSeries(results.curves, { design: st.design }, cfg);
    const wind = results.wind || {};
    dash.windEmpty.hidden = series.length > 0 && chartsAvailable();
    dash.windLegend.innerHTML = DIDS.map((id) => {
      const d = getD(id), w = wind[id];
      const cv = w?.criticalV;
      const cvText = !w ? '…' : cv === Infinity || (isNum(cv) && cv > 50) ? '> 50' : fmtNum(cv, 0);
      return `<span class="${id === st.design ? 'lg-emph' : ''}"><span class="sw-chip" style="--c:${esc(d.color)}"></span>${esc(id)} · 한계 ${esc(cvText)} m/s</span>`;
    }).join('');
    if (ensureCharts() && windChart) {
      const dots = DIDS.filter((id) => isNum(wind[id]?.criticalV)).map((id) => ({ x: wind[id].criticalV, y: 1, color: getD(id).color, r: id === st.design ? 5.5 : 4 }));
      windChart.setSeries(series, { gust: st.gust, markers: MARKERS, dots });
    }
    renderLoadPath(st);
  }

  function renderLoadPath(st) {
    const id = st.design, d = getD(id);
    setText(dash.lpTitle, id === '0' ? '하중 경로' : `하중 경로 · ${id} ${d.name}`);
    const units = document.getElementById('lp-units');
    if (units) setText(units, `@ ${fmtPlain(st.gust)} m/s · ${windDirLabel(st.windDirDeg)}`);
    const w = results.wind?.[id];
    const showFuse = id === 'D' && d.wind?.fuseNote;
    dash.fuse.hidden = !showFuse;
    if (showFuse) dash.fuse.replaceChildren(h('b', { text: '퓨즈 설계 ' }), d.wind.fuseNote);
    if (id === '0') {
      dash.lpWrap.hidden = true; dash.lpSummary.replaceChildren();
      setText(dash.lpEmpty, '기존 지붕에는 바람에 날아갈 차열 구조물이 없습니다. 설계안을 선택하면 부재별 하중 경로를 보여 줍니다.');
      return;
    }
    if (!w) {
      dash.lpWrap.hidden = true; dash.lpSummary.replaceChildren();
      setText(dash.lpEmpty, '계산 중…');
      return;
    }
    dash.lpWrap.hidden = false;
    setText(dash.lpEmpty, '용량은 부재 수량 × 1개 용량(가정값). 음영 행이 가장 먼저 한계에 도달하는 지배 단계.');
    const status = w.status || statusOf(w.sf);
    dash.lpSummary.innerHTML = [
      ['속도압 q', `${fmtNum(w.q, 0)} Pa`], ['양력', `${fmtNum((w.upliftN ?? NaN) / 1000, 2)} kN`],
      ['항력', `${fmtNum((w.dragN ?? NaN) / 1000, 2)} kN`], ['자중', `${fmtNum((w.weightN ?? NaN) / 1000, 2)} kN`],
    ].map(([k, v]) => `<span><b>${k}</b>${esc(v)}</span>`).join('') +
      (status ? `<span class="pill ${status}">${STATUS_GLYPH[status]} SF ${esc(fmtSF(w.sf))} ${STATUS_TEXT[status]}</span>` : '');
    const rows = loadPathRows(w);
    dash.lpBody.innerHTML = rows.map((r) => `<tr class="${r.governing ? 'is-gov' : ''}">
      <td>${esc(r.stage)}${r.governing ? '<span class="gov-tag">지배</span>' : ''}</td>
      <td>${esc(r.items)}</td>
      <td>${esc(fmtNum(r.capKN, 1))}</td>
      <td>${esc(fmtNum(r.demKN, 2))}</td>
      <td>${r.status ? `<span class="pill ${r.status}">${esc(fmtSF(r.sf))}</span>` : esc(fmtSF(r.sf))}</td></tr>`).join('');
  }

  // ---- f. install steps
  function renderInstallList() {
    if (!dash.steps) return;
    const st = S();
    const { rows, total } = installTimeline(install.steps);
    if (!rows.length) {
      dash.steps.replaceChildren(h('li', null, h('span'), h('span', { class: 'muted', text: st.design === '0' ? '기존 지붕은 설치 단계가 없습니다.' : '설치 단계를 불러오는 중…' }), h('span')));
      setText(dash.stepsNote, '');
      return;
    }
    dash.steps.replaceChildren(...rows.map((r) => {
      const running = install.running && r.i === install.stepIndex;
      const done = install.running ? r.i < install.stepIndex : false;
      return h('li', { class: running ? 'is-running' : done ? 'is-done' : null, 'aria-current': running ? 'step' : null },
        h('span', { class: 'sn', text: String(r.i + 1) }),
        h('span', { class: 'st', text: r.title }),
        h('span', { class: 'sm', text: `${fmtPlain(r.start)}–${fmtPlain(r.end)}분` }));
    }));
    const d = getD(st.design);
    const docTxt = d.meta?.installMin ? ` · 문서 ${fmtRange(d.meta.installMin)}분${d.meta.crew ? ` (${d.meta.crew}인)` : ''}` : '';
    setText(dash.stepsNote, `합계 ${fmtPlain(total)}분 (시뮬레이션 모델)${docTxt}`);
  }

  // ---- g. assumptions
  function renderAssumptions() {
    if (!dash.assThermal) return;
    const fill = (ul, arr) => ul.replaceChildren(...((arr && arr.length) ? arr.map((t) => h('li', { text: t })) : [h('li', { class: 'muted', text: '불러오는 중…' })]));
    fill(dash.assThermal, assumptions.thermal);
    fill(dash.assWind, assumptions.wind);
  }

  // ---- wind readout in the control rail
  function renderWindReadout(st) {
    if (!ctl.windReadout) return;
    const id = st.design;
    if (id === '0') { ctl.windReadout.replaceChildren(h('span', { class: 'muted', text: '기존 지붕: 점검할 구조물 없음' })); return; }
    const w = results.wind?.[id];
    if (!w) { ctl.windReadout.replaceChildren(h('span', { class: 'muted', text: `${id} 안전율 계산 중…` })); return; }
    const status = w.status || statusOf(w.sf);
    const cv = w.criticalV;
    ctl.windReadout.innerHTML = `<span>${esc(id)} 안전율 @ ${esc(fmtPlain(st.gust))} m/s</span>` +
      (status ? `<span class="pill ${status}">${STATUS_GLYPH[status]} ${esc(fmtSF(w.sf))} ${STATUS_TEXT[status]}</span>` : `<b>${esc(fmtSF(w.sf))}</b>`) +
      `<span class="muted">한계 ${esc(cv === Infinity || (isNum(cv) && cv > 50) ? '> 50' : fmtNum(cv, 0))} m/s</span>`;
  }

  // ---- coalesced dashboard render
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
    safe(renderWind);
    safe(renderWindReadout);
  }

  // ---- header strip
  function renderHeader(st) {
    setText(document.getElementById('tb-site'), `${siteName(st.siteId)} · ${fmtDate(st.month, st.day)}`);
    const d = getD(st.design);
    setText(document.getElementById('tb-mode'), st.mode === 'compare'
      ? `6동 비교 · 선택 ${shortName(st.design)}`
      : `단일 · ${st.design === '0' ? '기존 지붕' : `${st.design} ${d.name}`}`);
  }
  function renderStatus() {
    const el = document.getElementById('tb-status');
    if (!el) return;
    const hasAny = !!results.thermal;
    el.replaceChildren(busy || !hasAny
      ? h('span', { class: 'spinner', 'aria-hidden': 'true' })
      : h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: busy || !hasAny ? '계산 중…' : '최신' }));
  }

  // ================================================================ sync
  let dashSig = null;
  function syncFromState() {
    const st = S();
    if (!st) return;
    if (paramsFor !== st.design && ctl.paramsBody) rebuildParams(st);
    for (const b of binders) { try { b(st); } catch (e) { console.error('[ui] bind failed', e); } }
    for (const b of paramBinders) { try { b(st); } catch (e) { console.error('[ui] bind failed', e); } }
    // params section summary
    const d = getD(st.design);
    const ps = Object.entries(d.params || {}).map(([k, p]) => paramText(k, p, st.params?.[st.design]?.[k] ?? p.default).text);
    if (ctl.paramsSum) setText(ctl.paramsSum, ps.length ? ps.join(' · ') : '없음');
    // play buttons + camera
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
    // results-dependent parts that also depend on state
    const sig = [st.mode, st.design, st.interior?.acOn, st.gust, st.windDirDeg, st.roof?.alpha, st.roof?.insulationMm].join('|');
    if (sig !== dashSig) {
      const designChanged = !dashSig || dashSig.split('|')[1] !== st.design;
      dashSig = sig;
      if (designChanged) renderInstallList();
      scheduleDash(0);
    } else if (windChart) {
      windChart.setGust(st.gust);
    }
  }

  function renderTimeSummary(st) {
    const hr = isNum(clock.hour) ? clock.hour : st.hour;
    if (ctl.timeSum) setText(ctl.timeSum, `${siteName(st.siteId)} · ${st.month}/${st.day} ${fmtHHMM(hr)}`);
    if (ctl.sunTimes) {
      const t = sunTimes;
      setText(ctl.sunTimes, t && isNum(t.sunrise) && isNum(t.sunset)
        ? `일출 ${fmtHHMM(t.sunrise)} · 일몰 ${fmtHHMM(t.sunset)}${isNum(t.solarNoon) ? ` · 남중 ${fmtHHMM(t.solarNoon)}` : ''}`
        : '');
    }
  }

  // ================================================================ clock (≈10×/s — keep cheap)
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
    const cur = smp[st.design] || smp['0'] || Object.values(smp)[0];
    const ta = cur && isNum(cur.Ta) ? cur.Ta : s && isNum(s.Ta) ? s.Ta : null;
    if (hud.ta) setText(hud.ta, isNum(ta) ? `${fmtNum(ta, 1)} °C` : DASH);
    if (hud.roof) {
      const b = smp['0'], sel = st.design !== '0' ? smp[st.design] : null;
      const key = `${st.design}|${fmtNum(b?.Troof, 1)}|${fmtNum(sel?.Troof, 1)}`;
      if (hud.roof.dataset.k !== key) {
        hud.roof.dataset.k = key;
        const part = (id, v) => `<span class="hud-sw" style="--c:${esc(getD(id).color)}"></span>${esc(shortName(id))} ${esc(fmtNum(v?.Troof, 1))}°`;
        hud.roof.innerHTML = b ? part('0', b) + (sel ? ` → ${part(st.design, sel)}` : '') : DASH;
      }
    }
    if (tempChart && isNum(hr)) tempChart.setCursor(hr, fmtHHMM(hr));
    renderTimeSummary(st);
  }

  // ================================================================ public API
  function renderResults(res = {}) {
    if (!res || typeof res !== 'object') return;
    if ('thermal' in res) results.thermal = res.thermal || null;
    if ('wind' in res) results.wind = res.wind || null;
    if ('curves' in res) results.curves = res.curves || null;
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
    const sig = `${running}|${install.stepIndex}|${install.steps.map((s) => s.title).join('/')}`;
    if (sig !== install._sig) { install._sig = sig; renderInstallList(); }
    const label = running ? '설치 재생 중…' : '설치 시뮬레이션';
    for (const b of [ctl.installBtn, dash.installBtn2]) if (b) { b.innerHTML = `${esc(label)} ${running ? '' : svgPlay}`; b.setAttribute('aria-busy', String(running)); }
  }

  function setAssumptions(a = {}) {
    assumptions = { thermal: a.thermal || assumptions.thermal || [], wind: a.wind || assumptions.wind || [] };
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

  // theme changes → re-read tokens for the charts (coalesced to one frame)
  let themeQueued = false;
  function onThemeChange() {
    if (themeQueued) return;
    themeQueued = true;
    requestAnimationFrame(() => {
      themeQueued = false;
      theme = readTheme();
      try { tempChart?.applyTheme(theme); windChart?.applyTheme(theme); } catch (e) { console.error('[ui] theme apply failed', e); }
    });
  }
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', onThemeChange); else if (mq.addListener) mq.addListener(onThemeChange);
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }

  // restore series toggles
  try { const saved = JSON.parse(lsGet('kroof.ui.series') || 'null'); if (saved && typeof saved === 'object') for (const k of Object.keys(show)) if (typeof saved[k] === 'boolean') show[k] = saved[k]; } catch { /* ignore */ }

  // ---- build
  buildHud();
  buildControls();
  buildDashboard();
  document.querySelectorAll('.stog').forEach((b) => { const k = b.id.replace('tog-series-', ''); b.setAttribute('aria-pressed', String(!!show[k])); });
  syncFromState();
  renderStatus();

  return {
    renderResults, setClock, setInstall, setAssumptions, setBusy, toast,
    syncFromState, setLegend, setSunTimes,
  };
}
