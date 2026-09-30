# K-Roof 3D 시뮬레이터 — 모듈 계약 (CONTRACT)

Several agents build this app in parallel. **Code only against the interfaces below.**
Do not edit files you do not own. If you need something from another module that is not
in this contract, implement a local fallback inside your own file and mention it in your final report.

## 0. Subject (from the source document "Kroof_design_options")

A construction-site **container rest room 3×6 m** (roof = 1.2T steel plate, perimeter top square tube
"상부 테두리 각관", 4 lifting rings "인양고리" at the top corners) overheats in summer. The document proposes
**five retrofit heat-shield designs A–E** that sit on the roof, block/reflect sun and leave a ventilated air gap:

| id | 이름 | 핵심 | 공기층 | 문서 요약 |
|---|---|---|---|---|
| A | 비계 캐노피형 | 비계 강관+직교 클램프 프레임 위 Al 골판 0.7mm (백색/은박) | 0.5–1 m, 완전 개방 | 4종·120–140kg·25–35만원·2인 1.5–2h |
| B | 태양광 레일형 | Al 레일 40×40 + 스탠드오프, 프레임 반사패널 4장, 미드/엔드 클램프, L-피트 | 8–10 cm | 5종·65–135kg·30–90만원·2–3h |
| C | 크로스바·라쳇 스트랩형 | ㄷ브래킷(각관 걸침)+크로스바 φ48.6 3m×3, 골판 1×6m×3장, 라쳇 50mm×4 → 인양고리 | 8–10 cm | 3–4종·75kg·15–20만원·30–45분·공구불필요 |
| D | 타프·차광막형 | 폴 φ48.6 0.7–1m×6, 알루미넷 3.5×6.5m(차광 70–90%), 번지볼 24, 가이라인 4 | 0.7–1 m, 망 통풍 | 4종·20kg·8–15만원·20–30분 |
| E | 다리 달린 인터로킹 패널형 | 1.4×0.6m 패널(다리 일체, Al 1.0 절곡), 수·암 걸림턱, 캠레버 12, Dual Lock | 8–10 cm | 3종·65kg·30–50만원·30–40분 |

All numbers/texts live in `js/config.js` (`DESIGNS`, `BASELINE`, `CONTAINER`, `ROOF`, `INTERIOR`, …). **Read it first.**

## 1. Tech & conventions

* Plain ES modules, no build step. three.js **0.160.0** imported as `import * as THREE from 'three'`
  and addons as `import { X } from 'three/addons/.../X.js'` (import map in index.html → jsdelivr).
  Node tests resolve the same specifiers from `node_modules` (`npm i` already done; `package.json` has `"type":"module"`).
* Chart.js 4.4.1 UMD is loaded as a classic script → global `Chart` (UI only).
* **Units:** meters, seconds, °C, W, N, Pa. **Coordinates:** `+x = East, +y = Up, +z = South` (−z = North).
  Container-local origin = centre of footprint on the ground. Long axis along x.
* Key heights: walls to 2.52, top tube 2.52–2.62 (outer faces flush at x=±3.0, z=±1.5, inner at ±2.90/±1.40),
  **roof plate top surface y = 2.60**, lifting rings centred at `CONTAINER.liftingRings[i]` (x,z) with centre y 2.685,
  each ring rotated 45° to face diagonally outward (ring-plane normal ∥ (sign x, 0, sign z)).
* Shared palette: `createMaterials()` in `js/materials.js` → `mats` object (created once by main.js, passed to builders).
  Reuse these materials; you may `.clone()` one if you need a variant. Never dispose shared materials.
* Geometry helpers: `js/parts.js` (`box`, `boxMinMax`, `pipeBetween`, `tubeBetween`, `twoFacePanel`,
  `corrugatedSheet`, `ribbon`, `rope`, `rightAngleClamp`, `uBolt`, `bolt`, `tag`, `shadows`, `PIPE_R`, `v3`).
* UI language: **Korean**. Code comments: English, short.
* Modules that touch the DOM must not run DOM code at import time (Node tests import builders).
* Keep triangle counts sane: whole scene (6 units) should stay < ~600k triangles. Use `InstancedMesh` for many repeats.

## 2. File ownership

| file | owner |
|---|---|
| `js/config.js`, `js/materials.js`, `js/parts.js`, `js/main.js`, `docs/CONTRACT.md` | lead (integrator) |
| `js/container.js`, `js/environment.js` | agent **ENV** |
| `js/designs/designA.js`, `designB.js`, `designC.js` | agent **DES-ABC** |
| `js/designs/designD.js`, `designE.js` | agent **DES-DE** |
| `js/physics/sun.js`, `thermal.js`, `wind.js`, `tests/physics.test.mjs`, `docs/physics.md` | agent **PHYS** |
| `js/viz/shade.js`, `heatmap.js`, `flow.js`, `rays.js`, `animator.js` | agent **VIZ** |
| `index.html`, `js/ui/ui.js`, `js/ui/charts.js` | agent **UI** |
| `tests/smoke.test.mjs` | lead |

## 3. Interfaces

### 3.1 Container — `js/container.js` (ENV)
```js
export function buildContainer({ mats }) → {
  group,          // THREE.Group in container-local coords
  roofMesh,       // the roof plate mesh (top surface at CONTAINER.roofY)
  interior,       // THREE.Group of interior furniture (bench/table/AC indoor unit), visible in section view
  update(t) {}    // optional
}
```
Must honour every dimension in `CONTAINER` exactly (designs attach to those coordinates without importing container.js).
Nothing of the container may stick above y = 2.62 except the lifting rings.

### 3.2 Environment — `js/environment.js` (ENV)
```js
export function buildEnvironment({ scene, renderer, mats }) → {
  sun,              // THREE.DirectionalLight (castShadow), target at origin
  hemi,             // THREE.HemisphereLight
  setSun({ dir, elevationDeg, ghi }),   // dir = unit Vector3 toward sun (scene coords). Updates light, sky, intensities (night when elev<0)
  setShadowBounds(radius),              // fit shadow camera to single unit (≈6) or compare yard (≈18)
  setSunPath(points),                   // array of Vector3 unit dirs for the day's sun path (drawn as a dome arc, radius ~14)
  setSunPathVisible(bool),
  update(dt) {}
}
```
Ground (large, receives shadows, site gravel/asphalt look), sky (three `Sky` addon or gradient), compass rose
(N/E/S/W on the ground, N = −z), a 1.7 m person figure for scale, light site context (fence panels, pipe stack, cones) kept
well away from the 6-unit comparison yard (|x| ≤ 13, |z| ≤ 8).

### 3.3 Design builders — `js/designs/designX.js` (DES-ABC, DES-DE)
```js
export function build({ mats, params }) → DesignModel   // params = { gap, ... } see DESIGNS[id].params
DesignModel = {
  id: 'A',
  group,              // THREE.Group, container-local coords (same origin as the container). Everything the design adds.
  parts: [            // one entry per PART KIND (matches the doc's "부품 N종")
    { key: 'sheet', name: '알루미늄 골판 0.7mm', count: 6, objects: [Object3D, ...] },
  ],
  installSteps: [     // ordered assembly sequence; EVERY object in `group` belongs to exactly one step
    { title: '기둥 세우기 · 인양고리 U볼트 결속', minutes: 25, objects: [Object3D, ...] },
  ],                  // Σ minutes ≈ middle of DESIGNS[id].meta.installMin
  callouts: [         // same numbers/texts as DESIGNS[id].callouts, plus a 3D anchor point on the part
    { n: 1, text: '...', sub: '...', anchor: THREE.Vector3 },
  ],
  gapLabel: { text: DESIGNS[id].gapText, anchor: THREE.Vector3 },   // centre of the air gap
  shadeMeshes: [Mesh, ...],  // meshes that intercept sunlight above the roof; each mesh.userData.transmittance ∈ [0,1]
                             // (0 = opaque panel; D's net = 1 - params.shade)
  topSurfaces: [Mesh, ...],  // upward-facing sun-exposed surfaces (for ray visualisation & heat tint)
  gap: { y0, y1, x0, x1, z0, z1 },   // the ventilated air-gap box (container-local) used by the airflow particles
  windLoose: [Object3D, ...],        // what blows away first when wind > critical (e.g. sheets, net, E's whole plate group)
  update(t, env) {}                   // optional per-frame animation; env = { windSpeed, windDirDeg }
}
```
* Every part object gets `tag(obj, { partKey, name, explode: [dx,dy,dz] })` — explode offsets make a clear exploded view
  (top layer highest, e.g. +1.2 m; frame +0.6 m; anchors 0).
* Heat-shield panels: **top = `mats.whiteMatte`, bottom = `mats.silverFoil`** (use `twoFacePanel` / `corrugatedSheet`).
* Attach to real container features: lifting rings, the top tube (outer faces x=±3.0 / z=±1.5, top y=2.62).
  Nothing should float or intersect the roof plate. Loads must visibly go into the tube/rings, not the thin roof plate
  (except E's legs and B's lower rails which may rest on it with rubber/EPDM pads).
* Honour `params.gap` = clear height between roof top (2.60) and the underside of the shade layer.

### 3.4 Physics — `js/physics/*.js` (PHYS). Pure JS, **no three.js import**.
```js
// sun.js
export function dayOfYear(month, day) → n (1..365)
export function solarPosition({ dayOfYear, hour, lat, lon, tz }) → { azimuth, elevation, zenith, declination, eqTime, dir:{x,y,z} }
//   azimuth: deg clockwise from North; hour = local clock time (decimal); dir = unit vector TOWARD the sun in scene coords
//   (+x East, +y Up, +z South) → dir = (cosEl·sinAz, sinEl, −cosEl·cosAz)
export function clearSkyIrradiance({ elevationDeg, dayOfYear, clearness = 1 }) → { dni, dhi, ghi }   // W/m²
export function sunTimes({ dayOfYear, lat, lon, tz }) → { sunrise, sunset, solarNoon }              // local hours
export function ambientTemperature(hour, Tmin, Tmax) → °C
export function skyTemperature(TaC) → °C
export function sunPath({ dayOfYear, lat, lon, tz, stepMin = 10 }) → [{ hour, dir, elevation, azimuth }]

// thermal.js
export function simulateDay(opts) → ThermalResult
opts = {
  design,            // DESIGNS[id] or BASELINE (BASELINE.thermal === null → bare roof)
  params,            // { gap, shade, ... } (current slider values)
  site: { lat, lon, tz }, dayOfYear,
  weather: { Tmax, Tmin, windSpeed, clearness },
  roof: { alpha, insulationMm },
  interior: { acOn, setpoint, internalGainW },
  shadeProfile,      // optional (hour) → { beamTrans, skyView }; beamTrans = area-avg fraction of DIRECT beam reaching roof,
                     // skyView = roof's view factor to sky (1 = bare). If omitted derive from design.thermal (coverFactor, tau).
  stepSec = 60, spinupDays = 2,
}
ThermalResult = {
  hours: number[]  (0, 0.25, …, 24)  — every series below has the same length
  Ta, Tsky, ghi, dni, dhi, Tshade (NaN for baseline), TroofSun, TroofShade, Troof (area avg), Tgap, Tin,
  qRoof (W/m² into the room through the roof), qRoofW (W total), acW (electric W, 0 if AC off), gapVelocity (m/s),
  summary: { TroofMax, TroofMaxHour, TinMax, TshadeMax, roofHeatKWh, coolingKWh, acKWh, peakAcW }
}
export function sampleAt(result, hour) → { Ta, Troof, TroofSun, TroofShade, Tshade, Tgap, Tin, qRoof, ghi, acW, gapVelocity } // linear interp
export const THERMAL_ASSUMPTIONS = [ '...', ... ]   // Korean one-liners shown in the UI

// wind.js
export function velocityPressure(V, rho = 1.225) → Pa
export function windCheck(design, { V, params }) → {
  V, q, upliftN, dragN, weightN,
  stages: [{ stage, capacityN, demandN, sf, items }],
  sf, governing, criticalV, status: 'ok' | 'warn' | 'fail'   // ok ≥ 1.5, warn 1.0–1.5, fail < 1.0
}
export function sfCurve(design, params, Vmax = 50, step = 1) → [{ V, sf }]
export const WIND_ASSUMPTIONS = [ '...' ]
```

### 3.5 Visualisation — `js/viz/*.js` (VIZ)
```js
// shade.js — ray-cast shading of the roof by a design's shadeMeshes
export function createShadeAnalyzer({ nx = 24, nz = 12 } = {}) → {
  gridTransmittance(unitRoot, shadeMeshes, sunDir) → Float32Array(nx*nz)   // per roof cell, 0..1 of direct beam reaching roof
  meanTransmittance(unitRoot, shadeMeshes, sunDir) → number
  skyView(unitRoot, shadeMeshes, samples = 128) → number                    // cosine-weighted hemisphere
  profile(unitRoot, shadeMeshes, sunDirAtHour, hours) → { hours, beamTrans:[] }   // sunDirAtHour(h) → Vector3|null (null = night)
}
//   unitRoot: the Object3D whose local frame is container-local (roof rect = CONTAINER.roofRect); must have updated matrixWorld.
//   A ray hitting several meshes multiplies their userData.transmittance (undefined → 0).

// heatmap.js — coloured overlay on the roof plate
export function tempToColor(T, min = TEMP_RANGE[0], max = TEMP_RANGE[1]) → THREE.Color   // perceptual thermal map
export const HEAT_CSS_GRADIENT   // 'linear-gradient(90deg, …)' matching tempToColor, for the UI legend
export function createRoofHeatmap({ nx = 24, nz = 12 } = {}) → {
  mesh,            // add to unit root (container-local), sits at roofY + 0.004 over CONTAINER.roofRect
  update(trans, TroofSun, TroofShade),   // per-cell T = TroofShade + trans·(TroofSun − TroofShade)
  setVisible(bool)
}

// flow.js — air particles through the ventilated gap
export function createGapFlow({ count = 700 } = {}) → {
  object,          // THREE.Points (add to unit root)
  setGap(gapBox),  // DesignModel.gap, or null → particles skim over the bare roof
  update(dt, { windSpeed, windDirDeg, gapVelocity, Tin: Ta, Tout: Tgap }),  // colour by temperature
  setVisible(bool)
}

// rays.js — sun ray arrows like the document figures (orange incoming + reflected)
export function createSunRays() → { group, update(sunDir, unitRoot, targets /* Mesh[] */ , elevationDeg), setVisible(bool) }

// animator.js — install sequence, exploded view, wind blow-off
export function createAnimator() → {
  playInstall(model, { speed = 1, onStep(i, step, elapsedMin, totalMin), onDone }),  // parts drop in step by step
  stopInstall(),     // show everything in final position
  setExplode(model, k),   // k ∈ [0,1]; uses userData.explode offsets, remembers base transforms
  blowOff(model, { windDirDeg, V }),   // windLoose objects lift, tumble and fly downwind (simple ballistic + spin)
  resetBlowOff(model),
  update(dt)
}
```

### 3.6 UI — `index.html`, `js/ui/ui.js`, `js/ui/charts.js` (UI)
`index.html` holds the page (title, fonts, CSS tokens light/dark, import map, Chart.js script, layout containers) and
loads `js/main.js` as a module (`<script type="module" src="js/main.js">`). DOM contract:
* `#viewport` — `position:relative; overflow:hidden`, sized by CSS. **main.js owns it**: it prepends the WebGL canvas and a
  CSS2D label layer (`.label-layer`, pointer-events:none) and resizes them with a ResizeObserver.
* `#hud` — absolutely positioned overlay *inside* `#viewport` (pointer-events:none except its own controls). **UI owns it**
  (clock, sun azimuth/elevation, temperature legend, install progress, camera buttons).
* `#controls` (left/side panel) and `#dashboard` (results) — **UI owns them**.
* 3D labels created by main.js use classes `.callout` (numbered callout: `.callout .n`, `.callout .t`, `.callout .s`),
  `.gap-label`, `.unit-tag` (unit name above each container in compare mode). UI's CSS styles them.

```js
// ui.js
export function createUI({ state, set, config }) → {
  //   state = the app state object below (read-only for UI); set(patch) = deep-merge patch into state & notify main
  //   config = the whole config.js module namespace
  renderResults({ thermal, wind, curves }),   // thermal: {id → ThermalResult}, wind: {id → windCheck}, curves: {id → sfCurve}
  setClock({ hour, sun: { azimuth, elevation, ghi }, sample: {id → sampleAt} }),   // called ~10×/s while time runs
  setInstall({ running, stepIndex, steps, elapsedMin, totalMin }),
  setAssumptions({ thermal: [...], wind: [...] }),
  setBusy(bool),
  toast(msg)
}
// charts.js — Chart.js wrappers used by ui.js
```

App **state** (owned by main.js; UI calls `set(patch)`):
```js
{
  mode: 'single' | 'compare',
  design: '0' | 'A' | 'B' | 'C' | 'D' | 'E',
  siteId: 'seoul', month: 7, day: 25, hour: 14.0, playing: false, speed: 1.5 /* sim hours per real second */,
  weatherPreset: 'heatwave',
  weather: { Tmax, Tmin, windSpeed, clearness },
  roof: { alpha, insulationMm },
  interior: { acOn: true, setpoint: 26, internalGainW: 350 },
  gust: 26, windDirDeg: 270,      // wind check speed (3-s gust, m/s) and direction the wind comes FROM (deg, 270 = from West)
  params: { A: {gap}, B: {gap}, C: {gap, strapLC}, D: {gap, shade}, E: {gap} },
  view: { heatmap: true, flow: true, rays: true, labels: true, sunPath: true, section: false, explode: 0, windSim: false },
  camera: 'iso' | 'section' | 'top' | 'gap' | 'yard',
  actions: { installSeq: 0, blowSeq: 0 }   // UI increments to trigger "설치 재생" / "바람 시뮬레이션"
}
```
