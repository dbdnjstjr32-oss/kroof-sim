// heatmap.js — thermal colour ramp + coloured temperature overlay on the roof plate.
// DOM-free; safe to import in Node.
//
// Cell layout shared with shade.js: index = iz * nx + ix, ix along +x (west → east),
// iz along +z (north → south), cells tiling CONTAINER.roofRect.
import * as THREE from 'three';
import { CONTAINER, TEMP_RANGE } from '../config.js';

// ---------------------------------------------------------------- colour ramp
// Perceptual thermal ramp, defined in sRGB: deep blue → teal → yellow → orange → red → near-white.
const STOPS = [
  [0.00, '#172a73'],
  [0.16, '#2166ac'],
  [0.32, '#1f9e98'],
  [0.50, '#e8d83a'],
  [0.66, '#f39a2b'],
  [0.82, '#dc3a24'],
  [0.92, '#ef7866'],
  [1.00, '#fff4ea'],
];
const STOP_RGB = STOPS.map(([t, hex]) => {
  const n = parseInt(hex.slice(1), 16);
  return [t, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
});

/** CSS gradient with exactly the same stops as tempToColor (for the UI legend). */
export const HEAT_CSS_GRADIENT =
  `linear-gradient(90deg, ${STOPS.map(([t, hex]) => `${hex} ${Math.round(t * 100)}%`).join(', ')})`;

// sRGB components of the ramp at normalised u ∈ [0,1] (interpolated in sRGB, like CSS does).
function rampSRGB(u, out) {
  u = u <= 0 ? 0 : u >= 1 ? 1 : u;
  let i = 1;
  while (i < STOP_RGB.length - 1 && u > STOP_RGB[i][0]) i++;
  const a = STOP_RGB[i - 1], b = STOP_RGB[i];
  const f = b[0] > a[0] ? (u - a[0]) / (b[0] - a[0]) : 0;
  out[0] = a[1] + (b[1] - a[1]) * f;
  out[1] = a[2] + (b[2] - a[2]) * f;
  out[2] = a[3] + (b[3] - a[3]) * f;
  return out;
}

const _srgb = [0, 0, 0];

/**
 * Thermal colour for temperature T (°C) over [min, max].
 * Returns a THREE.Color in the renderer's working (linear) colour space.
 * Pass `target` to avoid allocating.
 */
export function tempToColor(T, min = TEMP_RANGE[0], max = TEMP_RANGE[1], target = new THREE.Color()) {
  const u = Number.isFinite(T) && max > min ? (T - min) / (max - min) : 0;
  rampSRGB(u, _srgb);
  return target.setRGB(_srgb[0], _srgb[1], _srgb[2], THREE.SRGBColorSpace);
}

// Fast path: 256-entry LUT of working-space RGB (built lazily so ColorManagement settings apply).
const LUT_N = 256;
let LUT = null;
function lut() {
  if (LUT) return LUT;
  LUT = new Float32Array(LUT_N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < LUT_N; i++) {
    rampSRGB(i / (LUT_N - 1), _srgb);
    c.setRGB(_srgb[0], _srgb[1], _srgb[2], THREE.SRGBColorSpace);
    LUT[i * 3] = c.r; LUT[i * 3 + 1] = c.g; LUT[i * 3 + 2] = c.b;
  }
  return LUT;
}

/**
 * Write the working-space RGB of tempToColor(T) into out[offset..offset+2] (LUT, no allocation).
 * Used by the heat map and the airflow particles.
 */
export function tempToRGB(T, out, offset = 0, min = TEMP_RANGE[0], max = TEMP_RANGE[1]) {
  const L = lut();
  let u = Number.isFinite(T) && max > min ? (T - min) / (max - min) : 0;
  u = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const x = u * (LUT_N - 1);
  const i = Math.min(LUT_N - 2, x | 0), f = x - i;
  const a = i * 3, b = a + 3;
  out[offset] = L[a] + (L[b] - L[a]) * f;
  out[offset + 1] = L[a + 1] + (L[b + 1] - L[a + 1]) * f;
  out[offset + 2] = L[a + 2] + (L[b + 2] - L[a + 2]) * f;
  return out;
}

// ---------------------------------------------------------------- roof overlay
/**
 * Coloured overlay over CONTAINER.roofRect (container-local coords; add to the unit root).
 * update(trans, TroofSun, TroofShade): per-cell T = TroofShade + trans·(TroofSun − TroofShade).
 * `trans` may be null (→ fully sunlit). Colours are smoothed bilinearly through a vertex grid.
 */
export function createRoofHeatmap({ nx = 24, nz = 12 } = {}) {
  const R = CONTAINER.roofRect;
  const w = R.x1 - R.x0, d = R.z1 - R.z0;

  // PlaneGeometry rotated flat: vertex (ix, iz) → index iz*(nx+1)+ix, x increasing with ix, z with iz.
  const geometry = new THREE.PlaneGeometry(w, d, nx, nz);
  geometry.rotateX(-Math.PI / 2);
  const nv = (nx + 1) * (nz + 1);
  const colors = new Float32Array(nv * 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('color', colorAttr);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
    polygonOffset: true,          // pull toward the camera → no z-fighting with the roof plate
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'roofHeatmap';
  mesh.position.set((R.x0 + R.x1) / 2, R.y + 0.004, (R.z0 + R.z1) / 2);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.raycast = () => {};        // overlay must not intercept picking / sun-ray casts

  const temps = new Float32Array(nx * nz);   // last per-cell temperatures (°C), readable by callers
  const vT = new Float32Array(nv);

  function update(trans, TroofSun, TroofShade) {
    let Ts = TroofSun, Th = TroofShade;
    if (!Number.isFinite(Ts)) Ts = Th;
    if (!Number.isFinite(Th)) Th = Ts;
    if (!Number.isFinite(Ts)) { Ts = Th = TEMP_RANGE[0]; }
    const dT = Ts - Th;

    for (let i = 0; i < nx * nz; i++) {
      let t = trans ? trans[i] : 1;
      t = Number.isFinite(t) ? (t < 0 ? 0 : t > 1 ? 1 : t) : 1;
      temps[i] = Th + t * dT;
    }
    // Vertex temperature = mean of the (up to 4) cells sharing that vertex.
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        let s = 0, n = 0;
        for (let cz = iz - 1; cz <= iz; cz++) {
          if (cz < 0 || cz >= nz) continue;
          for (let cx = ix - 1; cx <= ix; cx++) {
            if (cx < 0 || cx >= nx) continue;
            s += temps[cz * nx + cx]; n++;
          }
        }
        vT[iz * (nx + 1) + ix] = s / n;
      }
    }
    for (let v = 0; v < nv; v++) tempToRGB(vT[v], colors, v * 3);
    colorAttr.needsUpdate = true;
  }

  function setVisible(v) { mesh.visible = !!v; }

  update(null, TEMP_RANGE[0], TEMP_RANGE[0]);
  return { mesh, update, setVisible, temps, nx, nz };
}
