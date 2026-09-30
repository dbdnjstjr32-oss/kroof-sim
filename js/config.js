// config.js — single source of truth shared by every module.
// Pure data: must NOT import three.js (physics modules and Node tests import this file).
//
// Coordinate system (meters):  +x = East, +y = Up, +z = South (so -z = North).
// Container-local origin = centre of the container footprint at ground level (y = 0).
// The container's long axis runs along x (E–W), so its long faces look North (-z) and South (+z).

// ---------------------------------------------------------------- site / weather
export const SITES = [
  { id: 'seoul',   name: '서울', lat: 37.5665, lon: 126.9780, tz: 9 },
  { id: 'daejeon', name: '대전', lat: 36.3504, lon: 127.3845, tz: 9 },
  { id: 'gwangju', name: '광주', lat: 35.1595, lon: 126.8526, tz: 9 },
  { id: 'busan',   name: '부산', lat: 35.1796, lon: 129.0756, tz: 9 },
  { id: 'jeju',    name: '제주', lat: 33.4996, lon: 126.5312, tz: 9 },
];

// Tmax/Tmin in °C, windSpeed = mean wind at 10 m (m/s) used for convection,
// clearness = multiplier on clear-sky irradiance (1 = perfectly clear).
export const WEATHER_PRESETS = [
  { id: 'heatwave', name: '폭염 (7월 말)',  month: 7, day: 25, Tmax: 35.0, Tmin: 26.0, windSpeed: 1.5, clearness: 0.95 },
  { id: 'august',   name: '8월 평년',       month: 8, day: 10, Tmax: 31.5, Tmin: 24.0, windSpeed: 2.0, clearness: 0.85 },
  { id: 'june',     name: '하지 (6월 21일)', month: 6, day: 21, Tmax: 29.0, Tmin: 19.0, windSpeed: 2.5, clearness: 0.90 },
  { id: 'sept',     name: '9월 늦더위',     month: 9, day: 10, Tmax: 30.0, Tmin: 21.0, windSpeed: 2.0, clearness: 0.90 },
];

// Reference lines for the wind-load slider (3-s gust at roof height, m/s). KMA warning criteria.
export const WIND_MARKERS = [
  { V: 14, label: '강풍주의보 (평균 14)' },
  { V: 20, label: '강풍주의보 (순간 20)' },
  { V: 26, label: '강풍경보 (순간 26)' },
  { V: 33, label: '태풍 "강" (33)' },
  { V: 44, label: '태풍 "매우 강" (44)' },
];

// ---------------------------------------------------------------- the container rest room
// "컨테이너 휴게실 3×6m (지붕 1.2T 강판, 상부 테두리 각관, 인양고리)" — from the source document.
export const CONTAINER = {
  L: 6.0,                 // length along x (m)
  W: 3.0,                 // width along z (m)
  wallTopY: 2.52,         // top of wall panels = underside of the perimeter top tube
  roofY: 2.60,            // TOP SURFACE of the 1.2T roof steel plate (the surface that heats up)
  roofThk: 0.0012,        // 1.2 mm (draw it ≥ 5 mm thick so it renders)
  // Perimeter top square tube (상부 테두리 각관) 100×100, outer faces flush with the walls.
  // It runs around the roof edge; its top is 20 mm above the roof plate (a small lip).
  frameTube: { size: 0.10, bottomY: 2.52, topY: 2.62, innerX: 2.90, innerZ: 1.40 },
  cornerPost: 0.15,       // corner post section 150×150 (x/z extents ±3.0/±1.5 outer)
  // Lifting rings (인양고리) at the 4 top corners, standing on the frame-tube corners.
  // Each ring: vertical ring rotated 45° to face diagonally outward (ring-plane normal ∥ (sign x, 0, sign z)),
  // centre (x, ringCenterY, z). This matches container.js.
  liftingRings: [
    { x: -2.93, z: -1.43 }, { x: 2.93, z: -1.43 },
    { x: 2.93, z: 1.43 },   { x: -2.93, z: 1.43 },
  ],
  ringBaseY: 2.62, ringCenterY: 2.685, ringR: 0.040, ringBarR: 0.011,
  // Roof area actually exposed (inside the frame tube) — used for shading/heat-map sampling.
  roofRect: { x0: -2.90, x1: 2.90, z0: -1.40, z1: 1.40, y: 2.60 },
  // Openings (container agent draws them; designs don't care).
  door:    { face: 'south', x0: 1.30, x1: 2.20, y0: 0.10, y1: 2.10 },
  windows: [
    { face: 'south', x0: -2.30, x1: -0.90, y0: 1.00, y1: 2.00 },
    { face: 'north', x0: -0.70, x1: 0.70,  y0: 1.00, y1: 2.00 },
  ],
  acUnit: { face: 'east', z: -0.5 },   // outdoor AC condenser on the east end wall
};

// Existing roof & interior (baseline, shared by every design)
export const ROOF = {
  alpha: 0.70,           // solar absorptance of the existing weathered painted steel roof
  eps: 0.90,             // thermal emissivity of the existing roof
  steelThk: 0.0012,
  insulationMm: 50,      // insulation under the roof plate (EPS/glass wool), 0 = bare steel
  kIns: 0.035,           // W/mK
};
export const INTERIOR = {
  heightInside: 2.35,
  setpoint: 26,          // °C, AC setpoint
  internalGainW: 350,    // people resting + fridge/kettle (W)
  achInfil: 0.8,         // infiltration air changes per hour
  wallU: 0.60,           // W/m²K, sandwich-panel walls
  floorU: 0.50,
  windowArea: 2.4,       // m² total
  windowU: 4.5,
  shgc: 0.45,
  acCOP: 3.0,
};

// ---------------------------------------------------------------- design options A–E
// Design colours: Okabe–Ito palette (distinguishable under common colour-vision deficiencies).
// meta.* comes straight from the source document (Kroof_design_options, pp. 3–7).
// thermal.* and wind.* are ENGINEERING ASSUMPTIONS made for this simulation (not in the doc);
// the UI must label them '가정값'.
export const DESIGNS = {
  A: {
    id: 'A', color: '#e69f00',
    name: '비계 캐노피형', tagline: '현장 비계 파이프로 그늘 프레임 짜기',
    analogy: '공사장 비계·글램핑 텐트 프레임',
    description: '인양고리에 결속한 기둥 4~8개 위에 강관을 클램프로 직교 조립하고, 그 위에 무광 백색 알루미늄 골판(하면 은박) 또는 차광망을 얹는다. 공기층이 0.5~1m로 커서 "이중지붕"보다 "그늘막"에 가깝다.',
    gapText: '공기층 0.5~1m (그늘막형, 완전 개방)',
    meta: { partKinds: 4, weightKg: [120, 140], costManwon: [25, 35], installMin: [90, 120], crew: 2, toolsFree: false },
    callouts: [
      { n: 1, text: '상판: 알루미늄 골판 0.7mm', sub: '무광 백색 차열도장, 하면 은박' },
      { n: 2, text: '고정 클램프 φ48.6 (직교)' },
      { n: 3, text: '비계 강관 6m·3m' },
      { n: 4, text: '기둥 0.5~1m + 베이스판', sub: '인양고리에 U볼트 결속' },
    ],
    params: { gap: { min: 0.5, max: 1.0, step: 0.05, default: 0.8, label: '공기층(기둥 높이)', unit: 'm' } },
    thermal: {
      layer: 'solid', ventilation: 'open',
      tau: 0.0,            // solar transmittance of the shade layer
      alphaTop: 0.25,      // matte white heat-shield paint (aged)
      epsTop: 0.88, epsBottom: 0.05,   // underside silver foil
      arealHeatCap: 1950,  // J/m²K — Al 0.7 mm corrugated (×1.15 developed length)
      coverFactor: 1.2,    // shade-layer plan area / roof area (overhang 6.4×3.4 over 6×3)
    },
    wind: {
      model: 'canopy', cpUplift: 1.2, cpDrag: 0.3,
      planArea: 21.8, sideArea: 6.4 * 0.15,
      selfWeightKg: 130,
      loadPath: [
        { stage: '상판 → 강관', items: [{ name: '골판 후크볼트', count: 32, capacityN: 900 }] },
        { stage: '강관 프레임 조립', items: [{ name: '직교 클램프', count: 20, capacityN: 5000 }] },
        { stage: '기둥 → 컨테이너', items: [
          { name: 'U볼트 (인양고리)', count: 4, capacityN: 8000 },
          { name: '빔클램프 (각관, 중간 기둥)', count: 4, capacityN: 3000 },
        ] },
      ],
    },
  },

  B: {
    id: 'B', color: '#0072b2',
    name: '태양광 레일형', tagline: '태양광 패널 다는 방식 그대로',
    analogy: '건물 옥상의 태양광 모듈 거치대',
    description: '알루미늄 레일을 스탠드오프로 8~10cm 띄워 깔고, 프레임을 두른 반사 패널을 미드/엔드 클램프로 끼운다. 태양광 업계 부품·풍하중 설계 관행을 그대로 가져올 수 있다.',
    gapText: '공기층 8~10cm (문헌 최적)',
    meta: { partKinds: 5, weightKg: [65, 135], costManwon: [30, 90], installMin: [120, 180], crew: 2, toolsFree: false },
    callouts: [
      { n: 1, text: '미드/엔드 클램프 (825원~)' },
      { n: 2, text: '프레임 있는 반사 패널 4장' },
      { n: 3, text: 'Al 레일 40×40 (0.85kg/m)', sub: '+ 스탠드오프로 공기층 8~10cm' },
      { n: 4, text: 'L-피트: 상부 각관에 빔클램프', sub: '또는 인양고리 볼트 (무천공)' },
    ],
    // stack = EPDM pad 5 mm + lower rail 40 + standoff ≥ 5 + upper rail 40 → gap ≥ 0.09
    params: { gap: { min: 0.09, max: 0.15, step: 0.01, default: 0.09, label: '공기층(스탠드오프)', unit: 'm' } },
    thermal: {
      layer: 'solid', ventilation: 'channel',
      tau: 0.0, alphaTop: 0.25, epsTop: 0.88, epsBottom: 0.10,
      arealHeatCap: 4000,  // framed composite reflective panel
      coverFactor: 1.0,
    },
    wind: {
      model: 'rooftopPanel', cpUplift: 1.2, cpDrag: 0.2,
      planArea: 17.6, sideArea: 6.0 * 0.15,
      selfWeightKg: 100,
      loadPath: [
        { stage: '패널 → 레일', items: [{ name: '미드/엔드 클램프', count: 16, capacityN: 2000 }] },
        { stage: '레일 ↔ 스탠드오프', items: [{ name: '스탠드오프 볼트', count: 12, capacityN: 4000 }] },
        { stage: '레일 → 컨테이너', items: [
          { name: 'L-피트 빔클램프 (각관)', count: 6, capacityN: 2500 },
          { name: 'L-피트 인양고리 볼트', count: 4, capacityN: 6000 },
        ] },
      ],
    },
  },

  C: {
    id: 'C', color: '#cc79a7',
    name: '크로스바·라쳇 스트랩형', tagline: '루프랙 + 이삿짐 끈',
    analogy: '자동차 루프랙 + 트럭 화물 결박 라쳇 스트랩',
    description: '자동차 루프랙처럼 상부 각관에 ㄷ자 브래킷을 걸쳐 크로스바 3본을 올리고, 1×6m 반사 골판 3장을 얹은 뒤 라쳇 스트랩으로 인양고리에 눌러 묶는다. 공구가 필요 없다.',
    gapText: '공기층 = 크로스바 높이 8~10cm',
    meta: { partKinds: 4, partKindsText: '3~4', weightKg: [75, 75], costManwon: [15, 20], installMin: [30, 45], crew: 2, toolsFree: true },
    callouts: [
      { n: 1, text: '반사 패널(골판) 1×6m 3장', sub: '무광 백색 상면, 은박 하면' },
      { n: 2, text: '라쳇 스트랩 50mm 4본', sub: '(LC 4~20kN급) → 인양고리 결박' },
      { n: 3, text: '크로스바 φ48.6 3m 3본' },
      { n: 4, text: 'ㄷ자 브래킷: 상부 각관에 걸침' },
    ],
    params: {
      gap: { min: 0.07, max: 0.12, step: 0.01, default: 0.09, label: '공기층(크로스바 높이)', unit: 'm' },   // bar must clear the tube lip
      strapLC: { min: 4, max: 20, step: 1, default: 4, label: '스트랩 LC', unit: 'kN' },
    },
    thermal: {
      layer: 'solid', ventilation: 'channel',
      tau: 0.0, alphaTop: 0.25, epsTop: 0.88, epsBottom: 0.05,
      arealHeatCap: 1950, coverFactor: 1.0,
    },
    wind: {
      model: 'rooftopPanel', cpUplift: 1.2, cpDrag: 0.2,
      planArea: 18.0, sideArea: 6.0 * 0.12,
      selfWeightKg: 75,
      // Straps hold everything down; each strap has 2 legs. capacityN is per strap and is
      // replaced at run time by params.strapLC (kN → N) × 2 legs × 0.5 (angle/uneven-load factor).
      loadPath: [
        { stage: '골판 ← 스트랩 누름', items: [{ name: '라쳇 스트랩 (2가닥)', count: 4, capacityN: 4000, fromParam: 'strapLC' }] },
        { stage: '스트랩 → 인양고리', items: [{ name: '인양고리 (스트랩 후크)', count: 4, capacityN: 10000 }] },
      ],
    },
  },

  D: {
    id: 'D', color: '#009e73',
    name: '타프·차광막형', tagline: '캠핑 타프 + 농업 하우스 차광망',
    analogy: '캠핑 타프 + 농업 하우스 차광망',
    description: '캠핑 타프처럼 폴을 세우고 알루미늄 차광망(알루미넷)을 번지코드로 당겨 건다. 망이라 바람이 통과하고, 가장 가볍고 싸다.',
    gapText: '공기층 0.7~1m, 망이라 바람이 통과',
    meta: { partKinds: 4, weightKg: [20, 20], costManwon: [8, 15], installMin: [20, 30], crew: 2, toolsFree: false },
    callouts: [
      { n: 1, text: '알루미늄 차광망(알루미넷)', sub: '차광 70~90%, 3.5×6.5m' },
      { n: 2, text: '번지볼·후크 24개' },
      { n: 3, text: '폴 φ48.6 0.7~1m 6본' },
      { n: 4, text: '폴 하단: 인양고리·각관에', sub: 'U볼트 결속 + 가이라인 4개' },
    ],
    params: {
      gap: { min: 0.7, max: 1.0, step: 0.05, default: 0.85, label: '공기층(폴 높이)', unit: 'm' },
      shade: { min: 0.7, max: 0.9, step: 0.05, default: 0.8, label: '차광률', unit: '' },
    },
    thermal: {
      layer: 'net', ventilation: 'open',
      tau: 0.20,           // replaced at run time by 1 - params.shade
      rhoSolar: 0.65,      // aluminised knit reflects most of what it intercepts
      alphaTop: 0.15, epsTop: 0.35, epsBottom: 0.35,
      arealHeatCap: 150, coverFactor: 1.26,   // 3.5×6.5 over 3×6
    },
    wind: {
      model: 'porousNet', cpUplift: 0.35, cpDrag: 0.35, porosity: 0.3,
      planArea: 22.75, sideArea: 6.0 * 1.0 * 2 * 0.05,
      selfWeightKg: 20,
      loadPath: [
        { stage: '차광망 → 번지볼', items: [{ name: '번지볼·후크', count: 24, capacityN: 300 }] },
        { stage: '폴 → 컨테이너', items: [
          { name: 'U볼트 (인양고리/각관)', count: 6, capacityN: 5000 },
          { name: '가이라인', count: 4, capacityN: 2000 },
        ] },
      ],
      fuseNote: '번지볼이 먼저 풀려 망만 이탈 — 폴·컨테이너 손상 방지(퓨즈 역할)',
    },
  },

  E: {
    id: 'E', color: '#d55e00',
    name: '다리 달린 인터로킹 패널형', tagline: '조립식 매트처럼 맞물리는 패널을 공구 없이 얹는다',
    analogy: '조립식 바닥 매트·데크 타일',
    description: '패널 한 장(1.4×0.6m)에 8~10cm 다리를 일체로 절곡하고, 패널끼리 수·암 걸림턱으로 맞물려 한 판처럼 거동하게 한다. 가장자리만 퀵릴리즈 캠레버로 상부 각관에 잠근다.',
    gapText: '공기층 = 다리 높이 8~10cm',
    meta: { partKinds: 3, weightKg: [65, 65], costManwon: [30, 50], installMin: [30, 40], crew: 2, toolsFree: true },
    // NOTE: the document says "50장이 한 판처럼" but 1.4×0.6 m panels over a 6×3 m roof need
    // only ~20 (4 × 5); the 65 kg weight also matches ~20 panels of Al 1.0 mm. We model 4×5 = 20
    // and surface the discrepancy in the UI.
    layout: { cols: 4, rows: 5, panelL: 1.4, panelW: 0.6, docCount: 50 },
    callouts: [
      { n: 1, text: '패널 유닛 1.4×0.6m (다리 일체)', sub: 'Al 1.0mm 절곡, 무광 백색/은박' },
      { n: 2, text: '맞물림(수·암 걸림턱)', sub: '→ 한 판처럼 거동' },
      { n: 3, text: '가장자리 캠레버 12개' },
      { n: 4, text: 'Dual Lock (보조, 30N/cm²)' },
    ],
    params: { gap: { min: 0.06, max: 0.12, step: 0.01, default: 0.09, label: '공기층(다리 높이)', unit: 'm' } },
    thermal: {
      layer: 'solid', ventilation: 'channel',
      tau: 0.0, alphaTop: 0.25, epsTop: 0.88, epsBottom: 0.05,
      arealHeatCap: 2430,  // Al 1.0 mm
      coverFactor: 0.93,   // 5.6×3.0 over 6×3
    },
    wind: {
      model: 'rooftopPanel', cpUplift: 1.2, cpDrag: 0.2,
      planArea: 16.8, sideArea: 5.6 * 0.12,
      selfWeightKg: 65,
      loadPath: [
        { stage: '패널 ↔ 패널 맞물림', items: [{ name: '수·암 걸림턱 (이음부)', count: 31, capacityN: 800 }] },
        { stage: '판 → 컨테이너', items: [
          { name: '캠레버 (각관)', count: 12, capacityN: 1500 },
          { name: 'Dual Lock 패드 (신뢰도 30%)', count: 80, capacityN: 187 * 0.3 },
        ] },
      ],
    },
  },
};

export const DESIGN_IDS = ['A', 'B', 'C', 'D', 'E'];

// Baseline = the bare container roof with no heat shield.
export const BASELINE = {
  id: '0', color: '#8b919a',
  name: '무대책 (기존 지붕)', tagline: '차열 구조물 없음',
  meta: { partKinds: 0, weightKg: [0, 0], costManwon: [0, 0], installMin: [0, 0], crew: 0, toolsFree: true },
  thermal: null, wind: null, callouts: [], params: {},
};

export const ALL_IDS = ['0', ...DESIGN_IDS];
export function getDesign(id) { return id === '0' ? BASELINE : DESIGNS[id]; }

// Default value for every design parameter, e.g. defaultParams('D') → { gap: 0.85, shade: 0.8 }
export function defaultParams(id) {
  const d = getDesign(id); const out = {};
  for (const [k, p] of Object.entries(d.params || {})) out[k] = p.default;
  return out;
}

// Layout of the 6-unit comparison yard (container-local origins in world coords).
// 3 columns (x) × 2 rows (z). Baseline + A–E.
export const COMPARE_LAYOUT = {
  '0': { x: -8.0, z: -5.0 }, A: { x: 0.0, z: -5.0 }, B: { x: 8.0, z: -5.0 },
  C:   { x: -8.0, z: 5.0 },  D: { x: 0.0, z: 5.0 },  E: { x: 8.0, z: 5.0 },
};

// Temperature colour-map range for heat maps / legends (°C)
export const TEMP_RANGE = [20, 80];
