// custom.js — design resolution helper. No DOM, no three.js.
// A, B and C always keep their exact specification material properties.
// C′ (Cp) applies the user-adjustable surface properties of the sensitivity study (추가 수정 요청 §2):
// top solar reflectance ρ (absorptance α = 1 − ρ) and underside long-wave emissivity ε. Everything else
// (ε_top 0.88, galvalume 0.5T thickness/k/ρ/c, 140 mm air gap, channels…) stays exactly as specified.
import { getDesign, cpSurfaceOf, isCpAdjusted, cpSurfaceTexts, cpAlpha } from './config.js';

/** C′ design with the given surface { rhoSolar, epsBottom } (clamped; missing values → base values). */
export function cpDesignFor(surface) {
  const base = getDesign('Cp');
  const s = cpSurfaceOf(surface);
  const txt = cpSurfaceTexts(s);
  return {
    ...base,
    thermal: { ...base.thermal, rhoSolar: s.rhoSolar, alphaTop: cpAlpha(s.rhoSolar), epsBottom: s.epsBottom },
    specs: { ...base.specs, topFinish: txt.topFinish, botFinish: txt.botFinish },
    callouts: base.callouts.map((c) => (c.n === 1 ? { ...c, sub: txt.calloutSub } : { ...c })),
    surface: s,
    surfaceAdjusted: isCpAdjusted(s),
  };
}

/** Design actually simulated/displayed for `id` under the app state. */
export function effectiveDesign(id, state) {
  if (id === 'Cp' && state && state.cpSurface && isCpAdjusted(state)) return cpDesignFor(state.cpSurface);
  return getDesign(id);
}

export function surfaceGray(alpha) {
  const a = Math.min(0.98, Math.max(0.05, Number.isFinite(alpha) ? alpha : 0.25));
  return Math.min(0.96, Math.max(0.04, 0.96 - 0.9 * ((a - 0.05) / 0.93)));
}

export function applySurfaceAppearance(_mats, _surface) {
  // Material finishes are fixed per design (B/C: ACP white reflective + mill Al; C': galvalume white + mill galvalume).
}
