// econ.js — payback arithmetic from the simulated cooling energy. Pure functions, no DOM / three.js.
//
// Model: the simulated day (current date + weather) stands for every cooling day of the season, so
//   saving [kWh/yr]  = (baseline AC kWh/day − design AC kWh/day) × days
//   saving [won/yr]  = saving [kWh/yr] × price [won/kWh]
//   payback [years]  = cost [만원] × 10 000 / saving [won/yr]
// It ignores part replacement, maintenance and the comfort / heat-stress benefit, so it is a floor, not a verdict.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {{ results: { thermal: Record<string, {summary:object}> }, state: { econ: {price:number, days:number, cost:Record<string,number>} }, designIds: string[] }} args
 * @returns {{ baseline: { acKWh: number|null, TroofMax: number|null }, rows: Array<{
 *   id: string, costMan: number, acKWh: number|null, saveKWhDay: number|null, saveKWhYear: number|null,
 *   saveWonYear: number|null, paybackYears: number|null, roofDrop: number|null, status: 'ok'|'none'|'pending' }> }}
 *   paybackYears is null when the design saves nothing; status 'none' = no saving, 'pending' = results not ready.
 */
export function computeEconomics({ results, state, designIds }) {
  const th = results?.thermal || {};
  const econ = state?.econ || {};
  const price = isNum(econ.price) ? econ.price : 0;
  const days = isNum(econ.days) ? econ.days : 0;
  const ref = (id) => {
    const s = th[id]?.summary;
    if (!s) return null;
    return isNum(s.acKWhRef) ? s.acKWhRef : (isNum(s.acKWh) ? s.acKWh : null);
  };
  const base = ref('0');
  const baseRoof = th['0']?.summary?.TroofMax;
  const rows = designIds.map((id) => {
    const costMan = isNum(econ.cost?.[id]) ? econ.cost[id] : 0;
    const a = ref(id);
    const roof = th[id]?.summary?.TroofMax;
    if (a === null || base === null) {
      return { id, costMan, acKWh: a, saveKWhDay: null, saveKWhYear: null, saveWonYear: null, paybackYears: null, roofDrop: null, status: 'pending' };
    }
    const saveDay = base - a;
    const saveYear = saveDay * days;
    const saveWon = saveYear * price;
    const ok = saveWon > 1;
    return {
      id, costMan, acKWh: a, saveKWhDay: saveDay, saveKWhYear: saveYear, saveWonYear: saveWon,
      paybackYears: ok ? (costMan * 10000) / saveWon : null,
      roofDrop: isNum(roof) && isNum(baseRoof) ? baseRoof - roof : null,
      status: ok ? 'ok' : 'none',
    };
  });
  return { baseline: { acKWh: base, TroofMax: isNum(baseRoof) ? baseRoof : null }, rows };
}

/** "27년", "8.4년", "—". Long paybacks are capped so the table stays readable. */
export function formatPayback(years) {
  if (!isNum(years)) return '—';
  if (years > 99) return '99년 초과';
  return years >= 10 ? `${Math.round(years)}년` : `${years.toFixed(1)}년`;
}
