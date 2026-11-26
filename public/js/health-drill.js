// health-drill.js: interactive drill-down for the health map (Step 1F).
// Progressive enhancement: reads the already-rendered HTML. No new data fetches.
// Keyboard accessible: Enter/Space opens, Escape closes. Focus management included.
// Respects prefers-reduced-motion. Pauses the orb during drill-down.

const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const FAST = motion && motion.matches;

/** Find the health section that contains both the SVG map and the plain list. */
function findSection() {
  return document.querySelector('.health');
}

// ---- Level 1: tap a main circle (health-group heading) to expand ----

function initDrill() {
  const section = findSection();
  if (!section) return;

  const groups = section.querySelectorAll('.health-group[data-main-id]');
  if (groups.length === 0) return;

  // The SVG map area (decoration, aria-hidden) — we fade it during drill-down.
  const mapHost = section.querySelector('[data-health-orb]');

  // Build a close button once and append it to the section.
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'drill-close';
  closeBtn.setAttribute('aria-label', 'Close drill-down');
  closeBtn.appendChild(document.createTextNode('×'));
  closeBtn.hidden = true;
  section.appendChild(closeBtn);

  let expandedGroup = null;
  let expandedRow = null;

  function collapseAll() {
    if (expandedRow) closeDrillPanel();
    if (!expandedGroup) return;
    section.classList.remove('health-drilled');
    if (mapHost) mapHost.style.opacity = '';
    for (const g of groups) {
      g.classList.remove('drill-expanded', 'drill-faded');
      g.removeAttribute('aria-expanded');
    }
    closeBtn.hidden = true;
    // Resume the orb.
    section.classList.remove('health-paused');
    expandedGroup = null;
  }

  function expandGroup(group) {
    if (expandedRow) closeDrillPanel();
    if (expandedGroup === group) { collapseAll(); return; }
    collapseAll();
    expandedGroup = group;
    section.classList.add('health-drilled');
    // Pause the orb so it doesn't distract.
    section.classList.add('health-paused');
    if (mapHost) mapHost.style.opacity = '0.2';
    for (const g of groups) {
      if (g === group) {
        g.classList.add('drill-expanded');
        g.setAttribute('aria-expanded', 'true');
      } else {
        g.classList.add('drill-faded');
      }
    }
    closeBtn.hidden = false;
    // Focus the first sub-check row in the expanded group.
    const firstRow = group.querySelector('.health-row');
    if (firstRow) firstRow.focus();
  }

  // Click on a group heading expands it.
  for (const group of groups) {
    const heading = group.querySelector('h3');
    if (!heading) continue;
    heading.style.cursor = 'pointer';
    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    heading.setAttribute('aria-expanded', 'false');
    heading.addEventListener('click', (e) => {
      e.preventDefault();
      expandGroup(group);
    });
    heading.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        expandGroup(group);
      }
    });
  }

  // Close button.
  closeBtn.addEventListener('click', () => {
    const wasGroup = expandedGroup;
    collapseAll();
    // Return focus to the heading of the group that was expanded.
    if (wasGroup) {
      const h = wasGroup.querySelector('h3');
      if (h) h.focus();
    }
  });

  // Escape closes.
  section.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (expandedRow) {
        closeDrillPanel();
      } else if (expandedGroup) {
        const wasGroup = expandedGroup;
        collapseAll();
        const h = wasGroup.querySelector('h3');
        if (h) h.focus();
      }
    }
  });

  // Click outside closes.
  document.addEventListener('click', (e) => {
    if (!expandedGroup) return;
    if (section.contains(e.target)) return;
    collapseAll();
  });

  // ---- Level 2: tap a sub-check row to show the drill panel ----

  function closeDrillPanel() {
    if (!expandedRow) return;
    const panel = expandedRow.querySelector('.health-drill-panel');
    if (panel) panel.hidden = true;
    expandedRow.classList.remove('drill-row-active');
    expandedRow.focus();
    expandedRow = null;
  }

  function openDrillPanel(row) {
    if (expandedRow === row) { closeDrillPanel(); return; }
    if (expandedRow) closeDrillPanel();
    const panel = row.querySelector('.health-drill-panel');
    if (!panel) return;
    expandedRow = row;
    row.classList.add('drill-row-active');
    panel.hidden = false;
    // Focus the panel.
    panel.setAttribute('tabindex', '-1');
    panel.focus();
  }

  // Make each health-row clickable.
  for (const row of section.querySelectorAll('.health-row[data-drill-sub]')) {
    row.setAttribute('tabindex', '0');
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      // Don't intercept clicks on links or buttons inside the row or panel.
      if (e.target.closest('a, button, form')) return;
      openDrillPanel(row);
    });
    row.addEventListener('keydown', (e) => {
      if (e.target.closest('a, button, form, input')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDrillPanel(row);
      }
    });
    // Wire up the back button inside the panel.
    const backBtn = row.querySelector('.drill-back');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDrillPanel();
      });
    }
  }
}

// Run on load and whenever the DOM changes (the report swaps content in place during rechecks).
initDrill();
if (window.MutationObserver) {
  new MutationObserver(initDrill).observe(document.body, { childList: true, subtree: true });
}
