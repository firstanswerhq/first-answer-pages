// Turns Check_Results into a Score. Pure function.

import { CHECKS } from './grade-checks.js';

const MIN_AVAILABLE = 40;

/**
 * @param {{id:string,result:string,earned?:number}[]} results
 * @returns {{score:number|null, earned:number, available:number, failed:number,
 *   counted:number, byGroup:Record<string,{earned:number,available:number}>}}
 */
export function scoreGrade(results) {
  const byId = new Map(CHECKS.map(c => [c.id, c]));
  let earned = 0;
  let available = 0;
  let failed = 0;
  let counted = 0;
  const byGroup = {};

  for (const r of Array.isArray(results) ? results : []) {
    const check = byId.get(r?.id);
    if (!check) continue;
    if (r.result !== 'pass' && r.result !== 'fail') continue;

    let pts = 0;
    if (r.result === 'pass') {
      pts = check.points;
      if (check.id === 'ai-named') {
        const e = Number(r.earned);
        pts = Number.isFinite(e) ? Math.max(0, Math.min(check.points, e)) : 0;
      }
    } else {
      failed += 1;
    }

    counted += 1;
    available += check.points;
    earned += pts;
    const g = byGroup[check.group] || (byGroup[check.group] = { earned: 0, available: 0 });
    g.earned += pts;
    g.available += check.points;
  }

  const score = available >= MIN_AVAILABLE ? Math.round((100 * earned) / available) : null;
  return { score, earned, available, failed, counted, byGroup };
}
