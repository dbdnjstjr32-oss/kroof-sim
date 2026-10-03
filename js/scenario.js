// scenario.js — snapshot / validate / share / save the user's settings. Pure JS (no DOM, no three.js).
//
// A "snapshot" is the subset of app state worth sharing (inputs, not view toggles or animation triggers).
// Everything that comes from outside (a pasted link, localStorage) goes through sanitize(), which drops
// unknown keys and clamps every number to CUSTOM_SPEC / the design's own parameter ranges, so a hand-edited
// link can never push the physics outside the ranges the sliders allow.
import { CUSTOM_SPEC, DESIGNS, DESIGN_IDS, ALL_IDS, SITES, WEATHER_PRESETS, UNDERSIDE_OPTIONS } from './config.js';

export const SHARED_KEYS = [
  'mode', 'design', 'siteId', 'customSite', 'month', 'day', 'hour', 'weatherPreset', 'weather', 'roof', 'interior',
  'gust', 'windDirDeg', 'windAdj', 'params', 'surface', 'econ',
];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Deep-pick the shareable keys out of the full app state. */
export function snapshot(state) {
  const out = {};
  for (const k of SHARED_KEYS) if (state[k] !== undefined) out[k] = clone(state[k]);
  return out;
}

function clampSpec(path, v) {
  const sp = CUSTOM_SPEC[path];
  if (!sp || !isNum(v)) return undefined;
  return Math.min(sp.max, Math.max(sp.min, v));
}

/**
 * Validate an untrusted partial snapshot. Returns only well-formed values (possibly {}), never throws.
 * Integers (month/day) are rounded; day is limited to the month length.
 */
export function sanitize(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  const put = (path, value) => {
    if (value === undefined) return;
    const keys = path.split('.');
    let o = out;
    for (let i = 0; i < keys.length - 1; i++) o = (o[keys[i]] ??= {});
    o[keys[keys.length - 1]] = value;
  };
  const num = (path, v) => put(path, clampSpec(path, v));
  const group = (name, keys) => { if (isObj(raw[name])) for (const k of keys) num(`${name}.${k}`, raw[name][k]); };

  if (raw.mode === 'single' || raw.mode === 'compare') out.mode = raw.mode;
  if (ALL_IDS.includes(raw.design)) out.design = raw.design;
  if (raw.siteId === 'custom' || SITES.some((s) => s.id === raw.siteId)) out.siteId = raw.siteId;
  if (raw.weatherPreset === 'custom' || WEATHER_PRESETS.some((p) => p.id === raw.weatherPreset)) out.weatherPreset = raw.weatherPreset;
  for (const k of ['hour', 'gust', 'windDirDeg']) num(k, raw[k]);
  if (isNum(raw.month)) put('month', Math.round(clampSpec('month', raw.month)));
  if (isNum(raw.day)) {
    const m = isNum(raw.month) ? Math.round(clampSpec('month', raw.month)) : null;
    const maxDay = m ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] : 31;
    put('day', Math.min(maxDay, Math.round(clampSpec('day', raw.day))));
  }
  group('weather', ['Tmax', 'Tmin', 'windSpeed', 'clearness']);
  group('roof', ['alpha', 'eps', 'insulationMm']);
  group('interior', ['setpoint', 'internalGainW', 'wallU', 'windowArea', 'achInfil', 'acCOP']);
  if (isObj(raw.interior) && typeof raw.interior.acOn === 'boolean') put('interior.acOn', raw.interior.acOn);
  group('windAdj', ['capScale', 'cpScale']);
  group('customSite', ['lat', 'lon', 'tz']);
  group('surface', ['topAlpha', 'foilEps']);
  if (isObj(raw.surface) && UNDERSIDE_OPTIONS.includes(raw.surface.underside)) put('surface.underside', raw.surface.underside);
  group('econ', ['price', 'days']);
  if (isObj(raw.econ?.cost)) for (const id of DESIGN_IDS) num(`econ.cost.${id}`, raw.econ.cost[id]);
  if (isObj(raw.params)) {
    for (const id of DESIGN_IDS) {
      const src = raw.params[id];
      if (!isObj(src)) continue;
      for (const [key, sp] of Object.entries(DESIGNS[id].params || {})) {
        if (isNum(src[key])) put(`params.${id}.${key}`, Math.min(sp.max, Math.max(sp.min, src[key])));
      }
    }
  }
  return out;
}

/** Nested diff: only the leaves of `a` that differ from `b`. Empty objects are dropped. */
export function diff(a, b) {
  if (!isObj(a)) return a;
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (isObj(v)) { const d = diff(v, isObj(b?.[k]) ? b[k] : {}); if (Object.keys(d).length) out[k] = d; }
    else if (v !== b?.[k]) out[k] = v;
  }
  return out;
}

export function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(dst[k])) deepMerge(dst[k], v); else dst[k] = v;
  }
  return dst;
}

// ---- share links: '#s=<base64url(JSON diff from defaults)>'
const toB64Url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function encodeShare(snap, defaults) {
  return toB64Url(JSON.stringify(diff(snap, defaults || {})));
}

/** Returns a sanitised partial snapshot, or null if the hash holds no (valid) scenario. */
export function decodeShare(hashOrCode) {
  try {
    const m = /(?:^#?|[#&])s=([A-Za-z0-9_-]+)/.exec(String(hashOrCode || ''));
    const code = m ? m[1] : null;
    if (!code || code.length > 6000) return null;
    const clean = sanitize(JSON.parse(fromB64Url(code)));
    return Object.keys(clean).length ? clean : null;
  } catch { return null; }
}

export function shareUrl(baseUrl, snap, defaults) {
  const base = String(baseUrl || '').split('#')[0];
  return `${base}#s=${encodeShare(snap, defaults)}`;
}

// ---- named slots in a Storage-like object ({getItem,setItem}); failures are swallowed (private mode etc.)
export function createSlotStore(storage, { key = 'kroof.scenarios', max = 12 } = {}) {
  const read = () => {
    try {
      const v = JSON.parse(storage?.getItem(key) || '[]');
      return Array.isArray(v) ? v.filter((s) => s && typeof s.name === 'string' && isObj(s.data)) : [];
    } catch { return []; }
  };
  const write = (list) => { try { storage?.setItem(key, JSON.stringify(list)); return true; } catch { return false; } };
  const cleanName = (n) => String(n ?? '').trim().slice(0, 24);
  return {
    list: () => read().map(({ name, savedAt }) => ({ name, savedAt })).sort((a, b) => b.savedAt - a.savedAt),
    save(name, snap, now = Date.now()) {
      const n = cleanName(name);
      if (!n) return false;
      const list = read().filter((s) => s.name !== n);
      list.push({ name: n, savedAt: now, data: snap });
      list.sort((a, b) => b.savedAt - a.savedAt);
      return write(list.slice(0, max));
    },
    load(name) {
      const s = read().find((x) => x.name === cleanName(name));
      if (!s) return null;
      const clean = sanitize(s.data);
      return Object.keys(clean).length ? clean : null;
    },
    remove(name) { write(read().filter((s) => s.name !== cleanName(name))); },
  };
}
