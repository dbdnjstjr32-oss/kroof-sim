// thermal.js — transient lumped RC model of the container roof, retrofit shade layer and room.
// Pure JS (no three.js). See docs/physics.md for every equation and parameter.
//
// Nodes (backward-Euler, linearised radiation, coefficients lagged one step):
//   0 Ts   shade layer (sheet / panel / net)                         [W, total over its area]
//   1 TrS  roof steel element receiving FULL direct beam (beamTrans=1) [W/m² of roof]
//   2 TrH  roof steel element receiving NO direct beam  (beamTrans=0)  [W/m² of roof]
//   3 Tg   gap air (quasi-steady: channel energy balance, or = Ta for open canopies)
//   4 Tin  room air + furnishings
// Area-average roof: Troof = TrH + bt·(TrS − TrH), bt = area-averaged direct-beam transmittance.

import { solarPosition, clearSkyIrradiance, ambientTemperature, skyTemperature } from './sun.js';
import { CONTAINER, ROOF, INTERIOR } from '../config.js';

const SIGMA = 5.670374e-8;
const K0 = 273.15;
const G_ACC = 9.81;
const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const KT_STEEL = 50 * 0.0012;   // W/K: in-plane conductance k·t of the 1.2 mm roof plate

// Supports inside the channel that cross the flow (rails / cross-bars / legs), per design:
// h = obstruction height (m), rows = effective number of rows crossed along the 3 m flow path.
// Not in config.js (engineering assumption, see docs/physics.md); design.thermal.obstruction overrides.
export const CHANNEL_OBSTRUCTIONS = {
  B: { h: 0.040, rows: 2.0 },    // Al rails 40×40 (lower rails across the flow)
  C: { h: 0.0486, rows: 1.5 },   // φ48.6 cross-bars ×3 (parallel or across depending on wind)
  E: { h: 0.030, rows: 1.0 },    // folded legs (posts, partly open)
  default: { h: 0.040, rows: 1.0 },
};

// Air at ~35 °C
const AIR = { rho: 1.15, cp: 1006, k: 0.0266, nu: 1.65e-5, Pr: 0.71 };

// Model constants (documented in docs/physics.md)
export const THERMAL_CONSTANTS = {
  steelRhoC: 7850 * 460,     // J/m³K
  insRhoC: 30000,            // J/m³K (EPS / glass wool ≈ 20–25 kg/m³)
  Rsi: 0.13,                 // m²K/W inside surface film (ceiling)
  roomCap: 500e3,            // J/K room air (≈48 kJ/K) + lining, floor, furniture
  wallAlpha: 0.5, wallHo: 17, groundAlbedo: 0.2,
  windExp: 0.25, zRoof: 3.0, // local wind at roof height: U = V10·(3/10)^0.25
  cpDelta: 0.3,              // wind-driven pressure-coefficient difference across a roof channel
  kEntryExit: 1.5,           // channel entry 0.5 + exit 1.0
  obstructionCd: 1.0,        // per row of rails/bars across the flow: K = Cd·β/(1−β)², β = h/gap
  roofFall: 0.03,            // m, camber/fall of the container roof (stack height)
  shelterSolid: 0.6,         // wind under an open solid canopy / free stream
  shelterNet: 0.85,          // wind at/under a porous net / free stream
  strandD: 0.004,            // m, knitted aluminet tape (cylinder-equivalent)
};
const C = THERMAL_CONSTANTS;

export const THERMAL_ASSUMPTIONS = [
  '집중정수 RC 열회로망: 차열층 · 지붕(직달부/그늘부) · 공기층 · 실내 5절점, 60초 후진오일러, 2일 예열 후 3일째 결과',
  '일사: NOAA 태양위치 + Hottel 청천 직달 / Liu–Jordan 확산 모델, 청명도는 직달(c²)을 확산(c)보다 크게 감쇠',
  '외기온도 05:30 최저 · 15:00 최고 코사인 곡선, 하늘온도 Berdahl–Martin (이슬점 ≈ 최저기온 − 1 °C, 청명도 보정)',
  '기존 지붕: 강판 1.2mm(열용량 ≈ 4.3 kJ/m²K), 방사율 0.9, 단열 k = 0.035 W/mK + 실내측 표면저항 0.13 m²K/W',
  '외부 대류: h = 2.8 + 3.0·V (지붕 높이 풍속, Watmuff) 와 자연대류 1.52·ΔT^⅓ 의 합성',
  '차열층: 상면 백색 α 0.25 · ε 0.88, 하면 은박 ε 0.05 → 지붕과 복사교환 ε_eff ≈ 0.05 (장파 복사 약 95 % 차단)',
  '8~15cm 채널(B·C·E): 풍압(ΔCp 0.3) + 부력으로 유속 계산, 마찰 f = max(96/Re, Blasius) + 레일·크로스바 막힘 손실, 입구영역 Nu, 공기 평균온도 상승 반영',
  '0.5~1m 개방형(A·D): 공기층 = 외기, 차광망은 개구율 τ(=1−차광률) 만큼 직달·확산·장파 통과, 가로챈 일사는 흡수:반사 = 0.15:0.65',
  '지붕 직달 비율은 3D 그림자 광선추적(없으면 캐노피 투영 기하), 하늘조망률은 평행 사각형 형태계수',
  '실내: 열용량 500 kJ/K, 벽 U 0.6(솔에어), 창 2.4 m² U 4.5 · SHGC 0.45, 바닥 U 0.5, 침기 0.8회/h, 내부발열 24시간 일정',
  '에어컨: 설정온도 유지에 필요한 현열부하 ÷ COP 3.0 = 소비전력 (잠열·제습·부분부하 효율 변화 미반영)',
  '미반영: 지붕 면내 열전도, 다중반사, 비·결로, 주변 그림자, 풍향별 유동 차이 — 설계안 상대비교용 추정치',
];

// ------------------------------------------------------------------ helpers

// Linearised radiative coefficient σ(T1²+T2²)(T1+T2) with temperatures in °C
function hRad(t1, t2) {
  const a = t1 + K0, b = t2 + K0;
  return SIGMA * (a * a + b * b) * (a + b);
}

// Forced convection on an exposed flat surface (Watmuff et al. 1977, per Duffie & Beckman)
const hForced = (U) => 2.8 + 3.0 * Math.max(0, U);

// Natural convection on a horizontal surface; hotFacingUp = unstable (hot up / cold down)
function hNatural(Tsurf, Tair, facingUp) {
  const dT = Tsurf - Tair;
  const ad = Math.abs(dT);
  if (ad < 1e-6) return 0;
  const unstable = facingUp ? dT > 0 : dT < 0;
  return unstable ? 1.52 * Math.cbrt(ad) : 0.7 * Math.pow(ad, 0.25);
}
// Mixed convection (Churchill-type cubic blending)
const mix = (hf, hn) => Math.cbrt(hf * hf * hf + hn * hn * hn);

// View factor between two parallel rectangles (arbitrary offsets) — Gross, Spindler & Hahne (1981)
function gFun(u, v, z) {
  const ruz = Math.sqrt(u * u + z * z), rvz = Math.sqrt(v * v + z * z);
  let s = 0;
  if (ruz > 0) s += v * ruz * Math.atan(v / ruz);
  if (rvz > 0) s += u * rvz * Math.atan(u / rvz);
  const r2 = u * u + v * v + z * z;
  if (r2 > 0) s -= 0.5 * z * z * Math.log(r2);
  return s / (2 * Math.PI);
}
/** F(1→2), rect1 = [x1,x2]×[y1,y2] at 0, rect2 = [xi1,xi2]×[eta1,eta2] at distance z. */
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

// Canopy footprint from coverFactor: uniform overhang o with (L+2o)(W+2o) = cf·L·W
function canopyDims(cf, L, W) {
  const a = 4, b = 2 * (L + W), c = L * W * (1 - cf);
  const o = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  return { Lc: Math.max(0.1, L + 2 * o), Wc: Math.max(0.1, W + 2 * o), overhang: o };
}

function overlap1D(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

// Channel flow: solve (K + f·L/Dh)·½ρV² = ΔP with f = max(96/Re, 0.316·Re^-0.25) → V = min(V_lam, V_turb)
function channelVelocity(dP, gap, Lch, K) {
  if (!(dP > 0)) return 0;
  const Dh = 2 * gap, rho = AIR.rho, nu = AIR.nu;
  const a = 0.5 * rho * K;
  const b = 0.5 * rho * (Lch / Dh) * 96 * nu / Dh;              // laminar: f·V² = 96ν/Dh · V
  const vLam = (-b + Math.sqrt(b * b + 4 * a * dP)) / (2 * a);
  const c = 0.5 * rho * (Lch / Dh) * 0.316 * Math.pow(Dh / nu, -0.25); // turbulent: c·V^1.75
  let v = Math.sqrt(dP / (a + c)) || vLam;                       // Newton on a v² + c v^1.75 = dP
  for (let i = 0; i < 12; i++) {
    const r = a * v * v + c * Math.pow(v, 1.75) - dP;
    const d = 2 * a * v + 1.75 * c * Math.pow(v, 0.75);
    const nv = v - r / d;
    v = nv > 1e-6 ? nv : v / 2;
    if (Math.abs(r) < 1e-9) break;
  }
  return Math.min(vLam, v);
}

// Channel heat-transfer coefficient (developing laminar, Shah–London type; Gnielinski turbulent + entrance)
function channelH(V, gap, Lch) {
  const Dh = 2 * gap;
  const Re = Math.max(1, V * Dh / AIR.nu);
  const Gz = Re * AIR.Pr * Dh / Lch;
  let Nu = 4.86 + 0.03 * Gz / (1 + 0.016 * Math.pow(Gz, 2 / 3));
  if (Re > 2300) {
    const f = Math.pow(0.79 * Math.log(Re) - 1.64, -2);
    const NuT = (f / 8) * (Re - 1000) * AIR.Pr / (1 + 12.7 * Math.sqrt(f / 8) * (Math.pow(AIR.Pr, 2 / 3) - 1))
      * (1 + Math.pow(Dh / Lch, 2 / 3));
    Nu = Math.max(Nu, NuT);
  }
  return Nu * AIR.k / Dh;
}

// Thin-strand (net) convection: Hilpert cross-flow cylinder + Churchill–Chu natural floor
function strandH(U, dT) {
  const d = C.strandD;
  const Re = Math.max(1, U * d / AIR.nu);
  const Nuf = (Re < 40 ? 0.911 * Math.pow(Re, 0.385) : 0.683 * Math.pow(Re, 0.466)) * Math.cbrt(AIR.Pr);
  const alphaT = AIR.nu / AIR.Pr;
  const Ra = G_ACC / (35 + K0) * Math.abs(dT) * d * d * d / (AIR.nu * alphaT);
  const Nun = Math.pow(0.6 + 0.387 * Math.pow(Ra, 1 / 6) / Math.pow(1 + Math.pow(0.559 / AIR.Pr, 9 / 16), 8 / 27), 2);
  return mix(Nuf, Nun) * AIR.k / d;
}

// 5×5 dense solve, Gaussian elimination with partial pivoting (in place)
function solve5(M, b, x) {
  const n = 5;
  for (let c = 0; c < n; c++) {
    let p = c, mx = Math.abs(M[c * n + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r * n + c]); if (v > mx) { mx = v; p = r; } }
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

// ------------------------------------------------------------------ main entry

/**
 * simulateDay(opts) → ThermalResult (see docs/CONTRACT.md §3.4)
 */
export function simulateDay(opts) {
  const {
    design, params = {}, site, dayOfYear: doy,
    weather = {}, roof = {}, interior = {}, shadeProfile,
    stepSec = 60, spinupDays = 2,
  } = opts;

  const Tmax = weather.Tmax ?? 35, Tmin = weather.Tmin ?? 26;
  const V10 = Math.max(0, weather.windSpeed ?? 1.5);
  const clearness = clamp(weather.clearness ?? 1, 0, 1.1);
  const alphaR = clamp(roof.alpha ?? ROOF.alpha, 0, 1);
  const epsR = clamp(roof.eps ?? ROOF.eps, 0.05, 1);
  const insMm = Math.max(0, roof.insulationMm ?? ROOF.insulationMm);
  const acOn = !!interior.acOn;
  const Tset = interior.setpoint ?? INTERIOR.setpoint;
  const Qint = interior.internalGainW ?? INTERIOR.internalGainW;
  const COP = Math.max(0.5, interior.acCOP ?? INTERIOR.acCOP);
  // room envelope: user overrides fall back to the config defaults
  const wallU = Math.max(0, interior.wallU ?? INTERIOR.wallU);
  const achInfil = Math.max(0, interior.achInfil ?? INTERIOR.achInfil);

  const th = design && design.thermal ? design.thermal : null;
  // Footprint L×W (6×3) carries the shade layer; the heated roof PLATE is the part inside the perimeter
  // top tube (CONTAINER.roofRect, 5.8×2.8) — the 100 mm tube shields the plate edges from low sun.
  const L = CONTAINER.L, W = CONTAINER.W;
  const RR = CONTAINER.roofRect;
  const Lr = RR.x1 - RR.x0, Wr = RR.z1 - RR.z0, Ar = Lr * Wr;
  const dt = stepSec;
  const N = Math.max(24, Math.round(86400 / dt));
  const dtH = 24 / N;

  // ---------------- roof & room constants
  const Rins = insMm / 1000 / ROOF.kIns;
  const Uin = 1 / (Rins + C.Rsi);                                   // roof node → room, W/m²K
  const Cr = C.steelRhoC * ROOF.steelThk + 0.5 * (insMm / 1000) * C.insRhoC;   // J/m²K
  const Uloc = V10 * Math.pow(C.zRoof / 10, C.windExp);

  const H = CONTAINER.roofY;                                        // wall height (m)
  const winTot = Math.max(0, interior.windowArea ?? INTERIOR.windowArea);
  const winRaw = { N: 0, E: 0, S: 0, W: 0 };
  for (const w of CONTAINER.windows || []) {
    const f = w.face === 'north' ? 'N' : w.face === 'south' ? 'S' : w.face === 'east' ? 'E' : 'W';
    winRaw[f] += Math.abs((w.x1 - w.x0) * (w.y1 - w.y0));
  }
  const rawSum = winRaw.N + winRaw.E + winRaw.S + winRaw.W || 1;
  const faces = [
    { az: 0, A: L * H, win: winTot * winRaw.N / rawSum },
    { az: 90, A: W * H, win: winTot * winRaw.E / rawSum },
    { az: 180, A: L * H, win: winTot * winRaw.S / rawSum },
    { az: 270, A: W * H, win: winTot * winRaw.W / rawSum },
  ];
  let UAwall = 0;
  for (const f of faces) { f.wall = Math.max(0, f.A - f.win); UAwall += wallU * f.wall; }
  const volume = Ar * INTERIOR.heightInside;
  const UAamb = INTERIOR.windowU * winTot + INTERIOR.floorU * Ar + achInfil * volume / 3600 * AIR.rho * AIR.cp;
  const Cin = C.roomCap;

  // ---------------- shade layer description
  const hasShade = !!th;
  const isNet = hasShade && th.layer === 'net';
  const channel = hasShade && th.ventilation === 'channel';
  const gapDef = design?.params?.gap?.default;
  const gap = Math.max(0.01, Number.isFinite(params.gap) ? params.gap : (Number.isFinite(gapDef) ? gapDef : 0.1));
  let tau = hasShade ? (th.tau ?? 0) : 1;
  if (isNet && Number.isFinite(params.shade)) tau = 1 - params.shade;
  tau = clamp(tau, 0, 1);
  const phi = hasShade ? (isNet ? 1 - tau : 1) : 0;                // opaque (strand) fraction of the layer
  const cf = hasShade ? Math.max(0.05, th.coverFactor ?? 1) : 0;
  const As = cf * L * W;                                            // shade-layer plan area (cf is vs 6×3 footprint)
  const Cs = hasShade ? (th.arealHeatCap ?? 2000) * As : 1;
  const alphaTop = hasShade ? (th.alphaTop ?? 0.25) : 0;
  const epsTop = hasShade ? (th.epsTop ?? 0.88) : 0;
  const epsBot = hasShade ? (th.epsBottom ?? 0.1) : 0;
  const rhoSolar = hasShade ? (th.rhoSolar ?? (1 - alphaTop)) : 0;
  // Net: the shade rating is the TOTAL solar transmittance (τ + ρ + α = 1 at the rated shade), so the
  // intercepted part (1 − τ) is split between absorption and reflection in the ratio α : ρ.
  const alphaAbs = isNet ? alphaTop / Math.max(1e-6, alphaTop + rhoSolar) : alphaTop;   // per opaque area
  const epsEff = hasShade ? 1 / (1 / epsBot + 1 / epsR - 1) : 0;
  // Canopy footprint: explicit panel layout if the design has one (E), else uniform overhang from cf.
  const lay = design?.layout;
  const canopy = !hasShade ? null
    : (lay && lay.cols && lay.rows && lay.panelL && lay.panelW)
      ? { Lc: lay.cols * lay.panelL, Wc: lay.rows * lay.panelW, overhang: NaN }
      : canopyDims(cf, L, W);
  // part of the underside that lies above the roof plate (convects to the gap air)
  const Aov = hasShade ? Math.min(As, overlap1D(RR.x0, RR.x1, -canopy.Lc / 2, canopy.Lc / 2)
    * overlap1D(RR.z0, RR.z1, -canopy.Wc / 2, canopy.Wc / 2)) : 0;
  const Lch = hasShade ? Math.min(canopy.Wc, W) : W;                // channel flow length (across the width)
  // channel pressure-loss coefficient: entry/exit + blockage by supports
  const obs = (th && th.obstruction) || CHANNEL_OBSTRUCTIONS[design?.id] || CHANNEL_OBSTRUCTIONS.default;
  const beta = clamp(obs.h / gap, 0, 0.85);
  const kLoss = C.kEntryExit + obs.rows * C.obstructionCd * beta / ((1 - beta) * (1 - beta));

  // ---------------- shade profile (beamTrans(h), skyView)
  let Frs = 0, SV = 1;
  let btAt = null;               // (hour, sunDir) → area-averaged beam transmittance
  if (hasShade) {
    const FrsGeo = viewFactorParallel(
      { x0: RR.x0, x1: RR.x1, y0: RR.z0, y1: RR.z1 },
      { x0: -canopy.Lc / 2, x1: canopy.Lc / 2, y0: -canopy.Wc / 2, y1: canopy.Wc / 2 }, gap);
    let prof = null;
    if (typeof shadeProfile === 'function') {
      try {
        const hrs = [], bt = [], sv = [];
        for (let i = 0; i <= 96; i++) {
          const h = i * 0.25;
          const p = shadeProfile(h) || {};
          hrs.push(h);
          bt.push(Number.isFinite(p.beamTrans) ? clamp(p.beamTrans, 0, 1) : NaN);
          if (Number.isFinite(p.skyView)) sv.push(clamp(p.skyView, 0, 1));
        }
        if (bt.some(Number.isFinite)) {
          for (let i = 0; i < bt.length; i++) if (!Number.isFinite(bt[i])) bt[i] = tau;
          prof = { bt, sv: sv.length ? sv.reduce((a, c) => a + c, 0) / sv.length : NaN };
        }
      } catch (e) { prof = null; }
    }
    if (prof && Number.isFinite(prof.sv)) {
      SV = prof.sv;
      Frs = phi > 0.02 ? clamp((1 - SV) / phi, 0, 1) : FrsGeo;
    } else {
      Frs = FrsGeo;
      SV = 1 - Frs * phi;
    }
    if (prof) {
      btAt = (hour) => {
        const x = clamp(hour, 0, 24) / 0.25, i = Math.min(95, Math.floor(x)), f = x - i;
        return prof.bt[i] * (1 - f) + prof.bt[i + 1] * f;
      };
    } else {
      // Default: projected shadow of the canopy rectangle at height `gap` onto the roof
      btAt = (hour, dir) => {
        if (!dir || dir.y <= 0.01) return 1 - (1 - tau);
        const sx = -gap * dir.x / dir.y, sz = -gap * dir.z / dir.y;
        const ox = overlap1D(RR.x0, RR.x1, -canopy.Lc / 2 + sx, canopy.Lc / 2 + sx);
        const oz = overlap1D(RR.z0, RR.z1, -canopy.Wc / 2 + sz, canopy.Wc / 2 + sz);
        const fCov = (ox * oz) / Ar;
        return clamp(1 - fCov * (1 - tau), 0, 1);
      };
    }
  }
  const SVside = hasShade ? clamp(1 - Frs, 0, 1) : 1;              // open sides (near-horizon view)
  const SVnet = hasShade ? clamp(Frs * tau, 0, 1) : 0;             // through net openings (sky)

  // ---------------- per-step forcing for one periodic day
  // sky emissivity: Berdahl–Martin with Tdp ≈ Tmin − 1 °C, cloud/haze correction by clearness
  const Tdp = Tmin - 1;
  const fTa = new Float64Array(N), fTsky = new Float64Array(N), fDni = new Float64Array(N), fDhi = new Float64Array(N),
    fGhi = new Float64Array(N), fBh = new Float64Array(N), fBt = new Float64Array(N), fTsa = new Float64Array(N),
    fQwin = new Float64Array(N);
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
    const sinEl = Math.max(0, Math.sin(sp.elevation * D2R));
    fDni[j] = irr.dni; fDhi[j] = irr.dhi; fGhi[j] = irr.ghi; fBh[j] = irr.dni * sinEl;
    fBt[j] = hasShade ? (sp.elevation > 0 ? btAt(hour, sp.dir) : tau) : 1;
    // walls: sol-air per face (vertical: no long-wave correction), windows: SHGC
    const cosEl = Math.cos(sp.elevation * D2R);
    let sumUT = 0, qWin = 0;
    for (const f of faces) {
      const cosInc = sp.elevation > 0 ? cosEl * Math.cos((sp.azimuth - f.az) * D2R) : 0;
      const I = irr.dni * Math.max(0, cosInc) + 0.5 * irr.dhi + 0.5 * C.groundAlbedo * irr.ghi;
      sumUT += wallU * f.wall * (Ta + C.wallAlpha * I / C.wallHo);
      qWin += INTERIOR.shgc * f.win * I;
    }
    fTsa[j] = UAwall > 0 ? sumUT / UAwall : Ta;
    fQwin[j] = qWin;
  }

  // ---------------- state
  const T0 = (Tmin + Tmax) / 2;
  const T = new Float64Array([hasShade ? T0 : NaN, T0, T0, T0, acOn ? Tset : T0 + 2]);
  if (!hasShade) T[0] = T0;
  const M = new Float64Array(25), b = new Float64Array(5), x = new Float64Array(5);
  const Mc = new Float64Array(25), bc = new Float64Array(5), M4 = new Float64Array(5);
  let b4 = 0;

  const totalSteps = (Math.max(0, Math.round(spinupDays)) + 1) * N;
  const recStart = totalSteps - N;
  // recorded (full resolution) series of the last day: index 0..N
  const R = {
    Ts: new Float64Array(N + 1), TrS: new Float64Array(N + 1), TrH: new Float64Array(N + 1), Tr: new Float64Array(N + 1),
    Tg: new Float64Array(N + 1), Tin: new Float64Array(N + 1), q: new Float64Array(N + 1), acW: new Float64Array(N + 1),
    qac: new Float64Array(N + 1), v: new Float64Array(N + 1),
  };
  let vGap = 0;

  const record = (k, j, qac) => {
    const bt = fBt[j];
    const Tr = T[2] + bt * (T[1] - T[2]);
    R.Ts[k] = hasShade ? T[0] : NaN;
    R.TrS[k] = T[1]; R.TrH[k] = T[2]; R.Tr[k] = Tr; R.Tg[k] = T[3]; R.Tin[k] = T[4];
    R.q[k] = Uin * (Tr - T[4]);
    R.qac[k] = qac; R.acW[k] = qac / COP; R.v[k] = vGap;
  };

  if (recStart === 0) record(0, 0, 0);
  for (let n = 0; n < totalSteps; n++) {
    const j = (n + 1) % N;                       // forcing at the end of the step
    const Ta = fTa[j], Tsky = fTsky[j], Bh = fBh[j], Dhi = fDhi[j], Dni = fDni[j], bt = fBt[j];
    const wS = bt, wH = 1 - bt;
    const Ts = T[0], TrS = T[1], TrH = T[2], Tg = T[3], Tin = T[4];
    const Tside = Ta - (Ta - Tsky) * SVside;

    // --- convection & ventilation coefficients (lagged temperatures)
    let hRoofF, hBotF = 0, Hv = 0;
    if (!hasShade) {
      hRoofF = hForced(Uloc); vGap = Uloc;
    } else if (channel) {
      const beta = 1 / (Ta + K0);
      const dP = C.cpDelta * 0.5 * AIR.rho * Uloc * Uloc
        + AIR.rho * G_ACC * beta * Math.max(0, Tg - Ta) * (0.5 * gap + C.roofFall);
      vGap = Math.max(0.02, channelVelocity(dP, gap, Lch, kLoss));
      const hch = channelH(vGap, gap, Lch);
      hRoofF = hch; hBotF = hch;
    } else {
      vGap = Uloc * (isNet ? C.shelterNet : C.shelterSolid);
      hRoofF = hForced(vGap); hBotF = hForced(vGap);
    }
    // Channel designs: a sunlit patch can only exist at/outside the panel edges (gap ≤ 15 cm), so the
    // full-beam element is treated as exposed roof (whole sky, free-stream wind, no gap/shade coupling).
    const sunExposed = channel;
    const hcS = sunExposed ? mix(hForced(Uloc), hNatural(TrS, Ta, true)) : mix(hRoofF, hNatural(TrS, Tg, true));
    const hcH = mix(hRoofF, hNatural(TrH, Tg, true));

    // --- radiation coefficients
    const TsideS = sunExposed ? Tsky : Tside;
    const hSideS = epsR * hRad(TrS, TsideS) * (sunExposed ? 1 : SVside), hSideH = epsR * hRad(TrH, Tside) * SVside;
    const hNetS = sunExposed ? 0 : epsR * hRad(TrS, Tsky) * SVnet, hNetH = epsR * hRad(TrH, Tsky) * SVnet;
    const hRsS = hasShade && !sunExposed ? epsEff * hRad(TrS, Ts) * Frs * phi : 0;
    const hRsH = hasShade ? epsEff * hRad(TrH, Ts) * Frs * phi : 0;

    // --- solar on roof (per m²)
    const Idif = Dhi * SV;
    const SrS = alphaR * (Bh + (sunExposed ? Dhi : Idif)), SrH = alphaR * Idif;

    // --- lateral conduction in the 1.2 mm steel between sunlit strips and the shaded plate (solid layers).
    // Sunlit area bt·Ar lies in a strip of width ws along the sun-facing edges; the shaded plate acts as a
    // fin of length λ = √(k·t / h). Per m² of sunlit area G = k·t / (ws·(λ + ws/3)); energy-conserving
    // counterpart per m² of shaded area G·bt/(1 − bt).
    let gLatS = 0, gLatH = 0;
    if (hasShade && !isNet && bt < 0.999) {
      const hRef = Math.max(0.5, hcH + Uin + hSideH + hRsH + hNetH);
      const lam = Math.sqrt(KT_STEEL / hRef);
      const ws = Math.max(0.01, bt * Ar / (Lr + Wr));
      gLatS = KT_STEEL / (ws * (lam + ws / 3));
      gLatH = gLatS * bt / Math.max(0.05, 1 - bt);
    }

    M.fill(0); b.fill(0);
    // row 0: shade layer (W, total)
    if (hasShade) {
      const hrTop = epsTop * phi * hRad(Ts, Tsky);
      const Gsur = Math.max(0, As - Ar * Frs) * phi * epsBot * hRad(Ts, Ta);
      let gTop, gBotGap, gBotAmb;
      if (isNet) {
        gTop = As * 2 * phi * strandH(Uloc * C.shelterNet, Ts - Ta); gBotGap = 0; gBotAmb = 0;
      } else {
        const hTop = mix(hForced(Uloc), hNatural(Ts, Ta, true));
        const hBot = mix(hBotF, hNatural(Ts, Tg, false));
        const hBotO = mix(hForced(Uloc), hNatural(Ts, Ta, false));
        gTop = As * hTop; gBotGap = Aov * hBot; gBotAmb = (As - Aov) * hBotO;
      }
      M[0] = Cs / dt + As * hrTop + gTop + Ar * (wS * hRsS + wH * hRsH) + Gsur + gBotGap + gBotAmb;
      M[1] = -Ar * wS * hRsS; M[2] = -Ar * wH * hRsH; M[3] = -gBotGap;
      b[0] = Cs / dt * Ts + As * alphaAbs * phi * (Bh + Dhi) + As * hrTop * Tsky + (gTop + Gsur + gBotAmb) * Ta;
      // row 3: gap air (per m² roof)
      if (channel) {
        const hB = gBotGap / Ar;
        const mcp = AIR.rho * AIR.cp * vGap * gap / Lch;             // ṁ·cp per m² roof
        const hSum = wH * hcH + hB;
        const Nn = hSum / mcp;
        const phiN = Nn < 1e-4 ? 2 : (1 - Math.exp(-Nn)) / (1 - (1 - Math.exp(-Nn)) / Nn);
        Hv = mcp * phiN;
        M[15] = -hB; M[17] = -wH * hcH; M[18] = hSum + Hv;
        b[3] = Hv * Ta;
      } else { M[18] = 1; b[3] = Ta; }
    } else {
      M[0] = 1; b[0] = Ta;
      M[18] = 1; b[3] = Ta;
    }
    // rows 1, 2: roof elements (per m²)
    M[6] = Cr / dt + hSideS + hNetS + hRsS + hcS + Uin + gLatS;
    M[5] = -hRsS; M[7] = -gLatS; M[9] = -Uin;
    if (sunExposed) b[1] = Cr / dt * TrS + SrS + hSideS * TsideS + hcS * Ta;
    else { M[8] = -hcS; b[1] = Cr / dt * TrS + SrS + hSideS * TsideS + hNetS * Tsky; }
    M[12] = Cr / dt + hSideH + hNetH + hRsH + hcH + Uin + gLatH;
    M[10] = -hRsH; M[11] = -gLatH; M[13] = -hcH; M[14] = -Uin;
    b[2] = Cr / dt * TrH + SrH + (hSideH * Tside) + hNetH * Tsky;
    // row 4: room (W)
    M[24] = Cin / dt + Ar * Uin + UAwall + UAamb;
    M[21] = -Ar * Uin * wS; M[22] = -Ar * Uin * wH;
    b[4] = Cin / dt * Tin + UAwall * fTsa[j] + UAamb * Ta + fQwin[j] + Qint;
    for (let k = 0; k < 5; k++) M4[k] = M[20 + k];
    b4 = b[4];

    Mc.set(M); bc.set(b);
    solve5(M, b, x);
    let qac = 0;
    if (acOn && x[4] > Tset) {
      for (let k = 0; k < 5; k++) Mc[20 + k] = 0;
      Mc[24] = 1; bc[4] = Tset;
      solve5(Mc, bc, x);
      let s = 0;
      for (let k = 0; k < 5; k++) s += M4[k] * x[k];
      qac = Math.max(0, b4 - s);
    }
    for (let k = 0; k < 5; k++) T[k] = x[k];
    if (n + 1 >= recStart) record(n + 1 - recStart, j, qac);
  }

  // ---------------- resample to 0.25 h grid
  const hours = [];
  for (let i = 0; i <= 96; i++) hours.push(i * 0.25);
  const at = (arr, h) => {
    const x2 = h / dtH, i = Math.min(N - 1, Math.floor(x2)), f = x2 - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  };
  const forcingAt = (arr, h) => { const jj = Math.round(h / dtH) % N; return arr[jj]; };
  const out = {
    hours, Ta: [], Tsky: [], ghi: [], dni: [], dhi: [], Tshade: [], TroofSun: [], TroofShade: [], Troof: [],
    Tgap: [], Tin: [], qRoof: [], qRoofW: [], acW: [], gapVelocity: [], beamTrans: [],
  };
  for (const h of hours) {
    out.Ta.push(forcingAt(fTa, h)); out.Tsky.push(forcingAt(fTsky, h));
    out.ghi.push(forcingAt(fGhi, h)); out.dni.push(forcingAt(fDni, h)); out.dhi.push(forcingAt(fDhi, h));
    out.beamTrans.push(forcingAt(fBt, h));
    out.Tshade.push(hasShade ? at(R.Ts, h) : NaN);
    out.TroofSun.push(at(R.TrS, h)); out.TroofShade.push(at(R.TrH, h)); out.Troof.push(at(R.Tr, h));
    out.Tgap.push(at(R.Tg, h)); out.Tin.push(at(R.Tin, h));
    const q = at(R.q, h);
    out.qRoof.push(q); out.qRoofW.push(q * Ar);
    out.acW.push(at(R.acW, h)); out.gapVelocity.push(at(R.v, h));
  }

  // ---------------- summary (full resolution, last day)
  let TroofMax = -Infinity, TroofMaxHour = 0, TinMax = -Infinity, TshadeMax = hasShade ? -Infinity : NaN, TroofSunMax = -Infinity;
  let roofJ = 0, coolJ = 0, peakAc = 0, vSum = 0;
  for (let k = 1; k <= N; k++) {
    if (R.Tr[k] > TroofMax) { TroofMax = R.Tr[k]; TroofMaxHour = k * dtH; }
    if (R.Tin[k] > TinMax) TinMax = R.Tin[k];
    if (R.TrS[k] > TroofSunMax) TroofSunMax = R.TrS[k];
    if (hasShade && R.Ts[k] > TshadeMax) TshadeMax = R.Ts[k];
    roofJ += Math.max(0, R.q[k]) * Ar * dt;
    coolJ += R.qac[k] * dt;
    if (R.acW[k] > peakAc) peakAc = R.acW[k];
    vSum += R.v[k];
  }
  out.summary = {
    TroofMax, TroofMaxHour: TroofMaxHour % 24, TinMax, TshadeMax,
    roofHeatKWh: roofJ / 3.6e6, coolingKWh: coolJ / 3.6e6, acKWh: coolJ / 3.6e6 / COP, peakAcW: peakAc,
    TroofSunMax, gapVelocityMean: vSum / N,
  };
  out.meta = { tau, skyView: SV, Frs, Uin, gap, channel, isNet, canopy, kLoss: channel ? kLoss : 0 };
  return out;
}

/** Linear interpolation of a ThermalResult at a local hour (0..24). */
export function sampleAt(result, hour) {
  const hs = result.hours;
  const n = hs.length;
  let h = Number.isFinite(hour) ? hour : 0;
  if (h < 0 || h > 24) h = ((h % 24) + 24) % 24;
  h = clamp(h, hs[0], hs[n - 1]);
  const step = hs[1] - hs[0];
  let i = Math.min(n - 2, Math.max(0, Math.floor(h / step)));
  const f = clamp((h - hs[i]) / step, 0, 1);
  const lerp = (a) => (a ? a[i] * (1 - f) + a[i + 1] * f : NaN);
  return {
    Ta: lerp(result.Ta), Troof: lerp(result.Troof), TroofSun: lerp(result.TroofSun), TroofShade: lerp(result.TroofShade),
    Tshade: lerp(result.Tshade), Tgap: lerp(result.Tgap), Tin: lerp(result.Tin), qRoof: lerp(result.qRoof),
    ghi: lerp(result.ghi), acW: lerp(result.acW), gapVelocity: lerp(result.gapVelocity),
    Tsky: lerp(result.Tsky), dni: lerp(result.dni), dhi: lerp(result.dhi), qRoofW: lerp(result.qRoofW),
    beamTrans: lerp(result.beamTrans),
  };
}
