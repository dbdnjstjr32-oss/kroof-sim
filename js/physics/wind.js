// wind.js — wind uplift check of each retrofit design's load path (stage by stage).
// Pure JS (no three.js). Units: m/s, Pa, N. See docs/physics.md §3.
//
//   q = ½ρV²                          (V = 3-s gust at roof height, from the UI slider)
//   uplift = q·Cp,uplift·A_plan        drag = q·Cp,drag·A_side        weight = m·g
//   stage capacity R_i = Σ n·R_item·η  (η = 0.75 when n > 4 fasteners share the load, else 1.0)
//   SF_i = (R_i + W_above,i) / uplift  → SF = min_i SF_i (governing stage)
//   critical gust V_cr: SF = 1  →  V_cr = √( 2·min_i(R_i + W_above,i) / (ρ·Cp,uplift·A_plan) )

const G = 9.81;
export const RHO_AIR = 1.225;
export const AL_SPECIFIC_HEAT = 900;       // J/kgK — used to back out the top-layer mass from arealHeatCap
export const SHARING_ETA = { many: 0.75, few: 1.0, fewMax: 4 };
export const STRAP_LEGS = 2, STRAP_FACTOR = 0.5;

export const WIND_ASSUMPTIONS = [
  '속도압 q = ½ρV² (ρ = 1.225 kg/m³), V = 지붕 높이 3초 순간풍속(슬라이더 값)',
  '양력 = q × Cp,uplift × 평면적, 항력 = q × Cp,drag × 측면적 — 풍력계수는 태양광 거치대·캐노피 문헌을 참고한 가정값이며 실측·풍동 자료로 교체 필요',
  '차광망(D)은 다공성(개구율)을 이미 반영한 Cp를 그대로 사용',
  '하중경로 단계별 내력 = Σ 개수 × 1개 내력 × η (불균등 분담계수: 4개 초과 0.75, 4개 이하 1.0)',
  '단계 안전율 = (단계 내력 + 그 단계 위 자중) / 양력, 전체 안전율 = 최솟값(지배 단계), 한계풍속 = 안전율 1.0이 되는 순간풍속',
  '자중 배분: 상판 질량 = 상판 열용량 ÷ Al 비열(900 J/kgK)로 추정, 중간 단계는 전체 자중까지 선형 배분 (하중계수 미적용)',
  '라쳇 스트랩(C): 1본 내력 = LC(kN) × 2가닥 × 0.5(각도·불균등)',
  '판정: 1.5 이상 적합 · 1.0~1.5 주의 · 1.0 미만 부적합 — 실제 설치 전 KDS 41 12 00(건축구조기준 풍하중)의 설계풍속·가스트영향계수·국부 풍압계수로 재검토 필요',
  '타프형(D): 번지볼이 먼저 풀려 망만 이탈 — 폴·컨테이너 손상 방지(퓨즈 역할)',
  '항력(수평력)은 표시만 하며 클램프 마찰·전단은 충분하다고 가정, 피로·반복하중·부식·컨테이너 자체 전도/활동은 미검토',
];

/** Velocity pressure q = ½ρV² (Pa). */
export function velocityPressure(V, rho = RHO_AIR) {
  const v = Number.isFinite(V) ? Math.max(0, V) : 0;
  return 0.5 * rho * v * v;
}

function statusOf(sf) {
  return sf >= 1.5 ? 'ok' : sf >= 1.0 ? 'warn' : 'fail';
}

// Effective capacity of one load-path item (N per piece) and the sharing factor used.
function itemCapacity(item, params, capScale = 1) {
  let cap = item.capacityN;
  if (item.fromParam === 'strapLC') {
    const lcKN = Number.isFinite(params?.strapLC) ? params.strapLC : null;
    if (lcKN !== null) cap = lcKN * 1000 * STRAP_LEGS * STRAP_FACTOR;
  }
  cap *= capScale;   // user derating (ageing / corrosion) or reinforcement
  const eta = item.count > SHARING_ETA.fewMax ? SHARING_ETA.many : SHARING_ETA.few;
  return { perItemN: cap, eta, totalN: item.count * cap * eta };
}

// Self weight above each stage (N). Stage 0 carries only the top layer; the last carries everything.
function weightsAbove(design) {
  const w = design.wind;
  const Wtot = (w.selfWeightKg || 0) * G;
  const th = design.thermal;
  let topKg = th && th.arealHeatCap ? (th.arealHeatCap / AL_SPECIFIC_HEAT) * (w.planArea || 0) : 0.5 * (w.selfWeightKg || 0);
  topKg = Math.min(topKg, w.selfWeightKg || 0);
  const Wtop = topKg * G;
  const n = w.loadPath.length;
  return w.loadPath.map((st, i) => {
    if (Number.isFinite(st.weightAboveKg)) return st.weightAboveKg * G;
    return n <= 1 ? Wtot : Wtop + (Wtot - Wtop) * (i / (n - 1));
  });
}

/**
 * windCheck(design, { V, params, capScale = 1, cpScale = 1 }) → { V, q, upliftN, dragN, weightN, stages, sf, governing, criticalV, status }
 * capScale multiplies every fastener capacity; cpScale multiplies the uplift pressure coefficient.
 */
export function windCheck(design, { V = 0, params = {}, capScale = 1, cpScale = 1 } = {}) {
  const Vs = Number.isFinite(V) ? Math.max(0, V) : 0;
  const q = velocityPressure(Vs);
  if (!design || !design.wind) {
    return { V: Vs, q, upliftN: 0, dragN: 0, weightN: 0, stages: [], sf: Infinity, governing: '—', criticalV: Infinity, status: 'ok' };
  }
  const w = design.wind;
  const cpUp = w.cpUplift * (Number.isFinite(cpScale) ? Math.max(0.01, cpScale) : 1);
  const capK = Number.isFinite(capScale) ? Math.max(0, capScale) : 1;
  const upliftN = q * cpUp * w.planArea;
  const dragN = q * (w.cpDrag || 0) * (w.sideArea || 0);
  const weightN = (w.selfWeightKg || 0) * G;
  const wAbove = weightsAbove(design);

  let sf = Infinity, governing = w.loadPath[0]?.stage ?? '—', minResist = Infinity;
  const stages = w.loadPath.map((st, i) => {
    const items = st.items.map((it) => {
      const c = itemCapacity(it, params, capK);
      return { name: it.name, count: it.count, capacityN: c.perItemN, eta: c.eta, totalN: c.totalN };
    });
    const capacityN = items.reduce((a, it) => a + it.totalN, 0);
    const resist = capacityN + wAbove[i];
    const sfi = upliftN > 0 ? resist / upliftN : Infinity;
    if (resist < minResist) { minResist = resist; governing = st.stage; }
    if (sfi < sf) sf = sfi;
    return { stage: st.stage, capacityN, demandN: upliftN, weightAboveN: wAbove[i], netDemandN: Math.max(0, upliftN - wAbove[i]), sf: sfi, items };
  });
  // governing stage is independent of V (all stages see the same uplift)
  const k = 0.5 * RHO_AIR * cpUp * w.planArea;
  const criticalV = k > 0 && Number.isFinite(minResist) ? Math.sqrt(minResist / k) : Infinity;
  const out = { V: Vs, q, upliftN, dragN, weightN, stages, sf, governing, criticalV, status: statusOf(sf) };
  if (w.fuseNote) out.fuseNote = w.fuseNote;
  return out;
}

/** Safety-factor curve for charts: V = step, 2·step, …, Vmax (V = 0 omitted because SF = ∞ there). */
export function sfCurve(design, params, Vmax = 50, step = 1, adj = {}) {
  const out = [];
  const s = step > 0 ? step : 1;
  for (let V = s; V <= Vmax + 1e-9; V += s) {
    const r = windCheck(design, { V, params, capScale: adj.capScale, cpScale: adj.cpScale });
    out.push({ V: Math.round(V * 1000) / 1000, sf: r.sf });
  }
  return out;
}
