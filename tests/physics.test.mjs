// Physics & thermal solver test suite for K-Roof container heat-shield simulation
import { strict as assert } from 'node:assert';
import { SITES, WEATHER_PRESETS, ROOF, INTERIOR, ALL_IDS, DESIGN_IDS, getDesign, CP_CANDIDATES } from '../js/config.js';
import { cpDesignFor } from '../js/custom.js';
import { dayOfYear, solarPosition, clearSkyIrradiance, sunTimes, skyTemperature, ambientTemperature } from '../js/physics/sun.js';
import {
  simulateDay,
  simulatePair,
  sampleAt,
  viewFactorParallel,
  THERMAL_CONSTANTS,
  THERMAL_ASSUMPTIONS,
} from '../js/physics/thermal.js';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

const seoul = SITES[0];
const heatwave = WEATHER_PRESETS[0];
const doy = dayOfYear(7, 25);

// 1. Solar geometry & clear-sky baseline
{
  check(seoul.id === 'seoul', 'SITES[0] is seoul');
  check(heatwave.id === 'heatwave', 'WEATHER_PRESETS[0] is heatwave');
  check(doy === 206, `July 25 dayOfYear is 206 (got ${doy})`);

  const noon = solarPosition({ lat: seoul.lat, lon: seoul.lon, tz: seoul.tz, dayOfYear: doy, hour: 12.5 });
  check(noon.elevation > 60 && noon.elevation < 80, `Seoul late-July solar elevation ~70° (got ${noon.elevation.toFixed(1)}°)`);

  const irr = clearSkyIrradiance({ elevationDeg: noon.elevation, clearness: heatwave.clearness, dayOfYear: doy });
  const closure = Math.abs(irr.ghi - (irr.dni * Math.sin((noon.elevation * Math.PI) / 180) + irr.dhi));
  check(closure < 1.0 && irr.ghi > 700, `GHI consistency and magnitude (${irr.ghi.toFixed(1)} W/m²)`);

  const times = sunTimes({ lat: seoul.lat, lon: seoul.lon, tz: seoul.tz, dayOfYear: doy });
  check(times.sunrise > 4.5 && times.sunrise < 6.5, `Sunrise in [4.5, 6.5] (${times.sunrise.toFixed(2)})`);
  check(times.sunset > 18.5 && times.sunset < 20.5, `Sunset in [18.5, 20.5] (${times.sunset.toFixed(2)})`);

  const tSky = skyTemperature(30, heatwave.clearness);
  check(tSky < 30 && tSky > 0, `Sky temp below Ta (${tSky.toFixed(1)}°C)`);
  check(Math.abs(ambientTemperature(15, 26, 35) - 35) < 0.01, 'Tmax occurs at T_MAX_HOUR (15:00)');
}

// 2. Constants, assumptions, viewFactor
{
  check(THERMAL_CONSTANTS.insK === 0.035, 'Insulation k is 0.035 W/mK');
  check(THERMAL_CONSTANTS.zRoof === 2.8, 'Container roof height zRoof is 2.8m');
  check(Array.isArray(THERMAL_ASSUMPTIONS) && THERMAL_ASSUMPTIONS.length >= 8, 'THERMAL_ASSUMPTIONS populated');
  check(THERMAL_ASSUMPTIONS.some((s) => s.includes('6.0m') && s.includes('3.0m') && s.includes('2.8m')), 'Assumptions state container size');
  check(THERMAL_ASSUMPTIONS.some((s) => s.includes('48시간') && s.includes('72시간')), 'Assumptions disclose 48h spin-up + 24h output');
  const rect = { x0: 0, x1: 6, y0: 0, y1: 3 };
  const vf = viewFactorParallel(rect, rect, 0.11);
  check(vf > 0.9 && vf < 1.0, `Parallel plate VF for 6x3m at 110mm gap (${vf.toFixed(4)})`);
}

// 3. AC OFF vs AC ON separation (0mm insulation)
const baseOpts = {
  site: seoul,
  dayOfYear: doy,
  weather: { ...heatwave },
  roof: { ...ROOF, insulationMm: 0 },
  interior: { ...INTERIOR, acOn: false, setpoint: 26 },
};

const pairs0 = Object.fromEntries(
  ALL_IDS.map((id) => [id, simulatePair({ ...baseOpts, design: getDesign(id) })])
);

for (const id of ALL_IDS) {
  const { off, on } = pairs0[id];
  check(off.hours.length === 97 && off.hours[0] === 0 && off.hours[96] === 24, `${id}: 97 quarter-hour points`);
  check(off.qCoolW.every((q) => q === 0) && off.summary.coolingKWh === 0, `${id}: AC OFF qCoolW and coolingKWh strictly 0`);

  const outsideAc = on.hours.filter((h, i) => (h < 8 || h > 18) && on.qCoolW[i] !== 0);
  check(outsideAc.length === 0, `${id}: AC ON cooling strictly 0 outside 08:00~18:00`);
  check(on.summary.coolingKWh > 0, `${id}: AC ON coolingKWh positive (${on.summary.coolingKWh.toFixed(2)} kWh)`);

  // Check indoor temperature controlled near setpoint 26°C during daytime AC hours (10..17)
  const acTemps = on.hours.map((h, i) => ({ h, T: on.Tin[i] })).filter((x) => x.h >= 10 && x.h <= 17);
  check(acTemps.every((x) => x.T <= 26.2), `${id}: AC ON holds Tin <= 26°C during occupied hours`);
  check(on.summary.TroofBotMax <= off.summary.TroofBotMax && on.summary.TroofBotMax > 25,
    `${id}: AC ON keeps TroofBotMax physical (${on.summary.TroofBotMax.toFixed(1)} <= ${off.summary.TroofBotMax.toFixed(1)}°C)`);
  check(off.summary.roofHeatKWh >= 0, `${id}: roofHeatKWh non-negative`);
}

// 4. Relative ranking & physical behavior across A, B, C, Cp (0mm insulation, AC OFF/ON)
{
  const A = pairs0.A;
  const B = pairs0.B;
  const C = pairs0.C;
  const Cp = pairs0.Cp;

  check(A.off.summary.TroofBotMax > B.off.summary.TroofBotMax + 20, `A roof bot (${A.off.summary.TroofBotMax.toFixed(1)}°C) >> B (${B.off.summary.TroofBotMax.toFixed(1)}°C)`);
  check(A.off.summary.TinMax > B.off.summary.TinMax + 15, `A indoor max (${A.off.summary.TinMax.toFixed(1)}°C) >> B (${B.off.summary.TinMax.toFixed(1)}°C)`);
  check(A.on.summary.coolingKWh > B.on.summary.coolingKWh * 2, 'A cooling load > 2x B cooling load');
  check(C.off.summary.TroofBotMax < B.off.summary.TroofBotMax, `C (${C.off.summary.TroofBotMax.toFixed(1)}°C) cooler than B (${B.off.summary.TroofBotMax.toFixed(1)}°C)`);
  check(C.on.summary.coolingKWh < B.on.summary.coolingKWh, `C cooling (${C.on.summary.coolingKWh.toFixed(2)}) < B (${B.on.summary.coolingKWh.toFixed(2)})`);
  check(Cp.off.summary.TroofBotMax < A.off.summary.TroofBotMax - 20, `Cp cooler than A (${Cp.off.summary.TroofBotMax.toFixed(1)}°C)`);
  check(C.on.summary.coolingKWh < Cp.on.summary.coolingKWh, `C cooling (${C.on.summary.coolingKWh.toFixed(2)}) < Cp (${Cp.on.summary.coolingKWh.toFixed(2)})`);

  // Check B gapVelocity is 0 while C and Cp have positive natural ventilation velocities
  check(B.off.gapVelocity.every((v) => v === 0), 'B has 0 gap velocity (0mm contact)');
  check(Math.max(...C.off.gapVelocity) > 0.1, `C has positive channel airflow (${Math.max(...C.off.gapVelocity).toFixed(2)} m/s)`);
  check(Math.max(...Cp.off.gapVelocity) > 0.1, `Cp has positive channel airflow (${Math.max(...Cp.off.gapVelocity).toFixed(2)} m/s)`);
}

// 5. Buoyancy stack effect when windSpeed = 0 (natural ventilation still moves air)
{
  const calmWeather = { ...heatwave, windSpeed: 0 };
  const cCalm = simulateDay({ ...baseOpts, weather: calmWeather, design: getDesign('C') });
  const cpCalm = simulateDay({ ...baseOpts, weather: calmWeather, design: getDesign('Cp') });
  const vMaxC = Math.max(...cCalm.gapVelocity);
  const vMaxCp = Math.max(...cpCalm.gapVelocity);
  check(vMaxC > 0.02 && vMaxCp > vMaxC, `Buoyancy drives channel airflow at wind=0 (C=${vMaxC.toFixed(3)}, Cp=${vMaxCp.toFixed(3)} m/s)`);
  check(vMaxC !== vMaxCp, 'C (110mm) and Cp (140mm) yield distinct gap velocities');
}

// 6. 50mm roof insulation separates steel roof underside (TroofBot) from insulation inner face (TinsIn)
{
  const pairs50 = Object.fromEntries(
    ALL_IDS.map((id) => [
      id,
      simulatePair({
        ...baseOpts,
        roof: { ...ROOF, insulationMm: 50 },
        design: getDesign(id),
      }),
    ])
  );

  // At 0mm insulation, TroofBot and TinsIn match within numerical tolerance
  const diff0 = Math.max(...pairs0.A.off.TroofBot.map((v, i) => Math.abs(v - pairs0.A.off.TinsIn[i])));
  check(diff0 < 0.05, `At 0mm insulation, TroofBot and TinsIn coincide (max diff ${diff0.toFixed(4)}°C)`);

  // At 50mm insulation for A: steel plate gets hotter (heat trapped), interior insulation surface & room cool down strongly
  const a50Off = pairs50.A.off;
  const insMaxA50 = Math.max(...a50Off.TinsIn);
  check(a50Off.summary.TroofBotMax > pairs0.A.off.summary.TroofBotMax, '50mm insulation raises bare steel underside peak vs uninsulated');
  check(a50Off.summary.TroofBotMax - insMaxA50 > 20, `50mm ins separates TroofBot (${a50Off.summary.TroofBotMax.toFixed(1)}°C) from TinsIn (${insMaxA50.toFixed(1)}°C)`);
  check(a50Off.summary.TinMax < pairs0.A.off.summary.TinMax - 10, `50mm ins lowers indoor peak A (${a50Off.summary.TinMax.toFixed(1)}°C < ${pairs0.A.off.summary.TinMax.toFixed(1)}°C)`);
  check(pairs50.A.on.summary.coolingKWh < pairs0.A.on.summary.coolingKWh * 0.4, '50mm ins cuts A cooling load > 60%');

  for (const id of DESIGN_IDS) {
    check(pairs50[id].on.summary.coolingKWh < pairs50.A.on.summary.coolingKWh, `50mm: ${id} still saves cooling vs A`);
  }
}

// 6b. C′ surface-property sensitivity (추가 수정 요청 §2): every candidate improves on the original C′
{
  const runs = Object.fromEntries(CP_CANDIDATES.map((c) => [c.id, simulatePair({ ...baseOpts, design: cpDesignFor(c) })]));
  const keys = [['off', 'TroofBotMax'], ['off', 'TinMax'], ['off', 'roofHeatKWh'], ['on', 'coolingKWh']];
  const v = (id, [br, k]) => runs[id][br].summary[k];
  const better = (a, b) => keys.every((key) => v(a, key) < v(b, key) - 1e-6);

  const cpBase = pairs0.Cp;
  check(keys.every((key) => Math.abs(v('base', key) - cpBase[key[0]].summary[key[1]]) < 1e-9), 'candidate "기존" reproduces the original C′ exactly');
  check(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].every((id) => better(id, 'base')), 'all 6 candidates lower roof-bottom peak, indoor peak, roof heat gain and cooling load');
  check(better('c2', 'c1') && better('c4', 'c3'), 'stronger change (ρ 0.89 > 0.85, ε 0.12 < 0.20) helps more');
  check(better('c5', 'c1') && better('c5', 'c3') && better('c6', 'c2') && better('c6', 'c4'), 'combined top + bottom improvements beat either alone');
  check(['base', 'c1', 'c2', 'c3', 'c4', 'c5'].every((id) => better('c6', id)), '후보 6 (ρ 0.89 · ε 0.12) is the best candidate');

  // Observation that motivated the request (2-1): original C′ cools cheaper than B but runs hotter indoors / lets more heat in
  const B = pairs0.B;
  check(cpBase.on.summary.coolingKWh < B.on.summary.coolingKWh, `original C′ cooling (${cpBase.on.summary.coolingKWh.toFixed(2)}) < B (${B.on.summary.coolingKWh.toFixed(2)})`);
  check(cpBase.off.summary.TinMax > B.off.summary.TinMax && cpBase.off.summary.roofHeatKWh > B.off.summary.roofHeatKWh,
    `original C′ indoor peak / roof heat (${cpBase.off.summary.TinMax.toFixed(2)} °C / ${cpBase.off.summary.roofHeatKWh.toFixed(2)} kWh) above B`);
  check(v('c1', ['off', 'TinMax']) < B.off.summary.TinMax && v('c1', ['off', 'roofHeatKWh']) < B.off.summary.roofHeatKWh,
    '후보 1 already overtakes B on indoor peak and roof heat gain');
  const bTh = getDesign('B').thermal;
  check(bTh.mode === 'contact' && bTh.gap === 0 && bTh.alphaTop === 0.11 && bTh.epsBottom === 0.12 && bTh.k === 0.44,
    'B thermal model unchanged by the screw fixing (contact, 0 mm, α 0.11, ε 0.12)');
}

// 7. Time-step & spin-up numerical convergence + sampleAt interpolation
{
  const fine = simulateDay({ ...baseOpts, design: getDesign('C'), stepSec: 30, spinupDays: 4 });
  const baseC = pairs0.C.off;
  check(
    Math.abs(fine.summary.TroofBotMax - baseC.summary.TroofBotMax) < 0.5,
    `dt=30s/spinup=4d converges to dt=60s/spinup=2d within 0.5°C (diff ${Math.abs(fine.summary.TroofBotMax - baseC.summary.TroofBotMax).toFixed(3)}°C)`
  );
  const sMid = sampleAt(baseC, 14.125);
  const sLo = sampleAt(baseC, 14.0);
  const sHi = sampleAt(baseC, 14.25);
  const midExpected = 0.5 * (sLo.TroofBot + sHi.TroofBot);
  check(Math.abs(sMid.TroofBot - midExpected) < 1e-6, 'sampleAt linearly interpolates midpoint values');
}

console.log(failed ? `\n${failed} check(s) failed (${passed} passed)` : `\nall physics checks passed (${passed})`);
assert.equal(failed, 0);
