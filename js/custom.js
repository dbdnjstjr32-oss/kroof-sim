// custom.js — turns the user's customisation state into (a) an "effective" design for the physics and
// (b) live material appearance in the 3D scene. No DOM; three.js is only touched through the materials passed in.
import { getDesign, UNDERSIDE_PAINT_EPS } from './config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REF_FOIL_EPS = 0.05;   // the foil emissivity the per-design config values were written for

/**
 * Design object as the physics should see it, with the user's surface choices applied.
 * Only solid heat-shield panels (A, B, C, E) are affected; D's aluminised net and the bare roof are not.
 *   top face   : solar absorptance α = surface.topAlpha
 *   underside  : foil → ε scales with surface.foilEps (relative to the 0.05 the config assumed); paint → ε 0.9
 * Returns the original object when nothing needs changing (so identity checks / caching stay cheap).
 */
export function effectiveDesign(id, state) {
  const d = getDesign(id);
  const th = d?.thermal;
  const sf = state?.surface;
  if (!th || th.layer !== 'solid' || !sf) return d;
  const alphaTop = clamp(Number.isFinite(sf.topAlpha) ? sf.topAlpha : th.alphaTop, 0.02, 1);
  const epsBottom = sf.underside === 'paint'
    ? UNDERSIDE_PAINT_EPS
    : clamp((th.epsBottom ?? REF_FOIL_EPS) * ((Number.isFinite(sf.foilEps) ? sf.foilEps : REF_FOIL_EPS) / REF_FOIL_EPS), 0.02, 0.95);
  if (alphaTop === th.alphaTop && epsBottom === th.epsBottom) return d;
  return { ...d, thermal: { ...th, alphaTop, epsBottom } };
}

/** Grey level (0 = black … 1 = white) the top face is drawn with for a given solar absorptance. */
export function surfaceGray(alpha) {
  const a = clamp(Number.isFinite(alpha) ? alpha : 0.25, 0.05, 0.98);
  return clamp(0.96 - 0.9 * ((a - 0.05) / 0.93), 0.04, 0.96);
}

/**
 * Update the shared heat-shield materials: top face colour follows α, the underside is silver foil
 * (duller as ε rises with age) or plain white paint. Safe to call every time the sliders move.
 */
export function applySurfaceAppearance(mats, surface) {
  if (!mats || !surface) return;
  const top = mats.whiteMatte, under = mats.silverFoil;
  if (top?.color) {
    const g = surfaceGray(surface.topAlpha);
    top.color.setRGB(g, g, g * 0.985);
  }
  if (under?.color) {
    const base = (under.userData.base ??= { color: under.color.clone(), metalness: under.metalness, roughness: under.roughness });
    if (surface.underside === 'paint') {
      under.color.setRGB(0.91, 0.9, 0.87);
      under.metalness = 0.0;
      under.roughness = 0.85;
    } else {
      const age = clamp(((Number.isFinite(surface.foilEps) ? surface.foilEps : REF_FOIL_EPS) - 0.03) / 0.57, 0, 1);   // 0 new … 1 badly aged
      under.color.copy(base.color).multiplyScalar(1 - 0.35 * age);
      under.metalness = base.metalness * (1 - 0.6 * age);
      under.roughness = base.roughness + 0.55 * age;
    }
  }
}
