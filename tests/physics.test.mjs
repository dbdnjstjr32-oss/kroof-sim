// physics.test.mjs — node tests/physics.test.mjs   (exit code ≠ 0 on any failure)
// Checks sun geometry, irradiance, the transient roof/room model against sanity targets, gap
// sensitivity, wind load-path checks and run time. Pure Node, no three.js.
import { performance } from 'node:perf_hooks';
import {
  dayOfYear, solarPosition, clearSkyIrradiance, sunTimes, ambientTemperature, skyTemperature, sunPath,
} from '../js/physics/sun.js';
import { simulateDay, sampleAt, THERMAL_ASSUMPTIONS, viewFactorParallel } from '../js/physics/thermal.js';
import { velocityPressure, windCheck, sfCurve, WIND_ASSUMPTIONS } from '../js/physics/wind.js';
import { SITES, DESIGNS, DESIGN_IDS, ALL_IDS, BASELINE, INTERIOR, getDesign, defaultParams } from '../js/config.js';

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) passes++;
  else { fails++; console.log(`  ✗ ${msg}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const pad = (s, n) => String(s).padStart(n);
const section = (t) => console.log(`\n── ${t}`);

const seoul = SITES.find((s) => s.id === 'seoul');
const site = { lat: seoul.lat, lon: seoul.lon, tz: seoul.tz };
const JUL25 = dayOfYear(7, 25), JUN21 = dayOfYear(6, 21);

// ------------------------------------------------------------------ 1. solar geometry
section('solar geometry (Seoul)');
ok(JUL25 === 206 && JUN21 === 172 && dayOfYear(1, 1) === 1 && dayOfYear(12, 31) === 365, 'dayOfYear');
{
  const tS = sunTimes({ dayOfYear: JUN21, ...site });
  const pS = solarPosition({ dayOfYear: JUN21, hour: tS.solarNoon, ...site });
  console.log(`  solstice: noon ${hhmm(tS.solarNoon)} elev ${pS.elevation.toFixed(2)}° az ${pS.azimuth.toFixed(2)}° sunrise ${hhmm(tS.sunrise)} sunset ${hhmm(tS.sunset)}`);
  ok(near(pS.elevation, 75.9, 1), `solstice noon elevation ${pS.elevation.toFixed(2)} ≈ 75.9 ± 1`);
  ok(near(pS.azimuth, 180, 1), `solstice noon azimuth ${pS.azimuth.toFixed(2)} ≈ 180`);
  ok(tS.sunrise > 5.1 && tS.sunrise < 5.35, `solstice sunrise ${hhmm(tS.sunrise)} ≈ 05:1x`);

  const t = sunTimes({ dayOfYear: JUL25, ...site });
  const p = solarPosition({ dayOfYear: JUL25, hour: t.solarNoon, ...site });
  console.log(`  Jul 25:   noon ${hhmm(t.solarNoon)} elev ${p.elevation.toFixed(2)}° az ${p.azimuth.toFixed(2)}° sunrise ${hhmm(t.sunrise)} sunset ${hhmm(t.sunset)} decl ${p.declination.toFixed(2)}° EoT ${p.eqTime.toFixed(2)} min`);
  ok(t.solarNoon >= 12.5 && t.solarNoon <= 12 + 40 / 60, `late-July solar noon ${hhmm(t.solarNoon)} within 12:30–12:40 KST`);
  ok(near(p.azimuth, 180, 1), `azimuth at solar noon ${p.azimuth.toFixed(2)} ≈ 180`);
  ok(t.sunrise >= 5 + 10 / 60 && t.sunrise < 5 + 40 / 60, `late-July sunrise ${hhmm(t.sunrise)} within 05:10–05:39`);
  ok(t.sunset > 19.5 && t.sunset < 20, `late-July sunset ${hhmm(t.sunset)} ≈ 19:4x`);
  // dir convention: (cosEl·sinAz, sinEl, −cosEl·cosAz), unit length; morning sun in the east (+x)
  const m = solarPosition({ dayOfYear: JUL25, hour: 8, ...site });
  const e = m.elevation * Math.PI / 180, a = m.azimuth * Math.PI / 180;
  ok(near(m.dir.x, Math.cos(e) * Math.sin(a), 1e-9) && near(m.dir.y, Math.sin(e), 1e-9) && near(m.dir.z, -Math.cos(e) * Math.cos(a), 1e-9), 'dir formula');
  ok(near(Math.hypot(m.dir.x, m.dir.y, m.dir.z), 1, 1e-9) && m.dir.x > 0.5, 'dir unit length, morning sun toward +x (East)');
  ok(p.dir.z > 0, 'noon sun toward +z (South)');
  const e2 = solarPosition({ dayOfYear: JUL25, hour: 17, ...site });
  ok(e2.azimuth > 250 && e2.azimuth < 290 && e2.dir.x < 0, `17:00 sun in the west (az ${e2.azimuth.toFixed(1)})`);
  const path = sunPath({ dayOfYear: JUL25, ...site, stepMin: 10 });
  ok(path.length > 80 && path.every((q, i) => i === 0 || q.hour > path[i - 1].hour) && path.every((q) => q.elevation > -1),
    `sunPath ${path.length} points, increasing hours, above horizon`);
  ok(near(path[0].hour, t.sunrise, 1e-6) && near(path[path.length - 1].hour, t.sunset, 1e-6), 'sunPath starts at sunrise, ends at sunset');
}

// ------------------------------------------------------------------ 2. irradiance & weather
section('irradiance / air & sky temperature');
{
  let peak = 0, peakH = 0, peak95 = 0;
  for (let h = 4; h <= 21; h += 0.05) {
    const p = solarPosition({ dayOfYear: JUL25, hour: h, ...site });
    const i = clearSkyIrradiance({ elevationDeg: p.elevation, dayOfYear: JUL25, clearness: 1 });
    const j = clearSkyIrradiance({ elevationDeg: p.elevation, dayOfYear: JUL25, clearness: 0.95 });
    if (i.ghi > peak) { peak = i.ghi; peakH = h; }
    peak95 = Math.max(peak95, j.ghi);
    if (!(i.dni >= 0 && i.dhi >= 0 && i.ghi >= 0)) { ok(false, `negative irradiance at ${h}`); break; }
  }
  const noon = solarPosition({ dayOfYear: JUL25, hour: 12.6, ...site });
  const c1 = clearSkyIrradiance({ elevationDeg: noon.elevation, dayOfYear: JUL25, clearness: 1 });
  const c8 = clearSkyIrradiance({ elevationDeg: noon.elevation, dayOfYear: JUL25, clearness: 0.8 });
  console.log(`  clear-sky GHI peak ${peak.toFixed(0)} W/m² at ${hhmm(peakH)} (clearness 0.95: ${peak95.toFixed(0)}), noon DNI ${c1.dni.toFixed(0)} DHI ${c1.dhi.toFixed(0)}`);
  ok(peak >= 850 && peak <= 1000, `Seoul late-July clear-sky GHI peak ${peak.toFixed(0)} in 850–1000`);
  ok(c8.dni / c1.dni < c8.ghi / c1.ghi && c8.dhi > c1.dhi, 'clearness reduces beam more than global (diffuse rises)');
  ok(near(c1.ghi, c1.dni * Math.sin(noon.elevation * Math.PI / 180) + c1.dhi, 1e-6), 'GHI = DNI·sinEl + DHI');
  const night = clearSkyIrradiance({ elevationDeg: -5, dayOfYear: JUL25 });
  ok(night.ghi === 0 && night.dni === 0 && night.dhi === 0, 'zero irradiance at night');

  const Ts = [];
  for (let h = 0; h < 24; h += 0.25) Ts.push(ambientTemperature(h, 26, 35));
  const iMin = Ts.indexOf(Math.min(...Ts)), iMax = Ts.indexOf(Math.max(...Ts));
  ok(near(Math.min(...Ts), 26, 1e-9) && near(Math.max(...Ts), 35, 1e-9), 'ambient min/max = Tmin/Tmax');
  ok(near(iMin * 0.25, 5.5, 0.01) && near(iMax * 0.25, 15, 0.01), `ambient min at ${iMin * 0.25} h, max at ${iMax * 0.25} h`);
  ok(near(ambientTemperature(0, 26, 35), ambientTemperature(24, 26, 35), 1e-9), 'ambient periodic');
  const tsk = skyTemperature(35), tsk2 = skyTemperature(35, 24);
  ok(tsk < 35 - 5 && tsk > 35 - 20 && tsk2 < 35 && tsk2 > 35 - 15, `sky temperature Swinbank ${tsk.toFixed(1)} / Berdahl–Martin ${tsk2.toFixed(1)} °C below Ta`);
}

// ------------------------------------------------------------------ 3. view factor helper
section('view factor (parallel rectangles)');
{
  // closed-form aligned equal rectangles (Incropera Table 13.2)
  const aligned = (a, b, c) => {
    const X = a / c, Y = b / c;
    return (2 / (Math.PI * X * Y)) * (Math.log(Math.sqrt((1 + X * X) * (1 + Y * Y) / (1 + X * X + Y * Y)))
      + X * Math.sqrt(1 + Y * Y) * Math.atan(X / Math.sqrt(1 + Y * Y)) + Y * Math.sqrt(1 + X * X) * Math.atan(Y / Math.sqrt(1 + X * X))
      - X * Math.atan(X) - Y * Math.atan(Y));
  };
  const r = { x0: 0, x1: 6, y0: 0, y1: 3 };
  const f1 = viewFactorParallel(r, r, 0.8), f0 = aligned(6, 3, 0.8);
  const small = { x0: 0.1, x1: 5.9, y0: 0.1, y1: 2.9 }, big = { x0: -0.2, x1: 6.2, y0: -0.2, y1: 3.2 };
  const fsb = viewFactorParallel(small, big, 0.8), fbs = viewFactorParallel(big, small, 0.8);
  const As = 5.8 * 2.8, Ab = 6.4 * 3.4;
  console.log(`  6×3 @0.8 m: ${f1.toFixed(5)} vs closed form ${f0.toFixed(5)}; reciprocity ${(As * fsb).toFixed(4)} = ${(Ab * fbs).toFixed(4)}`);
  ok(near(f1, f0, 1e-6), 'general formula matches aligned closed form');
  ok(near(As * fsb, Ab * fbs, 1e-6), 'reciprocity A1F12 = A2F21');
}

// ------------------------------------------------------------------ 4. thermal model
section('thermal model — Seoul Jul 25, Tmax 35 / Tmin 26, wind 1.5, clearness 0.95, α 0.7, 50 mm');
const W0 = { Tmax: 35, Tmin: 26, windSpeed: 1.5, clearness: 0.95 };
const R0 = { alpha: 0.7, insulationMm: 50 };
const AC_ON = { acOn: true, setpoint: 26, internalGainW: 350 };
const AC_OFF = { acOn: false, setpoint: 26, internalGainW: 350 };
const run = (id, extra = {}) => simulateDay({
  design: getDesign(id), params: defaultParams(id), site, dayOfYear: JUL25, weather: W0, roof: R0, interior: AC_ON, ...extra,
});

const res = {};
for (const id of ALL_IDS) res[id] = { on: run(id), off: run(id, { interior: AC_OFF }) };
const b = res['0'];
const rows = [];
console.log(`  ${'design'.padEnd(6)}${pad('TroofMax', 10)}${pad('@h', 7)}${pad('TshadeMax', 11)}${pad('TinMax(off)', 13)}${pad('roofKWh', 9)}${pad('acKWh', 8)}${pad('peakAcW', 9)}${pad('reduct%', 9)}${pad('v_gap', 7)}`);
for (const id of ALL_IDS) {
  const s = res[id].on.summary, so = res[id].off.summary;
  const red = 100 * (1 - s.roofHeatKWh / b.on.summary.roofHeatKWh);
  rows.push({ id, s, so, red });
  console.log(`  ${id.padEnd(6)}${pad(s.TroofMax.toFixed(1), 10)}${pad(hhmm(s.TroofMaxHour), 7)}${pad(Number.isFinite(s.TshadeMax) ? s.TshadeMax.toFixed(1) : '—', 11)}${pad(so.TinMax.toFixed(1), 13)}`
    + `${pad(s.roofHeatKWh.toFixed(2), 9)}${pad(s.acKWh.toFixed(2), 8)}${pad(s.peakAcW.toFixed(0), 9)}${pad(id === '0' ? '—' : red.toFixed(0), 9)}${pad(s.gapVelocityMean.toFixed(2), 7)}`);
}
{
  const r = (id) => rows.find((x) => x.id === id);
  const bs = b.on.summary;
  ok(bs.TroofMax >= 65 && bs.TroofMax <= 78, `baseline roof peak ${bs.TroofMax.toFixed(1)} in 65–78 °C`);
  ok(Number.isNaN(bs.TshadeMax) && b.on.Tshade.every(Number.isNaN), 'baseline Tshade = NaN');
  const solid = ['A', 'B', 'C', 'E'];
  for (const id of solid) {
    const s = r(id).s;
    // guide 38–48 °C; with an ideal foil underside (ε 0.05) and a ventilated channel the plate tracks the gap
    // air ≈ Ta + 0–2 K, so the lower bound checked here is Tmax − 1 (see docs/physics.md §2.9)
    ok(s.TroofMax >= W0.Tmax - 1 && s.TroofMax <= 48, `${id} roof peak ${s.TroofMax.toFixed(1)} in [${W0.Tmax - 1}, 48] °C`);
    ok(s.TshadeMax >= 40 && s.TshadeMax <= 50, `${id} shade-layer top peak ${s.TshadeMax.toFixed(1)} in 40–50 °C`);
    ok(r(id).red >= 55 && r(id).red <= 85, `${id} roof heat-gain reduction ${r(id).red.toFixed(0)} % in 55–85 %`);
  }
  const maxSolid = Math.max(...solid.map((id) => r(id).s.TroofMax));
  ok(r('D').s.TroofMax > maxSolid && r('D').s.TroofMax < bs.TroofMax - 15, `D (80 % net) roof peak ${r('D').s.TroofMax.toFixed(1)} above solid designs (${maxSolid.toFixed(1)}), well below baseline`);
  ok(r('D').red >= 30 && r('D').red < Math.min(...solid.map((id) => r(id).red)), `D reduction ${r('D').red.toFixed(0)} % ≥ 30 % and below the solid designs`);
  for (const id of DESIGN_IDS) {
    ok(r(id).so.TinMax <= b.off.summary.TinMax - 1.5, `${id} AC-off indoor peak ${r(id).so.TinMax.toFixed(1)} ≤ baseline ${b.off.summary.TinMax.toFixed(1)} − 1.5`);
    ok(r(id).s.acKWh < bs.acKWh, `${id} AC energy ${r(id).s.acKWh.toFixed(2)} < baseline ${bs.acKWh.toFixed(2)} kWh`);
  }
  // structural checks on every result
  for (const id of ALL_IDS) for (const which of ['on', 'off']) {
    const t = res[id][which];
    const keys = ['Ta', 'Tsky', 'ghi', 'dni', 'dhi', 'TroofSun', 'TroofShade', 'Troof', 'Tgap', 'Tin', 'qRoof', 'qRoofW', 'acW', 'gapVelocity'];
    const good = t.hours.length === 97 && t.hours[0] === 0 && t.hours[96] === 24
      && keys.every((k) => t[k].length === 97 && t[k].every(Number.isFinite))
      && (id === '0' || t.Tshade.every(Number.isFinite));
    ok(good, `${id}/${which}: 97 samples 0..24 h, all finite`);
    ok(near(t.summary.acKWh * INTERIOR.acCOP, t.summary.coolingKWh, 1e-9), `${id}/${which}: acKWh = coolingKWh / COP`);
  }
  ok(res.B.off.acW.every((v) => v === 0) && res.B.off.summary.acKWh === 0, 'AC off → acW = 0');
  ok(Math.max(...res.B.on.Tin) <= 26 + 1e-6, 'AC on holds Tin ≤ setpoint');
  // sampleAt
  const sA = sampleAt(res.A.on, 13.0), i13 = 52;
  ok(near(sA.Troof, res.A.on.Troof[i13], 1e-9) && near(sA.Tin, res.A.on.Tin[i13], 1e-9), 'sampleAt at grid point');
  const sM = sampleAt(res.A.on, 13.125);
  ok(near(sM.Troof, (res.A.on.Troof[52] + res.A.on.Troof[53]) / 2, 1e-9), 'sampleAt linear interpolation');
  ok(['Ta', 'Troof', 'TroofSun', 'TroofShade', 'Tshade', 'Tgap', 'Tin', 'qRoof', 'ghi', 'acW', 'gapVelocity'].every((k) => k in sA), 'sampleAt fields');
  ok(Number.isFinite(sampleAt(res.A.on, 24).Tin) && Number.isFinite(sampleAt(res.A.on, 25).Tin), 'sampleAt at/after 24 h');

  // silver foil matters (C with a painted underside instead of foil)
  const Cpaint = { ...DESIGNS.C, thermal: { ...DESIGNS.C.thermal, epsBottom: 0.9 } };
  const cp = simulateDay({ design: Cpaint, params: defaultParams('C'), site, dayOfYear: JUL25, weather: W0, roof: R0, interior: AC_ON });
  console.log(`  foil check: C underside ε 0.05 → roof ${r('C').s.TroofMax.toFixed(1)} °C, ε 0.9 → ${cp.summary.TroofMax.toFixed(1)} °C; roof heat ${r('C').s.roofHeatKWh.toFixed(2)} → ${cp.summary.roofHeatKWh.toFixed(2)} kWh`);
  ok(cp.summary.TroofMax - r('C').s.TroofMax >= 3, 'silver-foil underside lowers the roof peak by ≥ 3 K vs painted');

  // low-angle sun under tall open canopies (default geometry and via shadeProfile)
  const bt = (id, h) => res[id].on.beamTrans[Math.round(h / 0.25)];
  console.log(`  beamTrans 07:30 / 12:30 / 17:00 — A ${bt('A', 7.5).toFixed(2)}/${bt('A', 12.5).toFixed(2)}/${bt('A', 17).toFixed(2)}  B ${bt('B', 7.5).toFixed(2)}/${bt('B', 12.5).toFixed(2)}/${bt('B', 17).toFixed(2)}  D ${bt('D', 7.5).toFixed(2)}/${bt('D', 12.5).toFixed(2)}/${bt('D', 17).toFixed(2)}`);
  ok(bt('A', 7.5) > bt('A', 12.5) + 0.1 && bt('D', 7.5) > bt('D', 12.5) + 0.1, 'A and D admit more morning sun than at noon');
  ok(bt('A', 7.5) > bt('B', 7.5) + 0.1, 'tall open canopy (A) admits more morning sun than an 9 cm channel (B)');
  const flat = (h) => ({ beamTrans: 0, skyView: 0.2 });
  const lowSun = (h) => ({ beamTrans: (h < 10 || h > 15) ? 0.35 : 0, skyView: 0.2 });
  const a0 = run('A', { shadeProfile: flat }), a1 = run('A', { shadeProfile: lowSun });
  ok(sampleAt(a1, 8).Troof > sampleAt(a0, 8).Troof + 3 && near(sampleAt(a1, 12.5).Troof, sampleAt(a0, 12.5).Troof, 0.5),
    `shadeProfile morning sun raises 08:00 roof ${sampleAt(a0, 8).Troof.toFixed(1)} → ${sampleAt(a1, 8).Troof.toFixed(1)} °C`);
}

// ------------------------------------------------------------------ 5. gap sensitivity (B)
section('gap sensitivity — design B');
{
  const gaps = [0.05, 0.07, 0.09, 0.11, 0.13, 0.15];
  // (a) ventilation physics only: same shading for every gap (as a ray-cast profile with blocked beam would give)
  const fixed = () => ({ beamTrans: 0, skyView: 0.03 });
  const va = gaps.map((g) => simulateDay({ design: DESIGNS.B, params: { gap: g }, site, dayOfYear: JUL25, weather: W0, roof: R0, interior: AC_ON, shadeProfile: fixed }));
  const vb = gaps.map((g) => simulateDay({ design: DESIGNS.B, params: { gap: g }, site, dayOfYear: JUL25, weather: W0, roof: R0, interior: AC_ON }));
  console.log(`  gap [m]           ${gaps.map((g) => pad(g.toFixed(2), 7)).join('')}`);
  console.log(`  v_gap mean [m/s]  ${va.map((r) => pad(r.summary.gapVelocityMean.toFixed(2), 7)).join('')}`);
  console.log(`  Troof max (vent)  ${va.map((r) => pad(r.summary.TroofMax.toFixed(2), 7)).join('')}`);
  console.log(`  Tgap max  (vent)  ${va.map((r) => pad(Math.max(...r.Tgap).toFixed(2), 7)).join('')}`);
  console.log(`  roof kWh  (vent)  ${va.map((r) => pad(r.summary.roofHeatKWh.toFixed(3), 7)).join('')}`);
  console.log(`  Troof max (geom)  ${vb.map((r) => pad(r.summary.TroofMax.toFixed(2), 7)).join('')}   ← default shadow geometry (edge sun grows with gap)`);
  const T = va.map((r) => r.summary.TroofMax), Q = va.map((r) => r.summary.roofHeatKWh), V = va.map((r) => r.summary.gapVelocityMean);
  ok(T.every((t, i) => i === 0 || t < T[i - 1]), 'bigger channel → cooler roof (monotonic)');
  ok(Q.every((q, i) => i === 0 || q < Q[i - 1]), 'bigger channel → less roof heat gain (monotonic)');
  ok(V.every((v, i) => i === 0 || v > V[i - 1]), 'bigger channel → faster gap air');
  ok((T[0] - T[2]) > 3 * (T[2] - T[5]), `diminishing returns beyond ~9 cm: ΔT(5→9 cm) ${(T[0] - T[2]).toFixed(2)} K vs ΔT(9→15 cm) ${(T[2] - T[5]).toFixed(2)} K`);
  const G = vb.map((r) => r.summary.TroofMax);
  ok(G[0] - G[2] > 0.5 && Math.abs(G[5] - G[2]) < 0.5, 'default geometry: strong gain up to 9 cm, plateau (±0.5 K) up to 15 cm');
  // open canopy A: taller canopy admits more low sun → warmer
  const a5 = run('A', { params: { gap: 0.5 } }), a10 = run('A', { params: { gap: 1.0 } });
  ok(a10.summary.roofHeatKWh > a5.summary.roofHeatKWh, `A: 1.0 m canopy admits more low sun than 0.5 m (${a5.summary.roofHeatKWh.toFixed(2)} → ${a10.summary.roofHeatKWh.toFixed(2)} kWh)`);
  const d7 = run('D', { params: { gap: 0.85, shade: 0.7 } }), d9 = run('D', { params: { gap: 0.85, shade: 0.9 } });
  ok(d9.summary.TroofMax < d7.summary.TroofMax - 3, `D: shade 90 % cooler than 70 % (${d7.summary.TroofMax.toFixed(1)} → ${d9.summary.TroofMax.toFixed(1)} °C)`);
}

// ------------------------------------------------------------------ 6. robustness
section('robustness');
{
  const s30 = run('D', { stepSec: 30 }).summary, s300 = run('D', { stepSec: 300 }).summary;
  ok(near(s30.TroofMax, s300.TroofMax, 0.3) && near(s30.TshadeMax, s300.TshadeMax, 0.3), `step size independent: dt 30 s ${s30.TroofMax.toFixed(2)} vs 300 s ${s300.TroofMax.toFixed(2)} °C (net layer C ≈ 150 J/m²K)`);
  const sp2 = run('B', { interior: AC_OFF }).summary, sp5 = run('B', { interior: AC_OFF, spinupDays: 5 }).summary;
  ok(near(sp2.TinMax, sp5.TinMax, 0.1), `2-day spin-up converged (${sp2.TinMax.toFixed(2)} vs ${sp5.TinMax.toFixed(2)})`);
  let finite = true;
  for (const [w, r] of [[{ Tmax: 3, Tmin: -6, windSpeed: 0, clearness: 1 }, { alpha: 0.9, insulationMm: 0 }],
    [{ Tmax: 38, Tmin: 28, windSpeed: 12, clearness: 0.3 }, { alpha: 0.2, insulationMm: 150 }]]) {
    for (const id of ALL_IDS) {
      const t = simulateDay({ design: getDesign(id), params: defaultParams(id), site, dayOfYear: dayOfYear(1, 15), weather: w, roof: r, interior: AC_ON });
      if (![...t.Troof, ...t.Tin, ...t.acW].every(Number.isFinite)) finite = false;
    }
  }
  ok(finite, 'extreme inputs (winter, no wind, bare steel, gale, overcast) stay finite');
  const ins0 = run('0', { roof: { alpha: 0.7, insulationMm: 0 } }).summary;
  ok(ins0.roofHeatKWh > 4 * b.on.summary.roofHeatKWh, 'uninsulated roof gains ≫ insulated');
  const wind6 = run('0', { weather: { ...W0, windSpeed: 6 } }).summary;
  ok(wind6.TroofMax < b.on.summary.TroofMax - 5, 'more wind → cooler bare roof');
  ok(THERMAL_ASSUMPTIONS.length >= 8 && THERMAL_ASSUMPTIONS.length <= 12 && THERMAL_ASSUMPTIONS.every((s) => typeof s === 'string' && /[가-힣]/.test(s)), 'THERMAL_ASSUMPTIONS 8–12 Korean strings');
}

// ------------------------------------------------------------------ 7. wind
section('wind load path — V = 26 m/s (강풍경보 순간)');
{
  ok(near(velocityPressure(26), 414.05, 0.01) && velocityPressure(0) === 0, 'q = ½ρV²');
  console.log(`  ${'design'.padEnd(7)}${pad('uplift N', 10)}${pad('weight N', 10)}${pad('SF', 7)}${pad('Vcrit', 8)}  status  governing stage`);
  for (const id of DESIGN_IDS) {
    const d = DESIGNS[id], p = defaultParams(id);
    const w = windCheck(d, { V: 26, params: p });
    console.log(`  ${id.padEnd(7)}${pad(w.upliftN.toFixed(0), 10)}${pad(w.weightN.toFixed(0), 10)}${pad(w.sf.toFixed(2), 7)}${pad(w.criticalV.toFixed(1), 8)}  ${w.status.padEnd(6)}  ${w.governing}`);
    ok(w.stages.length === d.wind.loadPath.length && w.stages.every((s) => Number.isFinite(s.sf) && s.capacityN > 0), `${id} stages`);
    ok(near(w.sf, Math.min(...w.stages.map((s) => s.sf)), 1e-12), `${id} sf = min stage sf`);
    const atCrit = windCheck(d, { V: w.criticalV, params: p });
    ok(near(atCrit.sf, 1, 1e-9), `${id} SF(criticalV) = 1`);
    ok(w.status === (w.sf >= 1.5 ? 'ok' : w.sf >= 1 ? 'warn' : 'fail'), `${id} status thresholds`);
    const z = windCheck(d, { V: 0, params: p });
    ok(z.sf === Infinity && z.status === 'ok' && Number.isFinite(z.criticalV), `${id} V = 0 → SF ∞`);
    const c = sfCurve(d, p, 50, 1);
    ok(c.length === 50 && c[0].V === 1 && c.every((q, i) => Number.isFinite(q.sf) && (i === 0 || q.sf < c[i - 1].sf)), `${id} sfCurve 1..50 m/s decreasing`);
  }
  const c4 = windCheck(DESIGNS.C, { V: 26, params: { gap: 0.09, strapLC: 4 } }), c20 = windCheck(DESIGNS.C, { V: 26, params: { gap: 0.09, strapLC: 20 } });
  ok(c20.sf > c4.sf && c20.governing !== c4.governing, `C strap LC 4 → 20 kN raises SF ${c4.sf.toFixed(2)} → ${c20.sf.toFixed(2)} and moves governing stage to "${c20.governing}"`);
  const dd = windCheck(DESIGNS.D, { V: 26, params: defaultParams('D') });
  ok(dd.governing === DESIGNS.D.wind.loadPath[0].stage, 'D: bungee balls govern (fuse)');
  const b0 = windCheck(BASELINE, { V: 30 });
  ok(b0.sf === Infinity && b0.stages.length === 0, 'baseline: nothing to blow off');
  ok(WIND_ASSUMPTIONS.length >= 6 && WIND_ASSUMPTIONS.length <= 10 && WIND_ASSUMPTIONS.some((s) => s.includes('KDS 41 12 00')), 'WIND_ASSUMPTIONS 6–10 incl. KDS 41 12 00');
}

// ------------------------------------------------------------------ 8. timing
section('run time');
{
  const reps = 3;
  const times = [];
  for (let k = 0; k < reps; k++) for (const id of ALL_IDS) {
    const t0 = performance.now();
    run(id);
    times.push(performance.now() - t0);
  }
  times.sort((a, c) => a - c);
  const mean = times.reduce((a, c) => a + c, 0) / times.length;
  const t0 = performance.now();
  for (const id of ALL_IDS) run(id);
  const six = performance.now() - t0;
  console.log(`  simulateDay: mean ${mean.toFixed(1)} ms, median ${times[times.length >> 1].toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms; 6 variants ${six.toFixed(1)} ms`);
  ok(mean < 40 && times[times.length - 1] < 80, 'simulateDay < 40 ms per call');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
