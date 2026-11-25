// Custom material lock & scenario persistence test suite
import { strict as assert } from 'node:assert';
import {
  SITES, WEATHER_PRESETS, ROOF, INTERIOR, ALL_IDS, INSULATION_OPTIONS, customDefaults, getDesign,
  CP_CANDIDATES, CP_SURFACE_DEFAULT, cpSurfaceOf, isCpAdjusted, cpCandidateOf, cpSurfaceTexts,
} from '../js/config.js';
import { effectiveDesign, cpDesignFor, surfaceGray, applySurfaceAppearance } from '../js/custom.js';
import {
  SHARED_KEYS,
  snapshot,
  sanitize,
  diff,
  deepMerge,
  encodeShare,
  decodeShare,
  shareUrl,
  createSlotStore,
} from '../js/scenario.js';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

// 1. effectiveDesign preserves exact material specifications per option
{
  for (const id of ALL_IDS) {
    const resolved = effectiveDesign(id, { roof: { insulationMm: 50 } });
    const spec = getDesign(id);
    check(resolved.id === spec.id, `${id}: effectiveDesign returns spec design`);
    if (id !== 'A') {
      check(resolved.thermal.alphaTop === spec.thermal.alphaTop, `${id}: alphaTop preserved`);
      check(resolved.thermal.epsBottom === spec.thermal.epsBottom, `${id}: epsBottom preserved`);
    }
  }
  check(surfaceGray(0.11) > surfaceGray(0.70), 'Higher reflectance (lower alpha) yields lighter gray');
  check(surfaceGray(NaN) > 0.04 && surfaceGray(NaN) < 0.96, 'surfaceGray handles NaN safely');
  applySurfaceAppearance(null, null); // no-op safe
  passed++;
}

// 1b. C′ surface-property sensitivity (추가 수정 요청 §2)
{
  const base = getDesign('Cp');
  check(CP_SURFACE_DEFAULT.rhoSolar === 0.75 && CP_SURFACE_DEFAULT.epsBottom === 0.28, 'C′ default surface ρ 0.75 / ε 0.28');
  check(base.thermal.rhoSolar === 0.75 && base.thermal.alphaTop === 0.25 && base.thermal.epsBottom === 0.28 && base.thermal.epsTop === 0.88,
    'C′ base thermal properties unchanged');
  const expect = [['base', 0.75, 0.28], ['c1', 0.85, 0.28], ['c2', 0.89, 0.28], ['c3', 0.75, 0.20], ['c4', 0.75, 0.12], ['c5', 0.85, 0.20], ['c6', 0.89, 0.12]];
  check(CP_CANDIDATES.length === 7 && expect.every(([id, r, e], i) => CP_CANDIDATES[i].id === id && CP_CANDIDATES[i].rhoSolar === r && CP_CANDIDATES[i].epsBottom === e),
    'C′ candidates match the request document (기존 + 후보 1~6)');

  const adj = effectiveDesign('Cp', { cpSurface: { rhoSolar: 0.85, epsBottom: 0.20 } });
  check(adj !== base && adj.thermal.rhoSolar === 0.85 && adj.thermal.alphaTop === 0.15 && adj.thermal.epsBottom === 0.20,
    'adjusted C′: ρ 0.85 → α 0.15 (= 1 − ρ), ε_bottom 0.20');
  const keep = ['mode', 'gap', 'channels', 'thickness', 'k', 'rho', 'cp', 'arealMass', 'arealHeatCap', 'epsTop', 'coverFactor'];
  check(keep.every((k) => adj.thermal[k] === base.thermal[k]), 'adjusted C′ keeps ε_top 0.88, galvalume 0.5T properties and the 140 mm gap');
  check(adj.specs.topFinish === '백색 차열도료 (ρ=0.85, α=0.15)' && adj.specs.botFinish === '무도장 갈바륨 (ε=0.20)', 'adjusted C′ spec texts follow the values');
  check(adj.callouts[0].sub.includes('ρ=0.85') && adj.callouts[0].sub.includes('ε=0.20') && adj.surfaceAdjusted === true, 'adjusted C′ callout 1 follows the values');
  check(base.specs.topFinish === cpSurfaceTexts(CP_SURFACE_DEFAULT).topFinish, 'base C′ spec text generated from the same formatter');
  check(effectiveDesign('Cp', { cpSurface: { ...CP_SURFACE_DEFAULT } }) === base, 'default surface returns the spec design itself');
  for (const id of ['A', 'B', 'C']) check(effectiveDesign(id, { cpSurface: { rhoSolar: 0.9, epsBottom: 0.1 } }) === getDesign(id), `${id}: unaffected by C′ surface controls`);

  const clamped = cpSurfaceOf({ cpSurface: { rhoSolar: 2, epsBottom: -1 } });
  check(clamped.rhoSolar === 0.95 && clamped.epsBottom === 0.05, 'cpSurfaceOf clamps to 0.50–0.95 / 0.05–0.90');
  check(cpSurfaceOf({}).rhoSolar === 0.75 && cpSurfaceOf(null).epsBottom === 0.28, 'cpSurfaceOf falls back to the base values');
  check(cpDesignFor({ rhoSolar: 0.3 }).thermal.rhoSolar === 0.5 && cpDesignFor({ rhoSolar: 0.3 }).thermal.epsBottom === 0.28, 'cpDesignFor clamps and fills missing values');
  check(cpCandidateOf({ rhoSolar: 0.85, epsBottom: 0.28 })?.id === 'c1' && cpCandidateOf({ rhoSolar: 0.8, epsBottom: 0.28 }) === null, 'cpCandidateOf matches candidates only');
  check(!isCpAdjusted({ cpSurface: { ...CP_SURFACE_DEFAULT } }) && isCpAdjusted({ cpSurface: { rhoSolar: 0.89, epsBottom: 0.12 } }), 'isCpAdjusted');
  check(customDefaults().cpSurface.rhoSolar === 0.75 && customDefaults().cpSurface.epsBottom === 0.28, 'customDefaults seeds the C′ surface');
}

// 2. sanitize enforces Tmin <= Tmax, {0,50} insulation snapping, and parameter bounds
{
  const s1 = sanitize({
    mode: 'compare',
    design: 'Cp',
    siteId: 'custom',
    weatherPreset: 'custom',
    month: 2,
    day: 31,
    hour: 25.5,
    weather: { Tmax: 30, Tmin: 34, windSpeed: 99, clearness: 0.1 },
    roof: { insulationMm: 26 },
    interior: { acOn: true, setpoint: 12 },
    customSite: { lat: 90, lon: -200, tz: -20 },
  });
  check(s1.mode === 'compare' && s1.design === 'Cp', 'valid mode/design kept');
  check(s1.day === 29, `Feb day 31 clamped to 29 (got ${s1.day})`);
  check(s1.hour === 24, `hour clamped to 24 (got ${s1.hour})`);
  check(s1.weather.Tmax === 30 && s1.weather.Tmin === 30, `Tmin clamped <= Tmax (${s1.weather.Tmin} <= ${s1.weather.Tmax})`);
  check(s1.weather.windSpeed === 8, 'windSpeed clamped to 8');
  check(s1.weather.clearness === 0.3, 'clearness clamped to 0.3');
  check(s1.roof.insulationMm === 50, `insulation 26 snapped to 50 (got ${s1.roof.insulationMm})`);
  check(s1.interior.acOn === true && s1.interior.setpoint === 20, 'acOn & setpoint sanitized');
  check(s1.customSite.lat === 66 && s1.customSite.lon === -180 && s1.customSite.tz === -12, 'customSite clamped');

  const s0 = sanitize({ roof: { insulationMm: 20 } });
  check(s0.roof.insulationMm === 0 && INSULATION_OPTIONS.includes(0) && INSULATION_OPTIONS.includes(50), 'insulation 20 snaps to 0');

  const sCp = sanitize({ cpSurface: { rhoSolar: 0.99, epsBottom: 0.2, extra: 1 } });
  check(sCp.cpSurface.rhoSolar === 0.95 && sCp.cpSurface.epsBottom === 0.2 && sCp.cpSurface.extra === undefined, 'cpSurface sanitized (clamped, unknown keys dropped)');
  check(sanitize({ cpSurface: { rhoSolar: 'x' } }).cpSurface === undefined, 'non-numeric cpSurface discarded');

  const invalid = sanitize({ mode: 'bogus', design: 'E', siteId: 'mars', weatherPreset: 'hail', interior: { acOn: 'yes' } });
  check(Object.keys(invalid).length === 0, 'invalid enum/type values discarded cleanly');
  check(Object.keys(sanitize('not-an-object')).length === 0, 'non-object sanitize returns {}');
}

// 3. snapshot, diff, deepMerge, and URL share encode/decode
{
  const defaults = {
    mode: 'single',
    design: 'C',
    siteId: SITES[0].id,
    month: 7,
    day: 25,
    hour: 14,
    weatherPreset: WEATHER_PRESETS[0].id,
    weather: { Tmax: 35, Tmin: 26, windSpeed: 1.5, clearness: 0.95 },
    roof: { insulationMm: ROOF.insulationMm },
    interior: { acOn: INTERIOR.acOn, setpoint: INTERIOR.setpoint },
    ...customDefaults(),
  };

  const edited = snapshot(defaults);
  check(SHARED_KEYS.every((k) => edited[k] !== undefined), 'snapshot copies all SHARED_KEYS');
  edited.design = 'Cp';
  edited.roof.insulationMm = 50;
  edited.interior.acOn = true;
  edited.weather.Tmax = 38;

  const d = diff(edited, defaults);
  check(d.design === 'Cp' && d.roof.insulationMm === 50 && d.interior.acOn === true && d.weather.Tmax === 38, 'diff captures only modified leaves');
  check(d.siteId === undefined && d.weather.Tmin === undefined, 'diff omits unchanged leaves');

  check(SHARED_KEYS.includes('cpSurface') && edited.cpSurface?.rhoSolar === 0.75, 'snapshot carries the C′ surface');
  edited.cpSurface.rhoSolar = 0.89;
  edited.cpSurface.epsBottom = 0.12;

  const url = shareUrl('https://example.test/kroof/#old', edited, defaults);
  check(url.startsWith('https://example.test/kroof/#s='), 'shareUrl strips old hash and writes #s=');
  const decoded = decodeShare(url.split('#')[1]);
  check(decoded?.design === 'Cp' && decoded?.roof?.insulationMm === 50 && decoded?.interior?.acOn === true, 'decodeShare restores sanitized changes');
  check(decoded?.cpSurface?.rhoSolar === 0.89 && decoded?.cpSurface?.epsBottom === 0.12, 'share link round-trips the C′ surface (후보 6)');

  const merged = deepMerge(snapshot(defaults), decoded);
  check(merged.design === 'Cp' && merged.roof.insulationMm === 50 && merged.weather.Tmin === 26, 'deepMerge preserves untouched defaults');

  check(decodeShare('') === null && decodeShare('#s=invalid_base64!!!') === null, 'corrupt share hashes return null');
  check(decodeShare(`#s=${'A'.repeat(6500)}`) === null, 'oversized share hash rejected');
  check(encodeShare(defaults, defaults).length > 0, 'empty diff encodes safely');
}

// 4. createSlotStore persistence & cap
{
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
  };
  const slots = createSlotStore(storage, { max: 2 });

  check(slots.save('   ', { design: 'C' }) === false, 'blank slot name rejected');
  check(slots.save(` ${'가'.repeat(30)} `, { design: 'B' }, 100) === true, 'long name trimmed & capped at 24 chars');
  check(slots.list()[0].name === '가'.repeat(24), 'saved name length 24');
  check(slots.save('현장A', { design: 'C', roof: { insulationMm: 50 } }, 200) === true, 'second slot saved');
  check(slots.save('현장A', { design: 'Cp', roof: { insulationMm: 50 } }, 300) === true, 'overwrite preserves count');
  check(slots.list().length === 2 && slots.list()[0].name === '현장A', 'newest sorted first');

  const loaded = slots.load('현장A');
  check(loaded?.design === 'Cp' && loaded?.roof?.insulationMm === 50, 'load returns sanitized state');

  check(slots.save('세번째', { design: 'A' }, 400) === true, 'third save triggers max=2 retention');
  check(slots.list().length === 2 && slots.load('가'.repeat(24)) === null, 'oldest evicted at max');

  slots.remove('현장A');
  check(slots.list().length === 1 && slots.load('현장A') === null, 'remove deletes slot');

  storage.setItem('kroof.scenarios.v2', '{corrupt json');
  check(slots.list().length === 0, 'corrupt JSON handled safely');
}

console.log(failed ? `\n${failed} check(s) failed (${passed} passed)` : `\nall custom/scenario checks passed (${passed})`);
assert.equal(failed, 0);
