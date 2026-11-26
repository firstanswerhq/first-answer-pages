// health-scan.js: the one-time "scan" when the health map first comes into view (high-tech-look 2.10).
// About 3 seconds, once per page load: the main nodes light up one at a time in a fixed order, a caption under the map
// names each check as it lights up, and the center counts up to the score. The final state is exactly the normal map:
// every class added is removed and the score text is put back as the server wrote it. No scan with reduced motion, a
// hidden tab, no IntersectionObserver, or JavaScript off: the map simply shows its final state. The caption is
// aria-hidden (the list already has every fact) and the map itself is aria-hidden.

export const SCAN_MS = 3000;

/** Whether to play the scan at all (pure, so it can be tested). */
export function shouldScan({ reducedMotion = false, hidden = false, hasObserver = true, played = false } = {}) {
  return !reducedMotion && !hidden && hasObserver && !played;
}

/**
 * The steps of the scan (pure). `nodes` are the main nodes in their fixed order, each { id, caption } where the caption
 * is the node's own words ("Website: Partly"); `score` is the report's score or null. Every step says which nodes are
 * lit, what the caption says and what number the center shows; the last step is the final state: every node lit, no
 * caption, the score exactly.
 * @returns {Array<{ at: number, lit: string[], caption: string, count: number|null }>}
 */
export function scanPlan(nodes, score, durationMs = SCAN_MS) {
  const list = Array.isArray(nodes) ? nodes.filter(n => n && typeof n.id === 'string') : [];
  const final = Number.isInteger(score) ? score : null;
  const steps = [];
  const each = list.length > 0 ? durationMs / (list.length + 1) : durationMs;
  list.forEach((node, i) => {
    const at = Math.round(each * (i + 1));
    steps.push({
      at,
      lit: list.slice(0, i + 1).map(n => n.id),
      caption: String(node.caption ?? ''),
      count: final === null ? null : Math.min(final, Math.round((final * (i + 1)) / (list.length + 1))),
    });
  });
  steps.push({ at: durationMs, lit: list.map(n => n.id), caption: '', count: final });
  return steps;
}

let played = false;

function run(section) {
  const svg = section.querySelectorAll('.health-svg');
  const branches = [...section.querySelectorAll('.health-svg-full .health-branch, .health-svg-phone .health-branch')];
  const caption = section.querySelector('[data-health-caption]');
  const scoreTexts = [...section.querySelectorAll('.health-orb-score[data-score]')];
  const original = scoreTexts.map(t => t.textContent);
  const order = [...new Set(branches.map(b => b.dataset.main))];
  const nodes = order.map(id => {
    const title = section.querySelector(`.health-svg-full .health-branch[data-main="${id}"] .health-node title`);
    return { id, caption: title ? title.textContent : '' };
  });
  const score = scoreTexts.length ? Number(scoreTexts[0].dataset.score) : null;
  const steps = scanPlan(nodes, Number.isInteger(score) ? score : null);
  if (svg.length === 0 || steps.length === 0) return;

  // Batch 3 X12: every timer and the motion listener are kept, and cleared when the scan ends either way.
  const timers = [];
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotion = e => { if (e.matches) finish(); };
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    for (const t of timers) window.clearTimeout(t);
    motion?.removeEventListener?.('change', onMotion);
    // The final state is the normal map: nothing the scan added is left behind.
    section.classList.remove('health-scanning');
    for (const b of branches) b.classList.remove('health-on');
    scoreTexts.forEach((t, i) => { t.textContent = original[i]; });
    if (caption) caption.textContent = '';
  }
  stopScan = finish; // batch 4 Y2: printing mid-scan shows the final state at once
  section.classList.add('health-scanning');
  if (caption) caption.textContent = '';
  for (const step of steps) {
    timers.push(window.setTimeout(() => {
      if (done || !section.isConnected) return;
      for (const b of branches) b.classList.toggle('health-on', step.lit.includes(b.dataset.main));
      if (caption) caption.textContent = step.caption;
      // Batch 5 K20 (owner-approval deviation from 2.10.1): the center keeps the real score the whole time, so a
      // screenshot mid-scan never shows a number other than the score.
    }, step.at));
  }
  timers.push(window.setTimeout(finish, steps[steps.length - 1].at + 50));
  // Stop at once if the visitor turns reduced motion on mid-scan.
  motion?.addEventListener?.('change', onMotion);
}

/** The part watched: the map itself, not the tall section with its list (batch 3 X1). */
export const SCAN_TARGET = '.health-map';
export const SCAN_THRESHOLD = 0.5;

/** The printable report (13.4) never plays the scan (batch 4 Y2). */
export const PRINT_PAGE = '.grade-print';

let waiting = null; // the MutationObserver that waits for a map, or for a new one after a swap
let observer = null; // the IntersectionObserver on the map being watched
let watched = null; // the `.health` section being watched
let stopScan = null; // ends a scan that is playing

function stopWaiting() {
  if (waiting) {
    waiting.disconnect();
    waiting = null;
  }
}

function watch() {
  if (document.querySelector(PRINT_PAGE)) return;
  // Batch 3 X2 and batch 4 Y6: until the scan has played, watch the page for a map that appears (the "Checking..."
  // page swaps the report in) or is replaced ("Check again" swaps the report), and watch the new map instead.
  if (!played && !waiting && window.MutationObserver) {
    waiting = new MutationObserver(() => {
      const now = document.querySelector('.health');
      if (!now || now === watched) return;
      if (observer) observer.disconnect();
      observer = null;
      watched = null;
      watch();
    });
    waiting.observe(document.body, { childList: true, subtree: true });
  }
  const section = document.querySelector('.health');
  if (!section || section === watched) return;
  const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const hasObserver = typeof window.IntersectionObserver === 'function';
  if (!shouldScan({ reducedMotion, hidden: document.hidden, hasObserver, played })) {
    stopWaiting();
    return;
  }
  const target = section.querySelector(SCAN_TARGET) ?? section;
  watched = section;
  observer = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    observer.disconnect();
    observer = null;
    stopWaiting();
    // Checked again at the moment it comes into view: a hidden tab or reduced motion means no scan.
    const motionNow = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (!shouldScan({ reducedMotion: motionNow, hidden: document.hidden, hasObserver, played })) return;
    if (!section.isConnected || document.querySelector(PRINT_PAGE)) return;
    played = true; // once per page load, so a later "Check again" swap doesn't replay it
    run(section);
  }, { threshold: SCAN_THRESHOLD });
  observer.observe(target);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Printing while the scan plays shows the final map, with the real score.
  window.addEventListener?.('beforeprint', () => { if (stopScan) stopScan(); });
  watch();
}
