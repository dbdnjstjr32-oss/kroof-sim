// charts.js — Chart.js 4 wrapper for the 24-hour temperature comparison chart.
// Nothing here touches the DOM or `Chart` at import time.
export function chartsAvailable() {
  return typeof globalThis !== 'undefined' && typeof globalThis.Chart === 'function';
}

const TOKENS = {
  ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', line: '--line', lineStrong: '--line-strong',
  surface: '--surface', surface2: '--surface-2', bg: '--bg', sun: '--sun', sunInk: '--sun-ink',
  ok: '--ok', warn: '--warn', fail: '--fail',
  fontSans: '--font-sans', fontMono: '--font-mono',
};

export const THEME_FALLBACK = {
  ink: '#121b24', ink2: '#3f4c59', ink3: '#616d7a', line: '#d3dae1', lineStrong: '#a3aeb9',
  surface: '#f9fafb', surface2: '#e8ecf0', bg: '#edf0f3', sun: '#e07a12', sunInk: '#9a4f06',
  ok: '#1f7a48', warn: '#855f00', fail: '#b93a2f',
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
  afterDatasetsDraw(chart) {
    const o = chart.$kroof, area = chart.chartArea;
    if (!o || !area) return;
    const th = o.theme || THEME_FALLBACK;
    const { ctx } = chart, xs = chart.scales.x;
    const inX = (v) => Number.isFinite(v) && v >= xs.min && v <= xs.max;
    ctx.save();
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
      elements: { point: { radius: 0, hoverRadius: 3.5, hitRadius: 8 }, line: { tension: 0.25, borderCapStyle: 'round', borderJoinStyle: 'round' } },
      scales: {
        x: axis(th, {
          min: 0, max: 24,
          ticks: { color: th.ink3, padding: 6, stepSize: 3, font: { family: th.fontMono, size: 10.5 }, callback: (v) => `${String(v).padStart(2, '0')}:00` },
        }),
        y: axis(th, {
          grace: '6%',
          ticks: { color: th.ink3, padding: 6, maxTicksLimit: 8, font: { family: th.fontMono, size: 10.5 }, callback: (v) => `${v}°C` },
        }),
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
        borderWidth: s.width || 2.0, borderDash: s.dash || [],
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
      if (px === lastCursorPx) return;
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
