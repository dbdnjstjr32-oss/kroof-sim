// thermal.js — transient 5-node lumped RC model for designs A, B, C, and C′.
// Pure JS (no three.js). Follows the exact specifications in 시뮬레이션 상세본.pdf.
//
// Nodes (Backward Euler, dt = 60 s, 48 h spin-up + 24 h output = 72 h total):
//   0 TpTop  heat-shield panel upper half (0.5 · C_panel) [NaN for baseline A]
//   1 TpBot  heat-shield panel lower half (0.5 · C_panel, coupled to TpTop via G_panel = k/t)
//   2 Tr     existing 1.2 mm steel roof plate core (C_steel = 7850·490·0.0012 = 4615.8 J/m²K)
//   3 Tg     ventilated air-gap mean air temperature (quasi-steady for C/C′, = Ta for A/B)
//   4 Tin    indoor container air (C_in = 300,000 J/K)
//
// Key outputs:
//   Troof / TroofBot = lower surface temperature of the existing 1.2 mm steel roof plate (°C)
//   TinsIn           = indoor-facing surface temperature of roof/insulation (°C)
//   Tin              = indoor air temperature (°C)
//   qRoofW           = heat flow rate into room through the roof assembly (W)
//   qCoolW           = cooling load rate during 08:00–18:00 when acOn=true (W thermal, NOT electric)

import { solarPosition, clearSkyIrradiance, ambientTemperature, skyTemperature } from './sun.js';
import { CONTAINER, ROOF, INTERIOR } from '../config.js';

const SIGMA = 5.670374e-8;
const K0 = 273.15;
const G_ACC = 9.81;
const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Air properties around ~35 °C
const AIR = { rho: 1.15, cp: 1006, k: 0.0266, nu: 1.65e-5, Pr: 0.71 };

export const THERMAL_CONSTANTS = {
  steelRhoC: ROOF.rhoSteel * ROOF.cpSteel,      // 7850 * 490 = 3,846,500 J/m³K
  steelR: ROOF.steelThk / ROOF.kSteel,          // 0.0012 / 50 = 2.4e-5 m²K/W
  insK: ROOF.kIns,                              // 0.035 W/m·K
  Rsi: 0.13,                                    // m²K/W inside ceiling surface film
  windExp: 0.25,
  zRoof: CONTAINER.H,                           // 2.8 m
  cpDelta: 0.3,                                 // wind-driven pressure coefficient difference across channel
  kEntryExit: 1.5,                              // channel entrance (0.5) + exit (1.0) loss coefficient
  roofFall: 0.03,                               // slight roof camber for buoyancy stack height (m)
  crossbarEffW: 0.05,                           // effective channel width reduction per crossbar (m)
};
const C = THERMAL_CONSTANTS;

export const THERMAL_ASSUMPTIONS = [
  '해석 시간: 60초 간격 후진 오일러, 초기 안정화 48시간 + 최종 출력 24시간 (전체 72시간)',
  '컨테이너 규격: 6.0m × 3.0m × 2.8m (지붕 18㎡, 전체 벽체 50.4㎡, 실내 체적 50.4㎥, 피복률 100%)',
  '기존 지붕 강판: 1.2mm (k=50 W/m·K, ρ=7,850 kg/㎥, c=490 J/kg·K, α=0.70, ε=0.90)',
  '지붕 단열재: 0mm(기본) 또는 50mm(k=0.035 W/m·K) 선택, 강판 하면 온도와 단열재 실내측 표면 온도 구분',
  '실내 공통 조건: 벽체 U=1.0 W/㎡·K, 실내 열용량 300,000 J/K, 침기 0.5 ACH, 내부발열 0W, 바닥 단열, 창 일사·별도전달 제외',
  'B안 (ACP 밀착형): 공기층 0mm 직접 접촉 전도 적용 (ACP k=0.44 W/m·K, 상부 α=0.11, 하부 ε=0.12)',
  'C안 / C′안 (이중지붕): 110mm / 140mm 공기층 내 장파복사(하부 ε=0.12 / 0.28) 및 폭 3m 4통로 자연환기 적용',
  '공기층 환기 유속: 외부 풍속을 직접 대입하지 않고 풍압차(ΔCp=0.3) + 온도차 부력으로 통로 유속 산정',
  '단순화 조건(§7.2): 보강재·크로스바 열용량 및 지지부 열교, 볼트·피스·스트랩·클램프 개별 열전달 제외',
  '냉방부하(§9): 냉방 ON 시 08:00~18:00 동안 실내 26℃(설정온도) 유지를 위해 제거하는 열에너지량(kWh) 산출',
];

function hRad(t1, t2) {
  const a = t1 + K0, b = t2 + K0;
  return SIGMA * (a * a + b * b) * (a + b);
}

const hForced = (U) => 2.8 + 3.0 * Math.max(0, U);

function hNatural(Tsurf, Tair, facingUp) {
  const dT = Tsurf - Tair;
  const ad = Math.abs(dT);
  if (ad < 1e-6) return 0;
  const unstable = facingUp ? dT > 0 : dT < 0;
  return unstable ? 1.52 * Math.cbrt(ad) : 0.7 * Math.pow(ad, 0.25);
}

const mix = (hf, hn) => Math.cbrt(hf * hf * hf + hn * hn * hn);

// View factor between parallel rectangles — Gross, Spindler & Hahne (1981)
function gFun(u, v, z) {
  const ruz = Math.sqrt(u * u + z * z), rvz = Math.sqrt(v * v + z * z);
  let s = 0;
  if (ruz > 0) s += v * ruz * Math.atan(v / ruz);
  if (rvz > 0) s += u * rvz * Math.atan(u / rvz);
  const r2 = u * u + v * v + z * z;
  if (r2 > 0) s -= 0.5 * z * z * Math.log(r2);
  return s / (2 * Math.PI);
}

export function viewFactorParallel(r1, r2, z) {
  const xs = [r1.x0, r1.x1], ys = [r1.y0, r1.y1], xis = [r2.x0, r2.x1], etas = [r2.y0, r2.y1];
  let sum = 0;
  for (let l = 0; l < 2; l++) for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const sgn = ((i + j + k + l) % 2 === 0) ? 1 : -1;
    sum += sgn * gFun(xs[i] - xis[l], ys[j] - etas[k], z);
  }
  const A1 = (r1.x1 - r1.x0) * (r1.y1 - r1.y0);
  return clamp(sum / A1, 0, 1);
}

function channelVelocity(dP, Dh, Lch, K) {
  if (!(dP > 0)) return 0;
  const rho = AIR.rho, nu = AIR.nu;
  const a = 0.5 * rho * K;
  const b = 0.5 * rho * (Lch / Dh) * 96 * nu / Dh;
  const vLam = (-b + Math.sqrt(b * b + 4 * a * dP)) / (2 * a);
  const c = 0.5 * rho * (Lch / Dh) * 0.316 * Math.pow(Dh / nu, -0.25);
  let v = Math.sqrt(dP / (a + c)) || vLam;
  for (let i = 0; i < 12; i++) {
    const r = a * v * v + c * Math.pow(v, 1.75) - dP;
    const d = 2 * a * v + 1.75 * c * Math.pow(v, 0.75);
    const nv = v - r / d;
    v = nv > 1e-6 ? nv : v / 2;
    if (Math.abs(r) < 1e-9) break;
  }
  return Math.min(vLam, v);
}

function channelH(V, Dh, Lch) {
  const Re = Math.max(1, V * Dh / AIR.nu);
  const Gz = Re * AIR.Pr * Dh / Lch;
  let Nu = 4.86 + 0.03 * Gz / (1 + 0.016 * Math.pow(Gz, 2 / 3));
  if (Re > 2300) {
    const f = Math.pow(0.79 * Math.log(Re) - 1.64, -2);
    const NuT = (f / 8) * (Re - 1000) * AIR.Pr
      / (1 + 12.7 * Math.sqrt(f / 8) * (Math.pow(AIR.Pr, 2 / 3) - 1))
      * (1 + Math.pow(Dh / Lch, 2 / 3));
    Nu = Math.max(Nu, NuT);
  }
  return Nu * AIR.k / Dh;
}

function solve5(M, b, x) {
  const n = 5;
  for (let c = 0; c < n; c++) {
    let p = c, mx = Math.abs(M[c * n + c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(M[r * n + c]);
      if (v > mx) { mx = v; p = r; }
    }
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = M[c * n + k]; M[c * n + k] = M[p * n + k]; M[p * n + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    const piv = M[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / piv;
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}

/**
 * simulateDay(opts) → ThermalResult
 */
export function simulateDay(opts) {
  const {
    design, site, dayOfYear: doy,
    weather = {}, roof = {}, interior = {},
    stepSec = 60, spinupDays = 2,
  } = opts;

  const Tmax = weather.Tmax ?? 35.0;
  const Tmin = Math.min(Tmax, weather.Tmin ?? 26.0);
  const V10 = Math.max(0, weather.windSpeed ?? 1.5);
  const clearness = clamp(weather.clearness ?? 0.95, 0.3, 1.0);
  const insMm = Math.max(0, roof.insulationMm ?? ROOF.insulationMm);
  const alphaR = clamp(roof.alpha ?? ROOF.alpha, 0, 1);
  const epsR = clamp(roof.eps ?? ROOF.eps, 0.05, 1);

  const acOn = !!interior.acOn;
  const Tset = interior.setpoint ?? INTERIOR.setpoint;
  const acStart = interior.acStartHour ?? INTERIOR.acStartHour;
  const acEnd = interior.acEndHour ?? INTERIOR.acEndHour;
  const Qint = interior.internalGainW ?? INTERIOR.internalGainW;
  const wallU = Math.max(0, interior.wallU ?? INTERIOR.wallU);
  const achInfil = Math.max(0, interior.achInfil ?? INTERIOR.achInfil);

  const th = design && design.thermal ? design.thermal : null;
  const mode = !th ? 'bare' : th.mode === 'contact' ? 'contact' : 'channel';

  const L = CONTAINER.L;
  const W = CONTAINER.W;
  const Ar = CONTAINER.roofArea;         // 18 m²
  const Awall = CONTAINER.wallArea;      // 50.4 m²
  const Vol = CONTAINER.roomVolume;      // 50.4 m³

  const dt = stepSec;
  const N = Math.max(24, Math.round(86400 / dt));
  const dtH = 24 / N;

  // Steel roof thermal capacitance and conductance (§3.2, §3.4)
  const Csteel = C.steelRhoC * ROOF.steelThk;                        // 4615.8 J/m²K
  const Rsteel = C.steelR;                                           // 2.4e-5 m²K/W
  const Rins = (insMm / 1000) / C.insK;                              // 0 or 1.4286 m²K/W
  const Uin = 1 / (0.5 * Rsteel + Rins + C.Rsi);                     // steel core -> room air
  const Uloc = V10 * Math.pow(C.zRoof / 10, C.windExp);              // wind speed at 2.8m height

  const Cin = INTERIOR.roomCap;                                      // 300,000 J/K
  const UAwall = wallU * Awall;                                      // 50.4 W/K
  const UAinf = (achInfil * Vol / 3600) * AIR.rho * AIR.cp;          // 0.5 ACH

  // Heat-shield panel properties (§4.1, §4.2, §6.3)
  const hasShade = mode !== 'bare';
  const gap = mode === 'channel' ? Math.max(0.01, th.gap ?? 0.11) : 0;
  const CpHalf = hasShade ? 0.5 * (th.arealHeatCap ?? 7600) : 1;
  const Gpanel = hasShade ? (th.k ?? 0.44) / Math.max(1e-5, th.thickness ?? 0.004) : 1;
  const alphaTop = hasShade ? (th.alphaTop ?? 0.11) : alphaR;
  const epsTop = hasShade ? (th.epsTop ?? 0.88) : epsR;
  const epsBot = hasShade ? (th.epsBottom ?? 0.12) : epsR;

  // Air-gap radiation and 4-channel widthwise natural ventilation (§6)
  const Frs = mode === 'channel'
    ? viewFactorParallel({ x0: -L / 2, x1: L / 2, y0: -W / 2, y1: W / 2 }, { x0: -L / 2, x1: L / 2, y0: -W / 2, y1: W / 2 }, gap)
    : 0;
  const SVside = mode === 'channel' ? (1 - Frs) : 1;
  const epsEff = mode === 'channel' ? 1 / (1 / epsBot + 1 / epsR - 1) : 0;

  const nCh = th?.channels ?? 4;
  const Lch = th?.channelLength ?? W;                                // 3.0 m widthwise
  const nBars = th?.crossbarCount ?? 5;
  const Wch = (L - nBars * C.crossbarEffW) / nCh;                    // ~1.4375 m per channel
  const flowFrac = (nCh * Wch) / L;                                  // open channel width fraction
  const Dh = mode === 'channel' ? (2 * Wch * gap) / (Wch + gap) : 0.2;
  const Gcontact = 1 / (0.5 * Rsteel);                               // direct contact in B

  // ---------------- per-step forcing for one periodic day
  const Tdp = Tmin - 1;
  const fTa = new Float64Array(N), fTsky = new Float64Array(N);
  const fDni = new Float64Array(N), fDhi = new Float64Array(N), fGhi = new Float64Array(N);

  for (let j = 0; j < N; j++) {
    const hour = j * dtH;
    const Ta = ambientTemperature(hour, Tmin, Tmax);
    const tClear = skyTemperature(Ta, Tdp) + K0;
    const epsClear = Math.pow(tClear / (Ta + K0), 4);
    const epsSky = epsClear + (1 - epsClear) * clamp(1 - clearness, 0, 1);
    fTa[j] = Ta;
    fTsky[j] = (Ta + K0) * Math.pow(epsSky, 0.25) - K0;
    const sp = solarPosition({ dayOfYear: doy, hour, lat: site.lat, lon: site.lon, tz: site.tz });
    const irr = clearSkyIrradiance({ elevationDeg: sp.elevation, dayOfYear: doy, clearness });
    fDni[j] = irr.dni;
    fDhi[j] = irr.dhi;
    fGhi[j] = irr.ghi;
  }

  // ---------------- state integration (72h = 48h spin-up + 24h output)
  const T0 = (Tmin + Tmax) / 2;
  const T = new Float64Array([T0, T0, T0, T0, acOn ? Tset : T0]);
  const M = new Float64Array(25), b = new Float64Array(5), x = new Float64Array(5);
  const Mc = new Float64Array(25), bc = new Float64Array(5), M4 = new Float64Array(5);

  const totalSteps = (Math.max(0, Math.round(spinupDays)) + 1) * N;
  const recStart = totalSteps - N;

  const R = {
    Ts: new Float64Array(N + 1),
    TrBot: new Float64Array(N + 1),
    TinsIn: new Float64Array(N + 1),
    Tg: new Float64Array(N + 1),
    Tin: new Float64Array(N + 1),
    q: new Float64Array(N + 1),
    qac: new Float64Array(N + 1),
    v: new Float64Array(N + 1),
  };

  let vGap = 0;
  const record = (k, qac) => {
    const qin = Uin * (T[2] - T[4]);
    const TrBot = T[2] - qin * (0.5 * Rsteel);
    const TinsIn = T[4] + qin * C.Rsi;
    R.Ts[k] = hasShade ? T[0] : NaN;
    R.TrBot[k] = TrBot;
    R.TinsIn[k] = TinsIn;
    R.Tg[k] = mode === 'channel' ? T[3] : (mode === 'contact' ? T[1] : fTa[k % N]);
    R.Tin[k] = T[4];
    R.q[k] = qin;
    R.qac[k] = qac;
    R.v[k] = vGap;
  };

  if (recStart === 0) record(0, 0);

  for (let n = 0; n < totalSteps; n++) {
    const j = (n + 1) % N;
    const hour = j === 0 ? 24 : j * dtH;
    const Ta = fTa[j], Tsky = fTsky[j], Ghi = fGhi[j];
    const [Tp1, Tp2, Tr, Tg, Tin] = T;

    M.fill(0); b.fill(0);

    if (mode === 'bare') {
      vGap = Uloc;
      M[0] = 1; b[0] = Ta;
      M[6] = 1; b[1] = Ta;
      M[18] = 1; b[3] = Ta;
      const hc = mix(hForced(Uloc), hNatural(Tr, Ta, true));
      const hr = epsR * hRad(Tr, Tsky);
      M[12] = Ar * (Csteel / dt + hc + hr + Uin);
      M[14] = -Ar * Uin;
      b[2] = Ar * ((Csteel / dt) * Tr + alphaR * Ghi + hc * Ta + hr * Tsky);
    } else if (mode === 'contact') {
      vGap = 0;
      const hTop = mix(hForced(Uloc), hNatural(Tp1, Ta, true));
      const hrTop = epsTop * hRad(Tp1, Tsky);

      M[0] = Ar * (CpHalf / dt + hTop + hrTop + Gpanel);
      M[1] = -Ar * Gpanel;
      b[0] = Ar * ((CpHalf / dt) * Tp1 + alphaTop * Ghi + hTop * Ta + hrTop * Tsky);

      M[5] = -Ar * Gpanel;
      M[6] = Ar * (CpHalf / dt + Gpanel + Gcontact);
      M[7] = -Ar * Gcontact;
      b[1] = Ar * (CpHalf / dt) * Tp2;

      M[11] = -Ar * Gcontact;
      M[12] = Ar * (Csteel / dt + Gcontact + Uin);
      M[14] = -Ar * Uin;
      b[2] = Ar * (Csteel / dt) * Tr;

      M[18] = 1; b[3] = Ta;
    } else {
      // mode === 'channel' (C: 110mm, Cp: 140mm)
      const hTop = mix(hForced(Uloc), hNatural(Tp1, Ta, true));
      const hrTop = epsTop * hRad(Tp1, Tsky);

      const beta = 1 / (Ta + K0);
      const dP = C.cpDelta * 0.5 * AIR.rho * Uloc * Uloc
        + AIR.rho * G_ACC * beta * Math.max(0, Tg - Ta) * (0.5 * gap + C.roofFall);
      vGap = Math.max(0.02, channelVelocity(dP, Dh, Lch, C.kEntryExit));
      const hch = channelH(vGap, Dh, Lch);
      const hBot = mix(hch, hNatural(Tp2, Tg, false));
      const hcR = mix(hch, hNatural(Tr, Tg, true));

      const Tside = Ta - (Ta - Tsky) * SVside;
      const hRs = epsEff * hRad(Tp2, Tr) * Frs;
      const hSideP = epsBot * hRad(Tp2, Tside) * SVside;
      const hSideR = epsR * hRad(Tr, Tside) * SVside;
      // 100% roof coverage: only diffuse radiation entering side openings reaches roof plate
      const Sroof = alphaR * (fDhi[j] * SVside);

      M[0] = Ar * (CpHalf / dt + hTop + hrTop + Gpanel);
      M[1] = -Ar * Gpanel;
      b[0] = Ar * ((CpHalf / dt) * Tp1 + alphaTop * Ghi + hTop * Ta + hrTop * Tsky);

      M[5] = -Ar * Gpanel;
      M[6] = Ar * (CpHalf / dt + Gpanel + hBot + hRs + hSideP);
      M[7] = -Ar * hRs;
      M[8] = -Ar * hBot;
      b[1] = Ar * ((CpHalf / dt) * Tp2 + hSideP * Tside);

      M[11] = -Ar * hRs;
      M[12] = Ar * (Csteel / dt + hcR + hRs + hSideR + Uin);
      M[13] = -Ar * hcR;
      M[14] = -Ar * Uin;
      b[2] = Ar * ((Csteel / dt) * Tr + Sroof + hSideR * Tside);

      const mcp = (AIR.rho * AIR.cp * vGap * gap * flowFrac) / Lch;
      const hSum = hBot + hcR;
      const Nn = hSum / mcp;
      const phiN = Nn < 1e-4 ? 2 : (1 - Math.exp(-Nn)) / (1 - (1 - Math.exp(-Nn)) / Nn);
      const Hv = mcp * phiN;
      M[16] = -hBot;
      M[17] = -hcR;
      M[18] = hSum + Hv;
      b[3] = Hv * Ta;
    }

    // Row 4: Room air energy balance (wall U=1.0 over 50.4 m², 0.5 ACH infiltration, floor adiabatic, 0 W gain)
    M[22] = -Ar * Uin;
    M[24] = Cin / dt + Ar * Uin + UAwall + UAinf;
    b[4] = (Cin / dt) * Tin + (UAwall + UAinf) * Ta + Qint;

    for (let k = 0; k < 5; k++) M4[k] = M[20 + k];
    const b4 = b[4];

    Mc.set(M); bc.set(b);
    solve5(M, b, x);
    let qac = 0;
    const acActive = acOn && hour > acStart && hour <= acEnd;
    if (acActive && x[4] > Tset) {
      for (let k = 0; k < 5; k++) Mc[20 + k] = 0;
      Mc[24] = 1; bc[4] = Tset;
      solve5(Mc, bc, x);
      let s = 0;
      for (let k = 0; k < 5; k++) s += M4[k] * x[k];
      qac = Math.max(0, b4 - s);
    }
    for (let k = 0; k < 5; k++) T[k] = x[k];
    if (n + 1 >= recStart) record(n + 1 - recStart, qac);
  }

  // ---------------- resample to 0.25 h grid (97 samples: 0.00..24.00)
  const hours = [];
  for (let i = 0; i <= 96; i++) hours.push(i * 0.25);
  const at = (arr, h) => {
    const x2 = h / dtH, i = Math.min(N - 1, Math.floor(x2)), f = x2 - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  };
  const forcingAt = (arr, h) => arr[Math.round(h / dtH) % N];

  const out = {
    hours,
    Ta: [], Tsky: [], ghi: [], dni: [], dhi: [],
    Tshade: [], TroofBot: [], Troof: [], TroofSun: [], TroofShade: [], TinsIn: [],
    Tgap: [], Tin: [], qRoof: [], qRoofW: [], qCoolW: [], gapVelocity: [],
  };
  for (const h of hours) {
    out.Ta.push(forcingAt(fTa, h));
    out.Tsky.push(forcingAt(fTsky, h));
    out.ghi.push(forcingAt(fGhi, h));
    out.dni.push(forcingAt(fDni, h));
    out.dhi.push(forcingAt(fDhi, h));
    out.Tshade.push(hasShade ? at(R.Ts, h) : NaN);
    const tb = at(R.TrBot, h);
    out.TroofBot.push(tb);
    out.Troof.push(tb);
    out.TroofSun.push(tb);
    out.TroofShade.push(tb);
    out.TinsIn.push(at(R.TinsIn, h));
    out.Tgap.push(at(R.Tg, h));
    out.Tin.push(at(R.Tin, h));
    const q = at(R.q, h);
    out.qRoof.push(q);
    out.qRoofW.push(q * Ar);
    out.qCoolW.push(at(R.qac, h));
    out.gapVelocity.push(at(R.v, h));
  }

  // ---------------- summary metrics over full-resolution 24h output
  let TroofBotMax = -Infinity, TroofMaxHour = 0, TinMax = -Infinity, TshadeMax = hasShade ? -Infinity : NaN;
  let roofJ = 0, coolJ = 0, peakCoolW = 0, vSum = 0;
  for (let k = 1; k <= N; k++) {
    if (R.TrBot[k] > TroofBotMax) { TroofBotMax = R.TrBot[k]; TroofMaxHour = k * dtH; }
    if (R.Tin[k] > TinMax) TinMax = R.Tin[k];
    if (hasShade && R.Ts[k] > TshadeMax) TshadeMax = R.Ts[k];
    roofJ += Math.max(0, R.q[k]) * Ar * dt;
    coolJ += R.qac[k] * dt;
    if (R.qac[k] > peakCoolW) peakCoolW = R.qac[k];
    vSum += R.v[k];
  }
  out.summary = {
    TroofBotMax,
    TroofMax: TroofBotMax,
    TroofMaxHour: TroofMaxHour % 24,
    TinMax,
    TshadeMax,
    roofHeatKWh: roofJ / 3.6e6,
    coolingKWh: coolJ / 3.6e6,
    peakCoolW,
    gapVelocityMean: vSum / N,
  };
  out.meta = { mode, gap, Uin, Frs, Dh, flowFrac, insMm };
  return out;
}

/** Convenience helper: runs both AC OFF and AC ON (08:00–18:00) under identical conditions. */
export function simulatePair(opts) {
  const baseInterior = { ...INTERIOR, ...(opts.interior || {}) };
  const off = simulateDay({ ...opts, interior: { ...baseInterior, acOn: false } });
  const on = simulateDay({ ...opts, interior: { ...baseInterior, acOn: true } });
  return { off, on };
}

/** Linear interpolation of a ThermalResult at a local hour (0..24). */
export function sampleAt(result, hour) {
  const hs = result.hours;
  const n = hs.length;
  let h = Number.isFinite(hour) ? hour : 0;
  if (h < 0 || h > 24) h = ((h % 24) + 24) % 24;
  h = clamp(h, hs[0], hs[n - 1]);
  const step = hs[1] - hs[0];
  const i = Math.min(n - 2, Math.max(0, Math.floor(h / step)));
  const f = clamp((h - hs[i]) / step, 0, 1);
  const lerp = (a) => (a ? a[i] * (1 - f) + a[i + 1] * f : NaN);
  return {
    Ta: lerp(result.Ta),
    Tsky: lerp(result.Tsky),
    ghi: lerp(result.ghi),
    dni: lerp(result.dni),
    dhi: lerp(result.dhi),
    Tshade: lerp(result.Tshade),
    TroofBot: lerp(result.TroofBot),
    Troof: lerp(result.Troof),
    TroofSun: lerp(result.TroofSun),
    TroofShade: lerp(result.TroofShade),
    TinsIn: lerp(result.TinsIn),
    Tgap: lerp(result.Tgap),
    Tin: lerp(result.Tin),
    qRoof: lerp(result.qRoof),
    qRoofW: lerp(result.qRoofW),
    qCoolW: lerp(result.qCoolW),
    gapVelocity: lerp(result.gapVelocity),
  };
}
