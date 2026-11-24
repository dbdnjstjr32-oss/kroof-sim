// custom.js — design resolution helper. No DOM.
// Preserves the exact specification material properties of A, B, C, and Cp without overriding them.
import { getDesign } from './config.js';

export function effectiveDesign(id, _state) {
  return getDesign(id);
}

export function surfaceGray(alpha) {
  const a = Math.min(0.98, Math.max(0.05, Number.isFinite(alpha) ? alpha : 0.25));
  return Math.min(0.96, Math.max(0.04, 0.96 - 0.9 * ((a - 0.05) / 0.93)));
}

export function applySurfaceAppearance(_mats, _surface) {
  // Material finishes are fixed per design (B/C: ACP white reflective + mill Al; C': galvalume white + mill galvalume).
}
