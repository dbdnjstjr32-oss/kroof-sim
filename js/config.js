// config.js — single source of truth shared by every module.
// Pure data: must NOT import three.js (physics modules and Node tests import this file).
//
// Coordinate system (meters): +x = East, +y = Up, +z = South (-z = North).
// Container-local origin = centre of the container footprint at ground level (y = 0).
// Long axis 6.0 m along x, width 3.0 m along z, exterior height 2.80 m along y.

// ---------------------------------------------------------------- site / weather
export const SITES = [
  { id: 'seoul',   name: '서울', lat: 37.5665, lon: 126.9780, tz: 9 },
  { id: 'daejeon', name: '대전', lat: 36.3504, lon: 127.3845, tz: 9 },
  { id: 'gwangju', name: '광주', lat: 35.1595, lon: 126.8526, tz: 9 },
  { id: 'busan',   name: '부산', lat: 35.1796, lon: 129.0756, tz: 9 },
  { id: 'jeju',    name: '제주', lat: 33.4996, lon: 126.5312, tz: 9 },
];

// Representative summer weather conditions (default: Seoul late-July heatwave).
export const WEATHER_PRESETS = [
  { id: 'heatwave', name: '폭염 (7월 하순 대표)', month: 7, day: 25, Tmax: 35.0, Tmin: 26.0, windSpeed: 1.5, clearness: 0.95 },
  { id: 'august',   name: '8월 평년 여름',        month: 8, day: 10, Tmax: 31.5, Tmin: 24.0, windSpeed: 2.0, clearness: 0.85 },
  { id: 'june',     name: '하지 (6월 21일)',      month: 6, day: 21, Tmax: 29.0, Tmin: 19.0, windSpeed: 2.5, clearness: 0.90 },
  { id: 'cloudy',   name: '구름 많음 (맑음 0.6)', month: 7, day: 25, Tmax: 31.0, Tmin: 25.0, windSpeed: 2.0, clearness: 0.60 },
];

// ---------------------------------------------------------------- container geometry (§3.1)
// Actual container size: 6,000 mm (L) × 3,000 mm (W) × 2,800 mm (H), roof steel plate 1.2 mm.
export const CONTAINER = {
  L: 6.0,                  // length along x (m)
  W: 3.0,                  // width along z (m)
  H: 2.80,                 // exterior container height (m), excluding roof add-ons
  wallTopY: 2.70,          // top of wall panels = underside of perimeter top tube
  roofY: 2.80,             // TOP SURFACE of the 1.2T existing steel roof plate
  roofThk: 0.0012,         // 1.2 mm
  frameTube: { size: 0.10, bottomY: 2.70, topY: 2.80, innerX: 2.90, innerZ: 1.40 },
  cornerPost: 0.15,        // corner post section 150×150
  roofArea: 18.0,          // m² (6m × 3m)
  wallArea: 50.4,          // m² ((6+3)×2 × 2.8m)
  roomVolume: 50.4,        // m³ (6m × 3m × 2.8m simplified representative value)
  // Full 6×3 m projected roof footprint (100% roof coverage assumption in §2 & §7.1).
  roofRect: { x0: -3.0, x1: 3.0, z0: -1.5, z1: 1.5, y: 2.80 },
  innerRoofRect: { x0: -2.90, x1: 2.90, z0: -1.40, z1: 1.40, y: 2.80 },
  // 3D visual openings (excluded from thermal calculation per §3.3).
  door:    { face: 'south', x0: 1.30, x1: 2.20, y0: 0.10, y1: 2.10 },
  windows: [
    { face: 'south', x0: -2.30, x1: -0.90, y0: 1.00, y1: 2.00 },
    { face: 'north', x0: -0.70, x1: 0.70,  y0: 1.00, y1: 2.00 },
  ],
  acUnit: { face: 'east', z: -0.5 },
};

// Existing roof steel plate & insulation (§3.2, §3.4)
export const ROOF = {
  steelThk: 0.0012,        // 0.0012 m
  kSteel: 50,              // 50 W/m·K
  rhoSteel: 7850,          // 7,850 kg/m³
  cpSteel: 490,            // 490 J/kg·K
  alpha: 0.70,             // solar absorptance of existing steel roof
  eps: 0.90,               // long-wave emissivity of existing steel roof
  insulationMm: 0,         // default 0 mm; selectable [0, 50]
  kIns: 0.035,             // 0.035 W/m·K
};

export const INSULATION_OPTIONS = [0, 50];

// Common indoor / envelope thermal conditions (§3.3, §9.1)
export const INTERIOR = {
  wallU: 1.0,              // W/m²·K (includes door in wall heat transfer)
  roomCap: 300000,         // 300,000 J/K effective indoor heat capacity
  achInfil: 0.5,           // 0.5 ACH indoor infiltration
  internalGainW: 0,        // 0 W
  floorU: 0,               // adiabatic floor boundary
  windowArea: 0,           // excluded from thermal calculation
  windowU: 0,              // excluded
  shgc: 0,                 // excluded
  acOn: false,             // default OFF to display free-floating temperatures; ON/OFF toggleable
  setpoint: 26,            // 26 °C (range 20..30 °C)
  acStartHour: 8,          // 08:00
  acEndHour: 18,           // 18:00
};

// ---------------------------------------------------------------- design options A, B, C, C' (§2, §4, §5)
export const BASELINE = {
  id: 'A',
  short: 'A안',
  color: '#6e7681',
  name: '기존 컨테이너',
  fullName: 'A안 – 기존 컨테이너',
  tagline: '별도 차열패널 없이 기존 1.2T 지붕 강판만 적용한 기준 모델',
  description: '태양복사가 기존 컨테이너 지붕 강판(1.2mm)에 직접 입사하는 구조입니다. 모든 설계안의 지붕 강판 하면 온도, 실내 온도, 일일 지붕 열유입량 및 냉방부하 절감률 비교의 기준이 됩니다.',
  gapText: '차열패널 · 공기층 없음 (기준 모델)',
  thermal: null,
  params: {},
  callouts: [],
  specs: {
    panel: '없음',
    gapMm: '없음',
    topFinish: '기존 지붕 강판 (α=0.70)',
    botFinish: '기존 지붕 강판 (ε=0.90)',
    rib: '없음',
    crossbar: '없음',
    pad: '없음',
    panelFix: '—',
    tieDown: '—',
    auxFix: '—',
    installType: '기준 모델',
  },
};

export const DESIGNS = {
  B: {
    id: 'B',
    short: 'B안',
    color: '#0072b2',
    name: 'ACP 밀착형',
    fullName: 'B안 – ACP 밀착형',
    tagline: '기존 컨테이너 지붕 위에 ACP 4T를 공기층 없이 직접 밀착시킨 구조',
    description: '기존 컨테이너 지붕 강판 상부에 백색 고반사 코팅 ACP(4mm)를 공기층(0mm) 없이 직접 밀착 설치합니다. 공기층 자연환기 없이 차열패널 자체의 반사 및 열저항 효과를 확인하기 위한 비교 모델입니다.',
    gapText: '공기층 없음 (0 mm · 직접 접촉 열전달)',
    params: {},
    callouts: [
      { n: 1, text: '차열패널: ACP 4T (백색 고반사)', sub: '상부 반사율 0.89 · 흡수율 0.11' },
      { n: 2, text: '패널 하부: 무도장 알루미늄', sub: '장파 방사율 0.12' },
      { n: 3, text: '지붕 직접 밀착 구조 (공기층 0mm)', sub: '접촉 전도 열전달 적용' },
    ],
    thermal: {
      mode: 'contact',
      gap: 0,
      thickness: 0.004,
      k: 0.44,
      rho: 1900,
      cp: 1000,
      arealMass: 7.60,
      arealHeatCap: 7600,
      rhoSolar: 0.89,
      alphaTop: 0.11,
      epsTop: 0.88,
      epsBottom: 0.12,
      tau: 0,
      coverFactor: 1.0,
    },
    specs: {
      panel: 'ACP 4T (100% 피복)',
      gapMm: '없음 (0 mm)',
      topFinish: '백색 고반사 코팅 (ρ=0.89, α=0.11)',
      botFinish: '무도장 알루미늄 (ε=0.12)',
      rib: '없음',
      crossbar: '없음',
      pad: '없음',
      panelFix: '직접 밀착',
      tieDown: '밀착형',
      auxFix: '—',
      installType: '밀착형 (비환기)',
    },
  },

  C: {
    id: 'C',
    short: 'C안',
    color: '#009e73',
    name: 'ACP 차열 이중지붕',
    fullName: 'C안 – ACP 차열 이중지붕',
    tagline: 'ACP 4T + 110mm 폭 방향 통로형 공기층 + 무천공 모듈식 탈부착·재사용형',
    description: '기존 지붕 위에 레벨러와 고무패드 받침(10곳) 및 아연도금 각관 크로스바(5개)를 세워 110mm 공기층을 형성하고, 각관 보강재가 결합된 ACP 4T 모듈 12개를 드로우 래치로 고정합니다. 크로스바 끝단 D링·라쳇 스트랩·J후크로 무천공 결속합니다.',
    gapText: '공기층 110 mm (폭 방향 4통로 자연환기)',
    params: {},
    callouts: [
      { n: 1, text: 'ACP 4T 패널 모듈 12개', sub: '1,500×1,000mm · 간격 10mm · 백색 고반사' },
      { n: 2, text: '보강재(30×30 각관) + 드로우 래치', sub: '끝 리브 20mm 걸침 · 개별 분리 재사용' },
      { n: 3, text: '아연도금 크로스바 5개 + 받침 10곳', sub: '100×50×2.9T · 레벨러(±20mm)+고무패드' },
      { n: 4, text: '크로스바 끝단 라쳇 스트랩 결속', sub: 'D링 + 50mm 스트랩 + 하부 J후크 · 빔 클램프' },
    ],
    thermal: {
      mode: 'channel',
      gap: 0.11,
      channels: 4,
      channelLength: 3.0,
      crossbarCount: 5,
      crossbarWidth: 0.10,
      thickness: 0.004,
      k: 0.44,
      rho: 1900,
      cp: 1000,
      arealMass: 7.60,
      arealHeatCap: 7600,
      rhoSolar: 0.89,
      alphaTop: 0.11,
      epsTop: 0.88,
      epsBottom: 0.12,
      tau: 0,
      coverFactor: 1.0,
    },
    specs: {
      panel: 'ACP 4T (1,500×1,000, 12모듈)',
      gapMm: '110 mm',
      topFinish: '백색 고반사 표면 (ρ=0.89, α=0.11)',
      botFinish: '무도장 알루미늄 (ε=0.12)',
      rib: '아연도금 각관 (30×30)',
      crossbar: '아연도금 각관 100×50×2.9T (3.2m, 5개)',
      pad: '레벨러(±20mm) 및 고무패드 (총 10곳)',
      panelFix: '드로우 래치',
      tieDown: '크로스바 끝단 D링 + 라쳇 스트랩 + J후크',
      auxFix: 'M12 빔 클램프',
      installType: '무천공 모듈식 탈부착형',
    },
  },

  Cp: {
    id: 'Cp',
    short: 'C′안',
    color: '#e69f00',
    name: '갈바륨 차열 이중지붕',
    fullName: 'C′안 – 갈바륨 차열 이중지붕 (경제성 개선)',
    tagline: '갈바륨 골강판 0.5T(백색 차열도료) + 140mm 공기층 + 경량·모듈식 탈부착형',
    description: 'C안의 이중지붕·무천공 탈부착 원리를 유지하면서 ACP를 C-76 갈바륨 골강판 0.5T(백색 차열도료)로 대체해 재료비와 자중을 절감한 설계안입니다. 고무패드(10mm) + 크로스바(100mm) + 양단 보강재(30mm) 적층으로 140mm 공기층을 형성하며 M8 나비볼트·팝너트와 C형 클램프를 적용합니다.',
    gapText: '공기층 140 mm (10+100+30mm · 폭 방향 자연환기)',
    params: {},
    callouts: [
      { n: 1, text: '갈바륨 골강판 0.5T (C-76) 12모듈', sub: '백색 차열도료(ρ=0.75) · 하부 무도장 갈바륨' },
      { n: 2, text: '양단 보강재(30×30×1.4T) 24개', sub: '방수 직결피스(96) · M8 나비볼트/팝너트(48)' },
      { n: 3, text: '아연도금 크로스바 5개 + 고무패드', sub: '100×50×2.9T (3.2m) · 10mm 고무패드 20개' },
      { n: 4, text: '크로스바 끝단 라쳇 스트랩 + C형 클램프', sub: '50mm×8m 스트랩 8개 · 하부 J후크 · C클램프 4개' },
    ],
    thermal: {
      mode: 'channel',
      gap: 0.14,
      channels: 4,
      channelLength: 3.0,
      crossbarCount: 5,
      crossbarWidth: 0.05,
      thickness: 0.0005,
      k: 50,
      rho: 7850,
      cp: 460,
      shapeFactor: 1.15,
      // Pre-multiplied by shapeFactor 1.15 per §4.2 (do not multiply twice in thermal.js).
      arealMass: 7850 * 0.0005 * 1.15,
      arealHeatCap: 7850 * 0.0005 * 1.15 * 460,
      rhoSolar: 0.75,
      alphaTop: 0.25,
      epsTop: 0.88,
      epsBottom: 0.28,
      tau: 0,
      coverFactor: 1.0,
    },
    specs: {
      panel: '갈바륨 골강판 0.5T (C-76, 12모듈)',
      gapMm: '140 mm (패드 10 + 크로스바 100 + 보강재 30)',
      topFinish: '백색 차열도료 (ρ=0.75, α=0.25)',
      botFinish: '무도장 갈바륨 (ε=0.28)',
      rib: '아연도금 각관 30×30×1.4T (1m × 24개, 양단)',
      crossbar: '아연도금 각관 100×50×2.9T (3.2m, 5개)',
      pad: '고무패드 100×100×10mm (20개)',
      panelFix: '방수 직결피스 + M8 나비볼트·팝너트',
      tieDown: '크로스바 끝단 라쳇 스트랩(8개) + J후크',
      auxFix: '4인치 C형 클램프 (4개) + 모서리 보호재',
      installType: '무천공 모듈식 탈부착형 (경제성 개선)',
    },
  },
};

export const BASELINE_ID = 'A';
export const DESIGN_IDS = ['B', 'C', 'Cp'];
export const INSTALL_IDS = ['C', 'Cp'];
export const ALL_IDS = ['A', 'B', 'C', 'Cp'];

export function displayId(id) {
  return id === 'Cp' ? 'C′안' : `${id}안`;
}

export function getDesign(id) {
  return id === 'A' ? BASELINE : DESIGNS[id];
}

export function defaultParams(id) {
  const d = getDesign(id);
  const out = {};
  for (const [k, p] of Object.entries(d?.params || {})) out[k] = p.default;
  return out;
}

// Layout of the 4-unit comparison yard (2 columns × 2 rows) inside the 28×18 m pad.
export const COMPARE_LAYOUT = {
  A:  { x: -5.2, z: -3.8 },
  B:  { x:  5.2, z: -3.8 },
  C:  { x: -5.2, z:  3.8 },
  Cp: { x:  5.2, z:  3.8 },
};

// Temperature colour-map range for heat maps / legends (°C)
export const TEMP_RANGE = [20, 80];

// User-customisable bounds (§8.1, §3.4, §9.1) — single source for UI sliders AND scenario sanitising.
export const CUSTOM_SPEC = {
  'roof.insulationMm': { min: 0, max: 50, step: 50, default: ROOF.insulationMm, label: '지붕 단열재 두께', unit: 'mm' },
  'interior.setpoint': { min: 20, max: 30, step: 0.5, default: INTERIOR.setpoint, label: '냉방 설정온도', unit: '°C' },
  'weather.Tmax':      { min: 20, max: 40, step: 0.5, default: 35.0, label: '외기 최고온도', unit: '°C' },
  'weather.Tmin':      { min: 10, max: 32, step: 0.5, default: 26.0, label: '외기 최저온도', unit: '°C' },
  'weather.windSpeed': { min: 0, max: 8, step: 0.1, default: 1.5, label: '외부 풍속', unit: 'm/s' },
  'weather.clearness': { min: 0.3, max: 1.0, step: 0.05, default: 0.95, label: '맑음 지수', unit: '' },
  'hour':              { min: 0, max: 24, step: 0.25, default: 14.0, label: '시각', unit: 'h' },
  'month':             { min: 1, max: 12, step: 1, default: 7, label: '월', unit: '' },
  'day':               { min: 1, max: 31, step: 1, default: 25, label: '일', unit: '' },
  'customSite.lat':    { min: -60, max: 66, step: 0.01, default: 37.5665, label: '위도', unit: '°' },
  'customSite.lon':    { min: -180, max: 180, step: 0.01, default: 126.978, label: '경도', unit: '°' },
  'customSite.tz':     { min: -12, max: 14, step: 0.5, default: 9, label: '표준시(UTC+)', unit: 'h' },
};

export const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'];
export const THEME_OPTIONS = ['auto', 'light', 'dark'];

export function customDefaults() {
  return {
    customSite: { lat: 37.5665, lon: 126.978, tz: 9 },
    ui: { quality: 'auto', autoRotate: false },
  };
}
