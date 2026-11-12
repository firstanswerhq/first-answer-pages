/**
 * grade-score.js — turns Check_Results into one Score.
 *
 * Only `pass` and `fail` results count. `ai-named` may carry partial points in
 * `earned`; every other pass earns its full points. Fewer than 40 available
 * points means "not enough to score yet" (score: null).
 */

import { CHECKS } from './grade-checks.js';

export const MIN_AVAILABLE_POINTS = 40;

const byId = new Map(CHECKS.map(c => [c.id, c]));

/**
 * @param {{ id: string, result: string, earned?: number }[]} results
 * @returns {{ score: number|null, earned: number, available: number, failed: number,
 *   counted: number, byGroup: Record<string, { earned: number, available: number }> }}
 */
export function scoreGrade(results) {
  let earned = 0;
  let available = 0;
  let failed = 0;
  let counted = 0;
  const byGroup = {};
  for (const r of Array.isArray(results) ? results : []) {
    const check = byId.get(r?.id);
    if (!check || (r.result !== 'pass' && r.result !== 'fail')) continue;
    counted += 1;
    available += check.points;
    let got = 0;
    if (r.result === 'pass') {
      got = check.points;
      if (check.id === 'ai-named' && Number.isFinite(r.earned)) {
        got = Math.min(check.points, Math.max(0, Math.round(r.earned)));
      }
    } else {
      failed += 1;
    }
    earned += got;
    const g = (byGroup[check.group] ??= { earned: 0, available: 0 });
    g.earned += got;
    g.available += check.points;
  }
  const score = available >= MIN_AVAILABLE_POINTS ? Math.round((100 * earned) / available) : null;
  return { score, earned, available, failed, counted, byGroup };
}
