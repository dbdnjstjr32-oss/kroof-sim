// charts.js — thin Chart.js 4 wrappers used by ui.js (global `Chart` from the UMD build).
// Nothing here touches the DOM or `Chart` at import time (Node tests import ui.js → charts.js).
// Charts are created once; data is swapped in place; overlays (cursor, reference lines) are drawn by a
// small plugin that reads `chart.$kroof`, so moving the cursor only costs a `chart.draw()`.

export function chartsAvailable() {
  return typeof globalThis !== 'undefined' && typeof globalThis.Chart === 'function';
}

// ---------------------------------------------------------------- theme tokens
const TOKENS = {
  ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', line: '--line', lineStrong: '--line-strong',
  surface: '--surface', surface2: '--surface-2', bg: '--bg', sun: '--sun', sunInk: '--sun-ink',
  ok: '--ok', warn: '--warn', fail: '--fail', okSoft: '--ok-soft', warnSoft: '--warn-soft', failSoft: '--fail-soft',
  fontSans: '--font-sans', fontMono: '--font-mono',
};
// Used only if CSS tokens cannot be read (e.g. tests); the page always defines the tokens.
export const THEME_FALLBACK = {
  ink: '#121b24', ink2: '#3f4c59', ink3: '#616d7a', line: '#d3dae1', lineStrong: '#a3aeb9',
  surface: '#f9fafb', surface2: '#e8ecf0', bg: '#edf0f3', sun: '#e07a12', sunInk: '#9a4f06',
  ok: '#1f7a48', warn: '#855f00', fail: '#b93a2f', okSoft: '#daefe2', warnSoft: '#f7ecc4', failSoft: '#f8dedb',
  fontSans: 'system-ui, sans-serif', fontMono: 'ui-monospace, monospace',
};

export function readTheme(el) {
  const out = { ...THEME_FALLBACK };
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return out;
  const cs = getComputedStyle(el || document.documentElement);
  for (const [k, name] of Object.entries(TOKENS)) {
    const v = (cs.getPropertyValue(name) || '').trim();
    if (v) out[k] = v;
  }
  return out;
}

/** '#rrggbb' (or '#rgb') + alpha → 'rgba(...)'; other colour strings are returned unchanged. */
export function withAlpha(color, a) {
  if (typeof color !== 'string' || color[0] !== '#') return color;
  let hex = color.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6) return color;
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function hhmm(h) {
  const m = Math.round(Math.max(0, Math.min(24, h)) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- overlay plugin
// chart.$kroof = { theme, bands:[{y0,y1,color,alpha}], hLines:[{y,color,label,dash}],
//                  marks:[{x,label,title}], dots:[{x,y,color}], vLine:{x,label,color}, cursor:{x,label} }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function chip(ctx, text, cx, top, area, th, { fill, stroke, color }) {
  ctx.font = `600 11px ${th.fontMono}`;
  const w = Math.ceil(ctx.measureText(text).width) + 10, h = 17;
  let x = Math.round(cx - w / 2);
  x = Math.max(area.left, Math.min(area.right - w, x));
  roundRect(ctx, x + 0.5, top + 0.5, w, h, 3);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5.5, top + h / 2 + 1);
}

const overlayPlugin = {
  id: 'kroofOverlay',
  beforeDatasetsDraw(chart) {
    const o = chart.$kroof, area = chart.chartArea;
    if (!o || !area || !o.bands || !o.bands.length) return;
    const { ctx } = chart, y = chart.scales.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
    for (const b of o.bands) {
      const p0 = y.getPixelForValue(b.y0), p1 = y.getPixelForValue(b.y1);
      ctx.globalAlpha = b.alpha ?? 0.6;
      ctx.fillStyle = b.color;
      ctx.fillRect(area.left, Math.min(p0, p1), area.right - area.left, Math.abs(p1 - p0));
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart) {
    const o = chart.$kroof, area = chart.chartArea;
    if (!o || !area) return;
    const th = o.theme || THEME_FALLBACK;
    const { ctx } = chart, xs = chart.scales.x, ys = chart.scales.y;
    const inX = (v) => Number.isFinite(v) && v >= xs.min && v <= xs.max;
    ctx.save();

    // reference marks (e.g. KMA wind warning levels): faint full-height line + number above the plot
    for (const m of o.marks || []) {
      if (!inX(m.x)) continue;
      const px = Math.round(xs.getPixelForValue(m.x)) + 0.5;
      ctx.strokeStyle = th.lineStrong; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `500 10px ${th.fontMono}`; ctx.fillStyle = th.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(m.label, px, area.top - 3);
    }

    // horizontal reference lines (SF 1.0 / 1.5)
    for (const l of o.hLines || []) {
      if (!Number.isFinite(l.y) || l.y < ys.min || l.y > ys.max) continue;
      const py = Math.round(ys.getPixelForValue(l.y)) + 0.5;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.25; ctx.setLineDash(l.dash || []);
      ctx.beginPath(); ctx.moveTo(area.left, py); ctx.lineTo(area.right, py); ctx.stroke();
      ctx.setLineDash([]);
      if (l.label) {
        ctx.font = `600 10.5px ${th.fontSans}`; ctx.fillStyle = l.color; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(l.label, area.right - 4, py - 3);
      }
    }

    // points (critical wind speed of each design on SF = 1)
    for (const d of o.dots || []) {
      if (!inX(d.x) || !Number.isFinite(d.y)) continue;
      const px = xs.getPixelForValue(d.x), py = ys.getPixelForValue(d.y);
      ctx.beginPath(); ctx.arc(px, py, d.r || 4.5, 0, Math.PI * 2);
      ctx.fillStyle = d.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = th.surface; ctx.stroke();
    }

    // one emphasised vertical line (current gust)
    const v = o.vLine;
    if (v && inX(v.x)) {
      const px = Math.round(xs.getPixelForValue(v.x)) + 0.5;
      ctx.strokeStyle = v.color || th.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
      if (v.label) chip(ctx, v.label, px, area.top + 4, area, th, { fill: th.ink, stroke: th.ink, color: th.surface });
    }

    // time cursor
    const c = o.cursor;
    if (c && inX(c.x)) {
      const px = Math.round(xs.getPixelForValue(c.x)) + 0.5;
      ctx.strokeStyle = th.sun; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
      chip(ctx, c.label || hhmm(c.x), px, area.top + 4, area, th, { fill: th.surface, stroke: th.sun, color: th.ink });
    }
    ctx.restore();
  },
};

// ---------------------------------------------------------------- shared option pieces
function applyDefaults(C, th) {
  C.defaults.font.family = th.fontSans;
  C.defaults.font.size = 11;
  C.defaults.color = th.ink2;
}

function axis(th, extra = {}) {
  return {
    type: 'linear',
    grid: { color: th.line, lineWidth: 1, drawTicks: false },
    border: { color: th.lineStrong },
    ticks: { color: th.ink3, padding: 6, font: { family: th.fontMono, size: 10.5 } },
    title: { display: false, color: th.ink3, font: { size: 11 } },
    ...extra,
  };
}

function tooltip(th, extra = {}) {
  return {
    enabled: true,
    backgroundColor: th.surface, titleColor: th.ink, bodyColor: th.ink2,
    borderColor: th.lineStrong, borderWidth: 1, cornerRadius: 3, padding: 8,
    titleFont: { family: th.fontMono, weight: '600', size: 12 },
    bodyFont: { family: th.fontMono, size: 11.5 },
    boxWidth: 10, boxHeight: 2, boxPadding: 4,
    ...extra,
  };
}

function restyleCommon(chart, th) {
  const o = chart.options;
  for (const id of ['x', 'y']) {
    const s = o.scales[id];
    s.grid.color = th.line; s.border.color = th.lineStrong;
    s.ticks.color = th.ink3; s.ticks.font.family = th.fontMono;
    if (s.title) s.title.color = th.ink3;
  }
  const t = o.plugins.tooltip;
  t.backgroundColor = th.surface; t.titleColor = th.ink; t.bodyColor = th.ink2; t.borderColor = th.lineStrong;
  t.titleFont.family = th.fontMono; t.bodyFont.family = th.fontMono;
}

// ---------------------------------------------------------------- 24-h temperature chart
/**
 * series: [{ key, label, color|null (null → theme muted ink), dash:[], width, order, data:[{x,y}] }]
 */
export function createTempChart(canvas, theme) {
  const C = globalThis.Chart;
  let th = theme || THEME_FALLBACK;
  applyDefaults(C, th);
  let lastSeries = [];

  const chart = new C(canvas, {
    type: 'line',
    data: { datasets: [] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      parsing: false, normalized: true, spanGaps: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 6 } },
      elements: { point: { radius: 0, hoverRadius: 3.5, hitRadius: 6 }, line: { tension: 0.25, borderCapStyle: 'round', borderJoinStyle: 'round' } },
      scales: {
        x: axis(th, { min: 0, max: 24, ticks: { color: th.ink3, padding: 6, stepSize: 3, font: { family: th.fontMono, size: 10.5 }, callback: (v) => `${v}시` } }),
        y: axis(th, { grace: '6%', ticks: { color: th.ink3, padding: 6, maxTicksLimit: 7, font: { family: th.fontMono, size: 10.5 }, callback: (v) => `${v}°` } }),
      },
      plugins: {
        legend: { display: false },
        decimation: { enabled: false },
        tooltip: tooltip(th, {
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          filter: (it) => Number.isFinite(it.parsed.y),
          callbacks: {
            title: (items) => (items.length ? hhmm(items[0].parsed.x) : ''),
            label: (ctx) => ` ${ctx.dataset.label}  ${ctx.parsed.y.toFixed(1)} °C`,
          },
        }),
      },
    },
    plugins: [overlayPlugin],
  });
  chart.$kroof = { theme: th, cursor: null };

  function toDatasets(series) {
    return series.map((s) => {
      const color = s.color || th.ink3;
      return {
        label: s.label, data: s.data, _key: s.key,
        borderColor: color, backgroundColor: color,
        borderWidth: s.width || 1.8, borderDash: s.dash || [],
        pointRadius: 0, pointHoverRadius: 3.5, pointHoverBackgroundColor: color,
        pointHoverBorderColor: th.surface, pointHoverBorderWidth: 2,
        order: s.order ?? 1, fill: false,
      };
    });
  }

  let lastCursorPx = null;
  return {
    chart,
    setSeries(series) {
      lastSeries = series || [];
      chart.data.datasets = toDatasets(lastSeries);
      chart.update('none');
      lastCursorPx = null;
    },
    setCursor(hour, label) {
      if (!Number.isFinite(hour)) { if (chart.$kroof.cursor) { chart.$kroof.cursor = null; chart.draw(); } return; }
      chart.$kroof.cursor = { x: hour, label };
      const area = chart.chartArea;
      if (!area || !chart.data.datasets.length) return;
      const px = Math.round(chart.scales.x.getPixelForValue(hour));
      if (px === lastCursorPx) return;   // sub-pixel move: skip the redraw
      lastCursorPx = px;
      chart.draw();
    },
    applyTheme(t) {
      th = t || THEME_FALLBACK;
      applyDefaults(C, th);
      chart.$kroof.theme = th;
      restyleCommon(chart, th);
      chart.data.datasets = toDatasets(lastSeries);
      chart.update('none');
    },
    resize() { chart.resize(); },
    destroy() { chart.destroy(); },
  };
}

// ---------------------------------------------------------------- wind SF-vs-V chart
const POINT_STYLES = ['circle', 'rect', 'triangle', 'rectRot', 'star'];
export const SF_AXIS_MAX = 4;

/**
 * series: [{ key, label, color, emph, styleIndex, data:[{x:V, y:sfClamped, sf}] }]
 * overlay: { gust, markers:[{V,label}], dots:[{x,y,color}] }
 */
export function createWindChart(canvas, theme) {
  const C = globalThis.Chart;
  let th = theme || THEME_FALLBACK;
  applyDefaults(C, th);
  let lastSeries = [];
  let overlay = { gust: null, markers: [], dots: [] };

  const chart = new C(canvas, {
    type: 'line',
    data: { datasets: [] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      parsing: false, normalized: true,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 16, right: 8 } },
      elements: { line: { tension: 0.2, borderCapStyle: 'round' } },
      scales: {
        x: axis(th, {
          min: 0, max: 50,
          ticks: { color: th.ink3, padding: 6, stepSize: 5, font: { family: th.fontMono, size: 10.5 } },
          title: { display: true, text: '순간풍속 V (m/s)', color: th.ink3, font: { size: 11 } },
        }),
        y: axis(th, {
          min: 0, max: SF_AXIS_MAX,
          ticks: { color: th.ink3, padding: 6, stepSize: 0.5, font: { family: th.fontMono, size: 10.5 } },
          title: { display: true, text: '안전율 SF', color: th.ink3, font: { size: 11 } },
        }),
      },
      plugins: {
        legend: { display: false },
        tooltip: tooltip(th, {
          itemSort: (a, b) => (a.raw?.sf ?? 0) - (b.raw?.sf ?? 0),
          callbacks: {
            title: (items) => (items.length ? `V = ${items[0].parsed.x} m/s` : ''),
            label: (ctx) => {
              const sf = ctx.raw?.sf;
              const txt = !Number.isFinite(sf) ? '> 10' : sf > 10 ? '> 10' : sf.toFixed(2);
              return ` ${ctx.dataset.label}  SF ${txt}`;
            },
          },
        }),
      },
    },
    plugins: [overlayPlugin],
  });

  function syncOverlay() {
    chart.$kroof = {
      theme: th,
      bands: [
        { y0: 0, y1: 1, color: th.failSoft, alpha: 0.7 },
        { y0: 1, y1: 1.5, color: th.warnSoft, alpha: 0.7 },
      ],
      hLines: [
        { y: 1.0, color: th.fail, label: 'SF 1.0 파손 한계' },
        { y: 1.5, color: th.warn, label: 'SF 1.5 권장', dash: [5, 4] },
      ],
      marks: (overlay.markers || []).map((m) => ({ x: m.V, label: String(m.V) })),
      dots: overlay.dots || [],
      vLine: Number.isFinite(overlay.gust) ? { x: overlay.gust, label: `순간 ${overlay.gust} m/s`, color: th.ink } : null,
    };
  }

  function toDatasets(series) {
    return series.map((s, i) => {
      const color = s.color || th.ink3;
      const emph = !!s.emph;
      const style = POINT_STYLES[(s.styleIndex ?? i) % POINT_STYLES.length];
      return {
        label: s.label, data: s.data, _key: s.key,
        borderColor: emph ? color : withAlpha(color, 0.85), backgroundColor: color,
        borderWidth: emph ? 3 : 1.6,
        pointStyle: style,
        pointRadius: (ctx) => (ctx.raw && ctx.raw.x % 5 === 0 ? (emph ? 4 : 3) : 0),
        pointBackgroundColor: color, pointBorderColor: th.surface, pointBorderWidth: 1,
        pointHoverRadius: 4.5, order: emph ? 0 : 1, fill: false,
      };
    });
  }

  syncOverlay();
  let lastGustPx = null;
  return {
    chart,
    setSeries(series, ov = {}) {
      lastSeries = series || [];
      overlay = { ...overlay, ...ov };
      syncOverlay();
      chart.data.datasets = toDatasets(lastSeries);
      chart.update('none');
      lastGustPx = null;
    },
    setGust(V) {
      if (overlay.gust === V) return;
      overlay.gust = V;
      syncOverlay();
      const area = chart.chartArea;
      if (!area) return;
      const px = Math.round(chart.scales.x.getPixelForValue(V));
      if (px === lastGustPx) return;
      lastGustPx = px;
      chart.draw();
    },
    applyTheme(t) {
      th = t || THEME_FALLBACK;
      applyDefaults(C, th);
      restyleCommon(chart, th);
      syncOverlay();
      chart.data.datasets = toDatasets(lastSeries);
      chart.update('none');
    },
    resize() { chart.resize(); },
    destroy() { chart.destroy(); },
  };
}
