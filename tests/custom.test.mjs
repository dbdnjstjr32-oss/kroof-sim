// Tests for the customisation layer: effective design, physics response to user inputs,
// scenario sanitising / share links / slots, economics. Run: node tests/custom.test.mjs
import {
  CUSTOM_SPEC, DESIGNS, DESIGN_IDS, SITES, customDefaults, getDesign, defaultParams, ROOF, INTERIOR,
} from '../js/config.js';
import { effectiveDesign, surfaceGray, applySurfaceAppearance } from '../js/custom.js';
import { snapshot, sanitize, diff, encodeShare, decodeShare, shareUrl, createSlotStore, SHARED_KEYS } from '../js/scenario.js';
import { computeEconomics, formatPayback } from '../js/econ.js';
import { simulateDay } from '../js/physics/thermal.js';
import { windCheck, sfCurve } from '../js/physics/wind.js';
import { dayOfYear } from '../js/physics/sun.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗', msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ±${tol})`);

// A state shaped like main.js's, built from the defaults.
const baseState = () => ({
  mode: 'single', design: 'A', siteId: 'seoul', month: 7, day: 25, hour: 13.5, weatherPreset: 'heatwave',
  weather: { Tmax: 35, Tmin: 26, windSpeed: 1.5, clearness: 0.95 },
  roof: { alpha: ROOF.alpha, eps: ROOF.eps, insulationMm: ROOF.insulationMm },
  interior: { acOn: true, setpoint: 26, internalGainW: 350, wallU: INTERIOR.wallU, windowArea: INTERIOR.windowArea, achInfil: INTERIOR.achInfil, acCOP: INTERIOR.acCOP },
  gust: 26, windDirDeg: 270,
  params: Object.fromEntries(DESIGN_IDS.map((id) => [id, defaultParams(id)])),
  ...customDefaults(),
});

const site = SITES[0];
const run = (id, st, overrides = {}) => simulateDay({
  design: effectiveDesign(id, st), params: st.params[id] || {}, site, dayOfYear: dayOfYear(st.month, st.day),
  weather: st.weather, roof: st.roof, interior: { ...st.interior, ...overrides },
}).summary;

// ---------------------------------------------------------------- effective design
{
  const st = baseState();
  for (const id of ['0', 'A', 'B', 'C', 'D', 'E']) {
    const e = effectiveDesign(id, st);
    if (id === 'B') ok(e === getDesign('B'), 'B at defaults → identical object (foilEps 0.05 keeps its own ε 0.10)');
    else ok(e === getDesign(id), `${id} at defaults → original object`);
  }
  st.surface.topAlpha = 0.9;
  ok(effectiveDesign('A', st).thermal.alphaTop === 0.9, 'α override reaches A');
  ok(getDesign('A').thermal.alphaTop === 0.25, 'original config object not mutated');
  ok(effectiveDesign('D', st) === getDesign('D'), 'D (net) unaffected by surface');
  ok(effectiveDesign('0', st) === getDesign('0'), 'baseline unaffected');
  st.surface.topAlpha = 0.25; st.surface.underside = 'paint';
  near(effectiveDesign('C', st).thermal.epsBottom, 0.9, 1e-9, 'paint underside → ε 0.9');
  st.surface.underside = 'foil'; st.surface.foilEps = 0.10;
  near(effectiveDesign('A', st).thermal.epsBottom, 0.10, 1e-9, 'foilEps 0.10 doubles A (0.05) → 0.10');
  near(effectiveDesign('B', st).thermal.epsBottom, 0.20, 1e-9, 'foilEps 0.10 scales B (0.10) → 0.20');
  near(surfaceGray(0.25), 0.96 - 0.9 * (0.20 / 0.93), 1e-9, 'surfaceGray(0.25)');
  ok(surfaceGray(0.92) < surfaceGray(0.25), 'darker for higher α');
}

// ---------------------------------------------------------------- appearance on plain objects
{
  const fake = () => ({ userData: {}, metalness: 1, roughness: 0.22, color: { v: [0.9, 0.9, 0.9],
    setRGB(r, g, b) { this.v = [r, g, b]; return this; }, clone() { return { ...this, v: [...this.v] }; },
    copy(o) { this.v = [...o.v]; return this; }, multiplyScalar(k) { this.v = this.v.map((x) => x * k); return this; } } });
  const mats = { whiteMatte: fake(), silverFoil: fake() };
  applySurfaceAppearance(mats, { topAlpha: 0.9, underside: 'paint', foilEps: 0.05 });
  ok(mats.whiteMatte.color.v[0] < 0.2, 'black-ish top at α 0.9');
  ok(mats.silverFoil.metalness === 0, 'painted underside is non-metallic');
  applySurfaceAppearance(mats, { topAlpha: 0.25, underside: 'foil', foilEps: 0.03 });
  near(mats.silverFoil.metalness, 1, 1e-9, 'new foil restores full metalness');
  near(mats.silverFoil.roughness, 0.22, 1e-9, 'new foil restores roughness');
  applySurfaceAppearance(mats, { topAlpha: 0.25, underside: 'foil', foilEps: 0.6 });
  ok(mats.silverFoil.roughness > 0.7 && mats.silverFoil.metalness < 0.5, 'aged foil is duller');
  applySurfaceAppearance(null, null);   // must not throw
}

// ---------------------------------------------------------------- physics responds in the right direction
{
  const st = baseState();
  const ref = run('A', st);
  const black = baseState(); black.surface.topAlpha = 0.92;
  ok(run('A', black).TroofMax > ref.TroofMax + 0.5, `black top raises roof peak (${ref.TroofMax.toFixed(1)} → ${run('A', black).TroofMax.toFixed(1)})`);
  ok(run('A', black).TshadeMax > ref.TshadeMax + 15, 'black top makes the shade layer much hotter');
  const paint = baseState(); paint.surface.underside = 'paint';
  ok(run('C', paint).TroofMax > run('C', st).TroofMax + 2, 'painted underside raises roof peak vs foil (C)');
  const aged = baseState(); aged.surface.foilEps = 0.4;
  ok(run('C', aged).TroofMax > run('C', st).TroofMax + 1, 'aged foil raises roof peak (C)');
  near(run('D', black).TroofMax, run('D', st).TroofMax, 1e-9, 'D unaffected by surface settings');

  const wall = baseState(); wall.interior.wallU = 1.5;
  // Free-floating, the room (≈46 °C) is hotter than the outdoor air (≈35 °C), so a leakier wall sheds heat:
  // the AC-off peak moves toward ambient, while with AC on the cooling energy rises.
  ok(run('A', wall, { acOn: false }).TinMax < run('A', st, { acOn: false }).TinMax, 'higher wall U → AC-off room peak moves toward ambient');
  ok(run('A', wall).acKWh > ref.acKWh * 1.25, 'higher wall U → ≥25 % more cooling energy');
  const tight = baseState(); tight.interior.wallU = 0.2;
  ok(run('A', tight).acKWh < ref.acKWh * 0.9, 'better-insulated walls cut cooling energy');
  const cop = baseState(); cop.interior.acCOP = 5;
  ok(run('A', cop).acKWh < ref.acKWh * 0.7, 'COP 5 vs 3 cuts electric use by ≥30 %');
  const win = baseState(); win.interior.windowArea = 7;
  ok(run('A', win).acKWh > ref.acKWh, 'bigger windows → more cooling energy');
  const inf = baseState(); inf.interior.achInfil = 2.5;
  ok(run('A', inf).acKWh > ref.acKWh, 'more infiltration → more cooling energy');
  const gain = baseState(); gain.interior.internalGainW = 1200;
  ok(run('A', gain).acKWh > ref.acKWh, 'more internal gain → more cooling energy');
  const eps = baseState(); eps.roof.eps = 0.3;
  ok(run('0', eps).TroofMax > run('0', st).TroofMax, 'low-emissivity bare roof runs hotter');
  const ins = baseState(); ins.roof.insulationMm = 150;
  ok(run('0', ins).roofHeatKWh < run('0', st).roofHeatKWh, '150 mm insulation lowers roof heat gain');
  const none = baseState(); none.roof.insulationMm = 0;
  ok(run('0', none).roofHeatKWh > run('0', st).roofHeatKWh, 'no insulation raises roof heat gain');
  // defaults are exactly the old behaviour
  near(run('0', st).TroofMax, 70.8, 0.2, 'baseline roof peak unchanged at defaults');
  near(run('A', st).TroofMax, 41.6 - 0.8, 1.2, 'A roof peak at defaults in the validated range');
}

// ---------------------------------------------------------------- wind adjustments
{
  const p = defaultParams('A');
  const a = windCheck(DESIGNS.A, { V: 26, params: p });
  const weak = windCheck(DESIGNS.A, { V: 26, params: p, capScale: 0.5 });
  near(weak.sf, a.sf * 0.5, a.sf * 0.05, 'half fastener capacity → ≈ half SF (weight term keeps it slightly above)');
  ok(weak.sf > a.sf * 0.49 && weak.sf < a.sf, 'SF drops but weight keeps it above exactly half');
  const harsh = windCheck(DESIGNS.A, { V: 26, params: p, cpScale: 2 });
  ok(harsh.upliftN > a.upliftN * 1.99, 'cpScale 2 doubles uplift');
  near(harsh.criticalV, a.criticalV / Math.SQRT2, 0.8, 'cpScale 2 divides critical speed by √2');
  const nan = windCheck(DESIGNS.A, { V: 26, params: p, capScale: NaN, cpScale: NaN });
  near(nan.sf, a.sf, 1e-9, 'NaN scales fall back to 1');
  const curve = sfCurve(DESIGNS.C, defaultParams('C'), 50, 5, { capScale: 0.5 });
  const curve1 = sfCurve(DESIGNS.C, defaultParams('C'), 50, 5);
  ok(curve.every((pt, i) => pt.sf <= curve1[i].sf), 'sfCurve honours capScale');
  const c20 = windCheck(DESIGNS.C, { V: 26, params: { ...defaultParams('C'), strapLC: 20 }, capScale: 0.5 });
  const c20full = windCheck(DESIGNS.C, { V: 26, params: { ...defaultParams('C'), strapLC: 20 } });
  ok(c20.sf < c20full.sf, 'capScale also derates strap capacity taken from strapLC');
}

// ---------------------------------------------------------------- sanitize
{
  const bad = sanitize({
    mode: 'evil', design: 'Z', siteId: 'mars', hour: 99, gust: -5, month: 13.4, day: 40,
    weather: { Tmax: 1000, Tmin: 'hot', windSpeed: NaN, evil: 1 },
    roof: { alpha: 0.01, eps: 2, insulationMm: 1e9 },
    interior: { acOn: 'yes', wallU: 50, acCOP: 0 },
    windAdj: { capScale: 9, cpScale: -1 }, surface: { topAlpha: 5, underside: 'gold', foilEps: 0 },
    econ: { price: 1e6, days: 0, cost: { A: -3, B: 9999, Z: 1 } },
    customSite: { lat: 500, lon: -500, tz: 99 },
    params: { A: { gap: 99, evil: 1 }, D: { shade: 0.1 }, X: { gap: 1 } },
    __proto__: { polluted: 1 }, view: { section: true }, actions: { installSeq: 5 },
  });
  ok(bad.mode === undefined && bad.design === undefined && bad.siteId === undefined, 'enums rejected');
  ok(bad.hour === 24 && bad.gust === 0, 'hour/gust clamped');
  ok(bad.month === 12, 'month clamped + rounded');
  ok(bad.day === 31, 'day clamped');
  ok(bad.weather.Tmax === 40 && bad.weather.Tmin === undefined && bad.weather.windSpeed === undefined && bad.weather.evil === undefined, 'weather cleaned');
  ok(bad.roof.alpha === 0.3 && bad.roof.eps === 0.95 && bad.roof.insulationMm === 150, 'roof clamped');
  ok(bad.interior.acOn === undefined && bad.interior.wallU === 2 && bad.interior.acCOP === 2, 'interior clamped, non-boolean acOn dropped');
  ok(bad.windAdj.capScale === 1.5 && bad.windAdj.cpScale === 0.5, 'windAdj clamped');
  ok(bad.surface.topAlpha === 0.95 && bad.surface.underside === undefined && bad.surface.foilEps === 0.03, 'surface clamped');
  ok(bad.econ.price === 400 && bad.econ.days === 10 && bad.econ.cost.A === 0 && bad.econ.cost.B === 500 && bad.econ.cost.Z === undefined, 'econ clamped');
  ok(bad.customSite.lat === 66 && bad.customSite.lon === -180 && bad.customSite.tz === 14, 'custom site clamped');
  ok(bad.params.A.gap === DESIGNS.A.params.gap.max && bad.params.A.evil === undefined && bad.params.D.shade === DESIGNS.D.params.shade.min && bad.params.X === undefined, 'design params clamped to their own ranges');
  ok(bad.view === undefined && bad.actions === undefined && ({}).polluted === undefined, 'view/actions dropped, no prototype pollution');
  ok(JSON.stringify(sanitize(null)) === '{}' && JSON.stringify(sanitize('x')) === '{}' && JSON.stringify(sanitize([1])) === '{}', 'non-objects → {}');
  const feb = sanitize({ month: 2, day: 31 });
  ok(feb.month === 2 && feb.day === 29, 'day limited to month length');
  const good = sanitize(snapshot(baseState()));
  const want = snapshot(baseState());
  ok(JSON.stringify(diff(good, want)) === '{}' && JSON.stringify(diff(want, good)) === '{}', 'a valid snapshot passes through sanitize unchanged');
}

// ---------------------------------------------------------------- snapshot / diff / share
{
  const st = baseState(); st.playing = true; st.view = { section: true }; st.actions = { installSeq: 3 }; st.camera = 'top'; st.ui = { quality: 'low' };
  const snap = snapshot(st);
  ok(Object.keys(snap).every((k) => SHARED_KEYS.includes(k)), 'snapshot keys ⊆ SHARED_KEYS');
  ok(!('playing' in snap) && !('view' in snap) && !('actions' in snap) && !('camera' in snap) && !('ui' in snap), 'view/animation/ui state not shared');
  snap.params.A.gap = 0.55;           // mutating the snapshot must not touch state
  ok(st.params.A.gap !== 0.55, 'snapshot is a deep copy');

  const defaults = snapshot(baseState());
  ok(JSON.stringify(diff(defaults, defaults)) === '{}', 'diff of identical = {}');
  const changed = snapshot(baseState()); changed.surface.topAlpha = 0.9; changed.econ.cost.B = 99; changed.siteId = 'busan';
  const d = diff(changed, defaults);
  ok(JSON.stringify(d) === JSON.stringify({ siteId: 'busan', surface: { topAlpha: 0.9 }, econ: { cost: { B: 99 } } }), `diff keeps only changes: ${JSON.stringify(d)}`);

  const code = encodeShare(changed, defaults);
  ok(/^[A-Za-z0-9_-]+$/.test(code), 'share code is URL-safe');
  ok(code.length < 120, `share code is short (${code.length} chars)`);
  const back = decodeShare(`#s=${code}`);
  ok(JSON.stringify(back) === JSON.stringify(d), 'share round-trip');
  const url = shareUrl('https://x.github.io/kroof-sim/#old=1', changed, defaults);
  ok(url.startsWith('https://x.github.io/kroof-sim/#s=') && !url.includes('old=1'), 'shareUrl replaces any existing hash');
  ok(decodeShare(new URL(url).hash).surface.topAlpha === 0.9, 'decode from a real URL hash');
  ok(decodeShare('') === null && decodeShare('#') === null && decodeShare('#s=') === null, 'empty hashes → null');
  ok(decodeShare('#s=%%%') === null && decodeShare('#s=AAAA') === null && decodeShare('#s=' + 'A'.repeat(7000)) === null, 'garbage / oversized → null');
  const evil = btoa(JSON.stringify({ surface: { topAlpha: 999 }, gust: -1e9, __proto__: { x: 1 } })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const clean = decodeShare('#s=' + evil);
  ok(clean.surface.topAlpha === 0.95 && clean.gust === 0, 'hand-edited link values are clamped');
  ok(decodeShare('#other=1&s=' + code) !== null, 'finds s= among other hash params');
}

// ---------------------------------------------------------------- slot store
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const store = createSlotStore(storage, { max: 3 });
  const snap = snapshot(baseState());
  ok(store.list().length === 0, 'empty at start');
  ok(store.save('  폭염 점검  ', snap, 1000) === true, 'save returns true');
  ok(store.list()[0].name === '폭염 점검', 'name trimmed, Korean kept');
  ok(store.save('', snap) === false && store.save('   ', snap) === false, 'blank name rejected');
  store.save('폭염 점검', { ...snap, gust: 40 }, 2000);
  ok(store.list().length === 1 && store.load('폭염 점검').gust === 40, 'same name replaces');
  store.save('b', snap, 3000); store.save('c', snap, 4000); store.save('d', snap, 5000);
  ok(store.list().length === 3 && store.list()[0].name === 'd', 'capped at max, newest first');
  ok(store.load('폭염 점검') === null, 'oldest slot evicted');
  store.remove('d');
  ok(store.list().map((s) => s.name).join() === 'c,b', 'remove works');
  ok(store.load('nope') === null, 'unknown slot → null');
  mem.set('kroof.scenarios', '{not json'); ok(store.list().length === 0, 'corrupt storage → empty list, no throw');
  mem.set('kroof.scenarios', JSON.stringify([{ name: 'x', savedAt: 1, data: { gust: 9999, surface: { topAlpha: -5 } } }]));
  ok(store.load('x').gust === 50 && store.load('x').surface.topAlpha === 0.1, 'stored data is sanitised on load');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s2 = createSlotStore(broken);
  ok(s2.list().length === 0 && s2.save('a', snap) === false, 'unavailable storage → graceful');
  ok(createSlotStore(undefined).list().length === 0, 'no storage object → graceful');
}

// ---------------------------------------------------------------- economics
{
  const st = baseState();
  const thermal = {};
  for (const id of ['0', ...DESIGN_IDS]) thermal[id] = { summary: { ...run(id, st), acKWhRef: run(id, st).acKWh } };
  const e = computeEconomics({ results: { thermal }, state: st, designIds: DESIGN_IDS });
  ok(e.rows.length === 5 && e.baseline.acKWh > 0, 'rows for A–E and a baseline');
  const a = e.rows.find((r) => r.id === 'A');
  near(a.saveKWhDay, thermal['0'].summary.acKWh - thermal.A.summary.acKWh, 1e-9, 'daily saving = baseline − design');
  near(a.saveWonYear, a.saveKWhDay * 90 * 170, 1e-6, 'won/yr = kWh/day × days × price');
  near(a.paybackYears, 30 * 10000 / a.saveWonYear, 1e-9, 'payback = cost / saving');
  ok(e.rows.every((r) => r.status === 'ok' && r.paybackYears > 0 && r.roofDrop > 20), 'every design saves something and cools the roof');
  const cheap = baseState(); cheap.econ.cost.A = 0;
  ok(computeEconomics({ results: { thermal }, state: cheap, designIds: ['A'] }).rows[0].paybackYears === 0, 'zero cost → zero payback');
  const dear = baseState(); dear.econ.price = 340; dear.econ.days = 180;
  ok(computeEconomics({ results: { thermal }, state: dear, designIds: ['A'] }).rows[0].paybackYears < a.paybackYears / 3.5, 'double price × double days → < ¼ the payback');
  const none = computeEconomics({ results: { thermal: { 0: thermal['0'], A: thermal['0'] } }, state: st, designIds: ['A'] }).rows[0];
  ok(none.status === 'none' && none.paybackYears === null, 'no saving → status none, payback null');
  const pend = computeEconomics({ results: { thermal: {} }, state: st, designIds: ['A'] });
  ok(pend.rows[0].status === 'pending' && pend.baseline.acKWh === null, 'no results → pending');
  ok(computeEconomics({ results: null, state: null, designIds: ['A'] }).rows[0].status === 'pending', 'null inputs → pending, no throw');
  const acOff = { ...thermal, A: { summary: { ...thermal.A.summary, acKWh: 0, acKWhRef: thermal.A.summary.acKWh } }, 0: { summary: { ...thermal['0'].summary, acKWh: 0, acKWhRef: thermal['0'].summary.acKWh } } };
  near(computeEconomics({ results: { thermal: acOff }, state: st, designIds: ['A'] }).rows[0].saveKWhDay, a.saveKWhDay, 1e-9, 'uses acKWhRef so the AC-off toggle does not zero the economics');
  ok(formatPayback(null) === '—' && formatPayback(0.4) === '0.4년' && formatPayback(8.44) === '8.4년' && formatPayback(27.3) === '27년' && formatPayback(250) === '99년 초과', 'formatPayback');
  console.log('   payback (defaults):', e.rows.map((r) => `${r.id} ${formatPayback(r.paybackYears)} (연 ${(r.saveWonYear / 1e4).toFixed(1)}만원)`).join(' · '));
}

// ---------------------------------------------------------------- spec sanity
{
  for (const [path, sp] of Object.entries(CUSTOM_SPEC)) {
    ok(sp.min < sp.max && sp.default >= sp.min && sp.default <= sp.max && sp.step > 0, `spec ${path}: min<max, default in range`);
  }
  const d = customDefaults();
  ok(DESIGN_IDS.every((id) => d.econ.cost[id] >= DESIGNS[id].meta.costManwon[0] && d.econ.cost[id] <= DESIGNS[id].meta.costManwon[1]), 'default costs lie inside the document ranges');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
