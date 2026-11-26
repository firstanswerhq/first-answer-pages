// home-network.js: the live network on the home page (high-tech-look Step 1D, Requirement 1.8 to 1.13).
//
// The page holds the real nodes as a plain list of links (<nav class="home-network">: each category that has listings,
// and some of its listings). This script reads that list and draws it on a canvas it adds above the list: glowing
// nodes that drift slowly, thin lines between near nodes that fade as they drift apart, and nodes that ease away
// from each other so they never pile up. Moving the pointer near a node lights it and its lines, and nearby nodes lean
// toward the pointer; a tap does the same, and a click or tap on a node opens its real page. Focusing a link in the
// list with the keyboard lights its node.
//
// Limits (1.12): no libraries and no outside files; at most 60 nodes on wide screens and 24 on phones; no drawing while
// the tab is hidden or the network is off screen; at most 30 frames a second; fewer nodes when frames are slow. With
// reduced motion, or no canvas, it draws one still picture (or nothing) and the list stays as it is. The canvas is
// aria-hidden: the list holds every link. Colors come from the page's CSS tokens.
//
// The math is in small pure functions (exported for the tests); the browser part runs only in a browser.

export const MAX_NODES_WIDE = 60;
export const MAX_NODES_PHONE = 24;
export const PHONE_MAX_WIDTH = 600;
export const MIN_NODES = 8;
export const FRAME_MS = 1000 / 30;     // 30 frames a second at most
export const SLOW_FRAME_MS = 50;      // a frame this long counts as slow
export const SLOW_FRAMES_TO_DROP = 10; // this many slow frames in a row drops nodes
export const LINK_DISTANCE = 140;     // lines join nodes nearer than this (CSS px)
export const MIN_SPACING = 56;        // nodes ease apart when nearer than this
export const POINTER_RADIUS = 120;    // nodes within this of the pointer lean toward it
export const HIT_RADIUS = 22;         // a click this near a node opens it
export const LABEL_PX = 12;           // never smaller than 12 px (Requirement 1.5)

/** How many nodes the network may draw: 60 wide, 24 on phones, halved (never under 8) after slow frames. */
export function nodeCap(width, { slowSteps = 0 } = {}) {
  const base = Number(width) <= PHONE_MAX_WIDTH ? MAX_NODES_PHONE : MAX_NODES_WIDE;
  let cap = base;
  for (let i = 0; i < slowSteps; i += 1) cap = Math.max(MIN_NODES, Math.floor(cap / 2));
  return cap;
}

/**
 * The nodes from the page's list: every category first (in the list's order), then listings, taken one per category
 * in turn, until the cap. Only what the list holds; a listing keeps its category's index as `parent`.
 * @param {Array<{ kind: 'category'|'listing', label: string, href: string, category?: number }>} items
 */
export function pickNodes(items, cap) {
  const list = Array.isArray(items) ? items.filter(i => i && typeof i.href === 'string' && typeof i.label === 'string') : [];
  const max = Math.max(0, Math.floor(cap));
  const categories = list.filter(i => i.kind === 'category');
  const nodes = categories.slice(0, max).map((c, index) => ({ kind: 'category', label: c.label, href: c.href, index, parent: null }));
  const byCategory = categories.slice(0, nodes.length).map((_, k) => list.filter(i => i.kind === 'listing' && i.category === k));
  for (let round = 0; nodes.length < max; round += 1) {
    let added = false;
    for (let k = 0; k < byCategory.length && nodes.length < max; k += 1) {
      const l = byCategory[k][round];
      if (!l) continue;
      nodes.push({ kind: 'listing', label: l.label, href: l.href, index: nodes.length, parent: k });
      added = true;
    }
    if (!added) break;
  }
  return nodes;
}

/** A small, fixed pseudo-random sequence (so the still picture is the same on every visit). */
export function seeded(seed = 1) {
  let s = Math.floor(seed) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Starting places: categories spread on a sunflower spiral over the box, each listing near its category. Every node
 * is inside the box, with a margin. Pure: the same nodes and box give the same places.
 */
export function initialPositions(nodes, width, height, seed = 7) {
  const rand = seeded(seed);
  const margin = 24;
  const w = Math.max(1, width - margin * 2);
  const h = Math.max(1, height - margin * 2);
  const cats = nodes.filter(n => n.kind === 'category');
  const golden = Math.PI * (3 - Math.sqrt(5));
  const placed = new Map();
  cats.forEach((c, i) => {
    const r = Math.sqrt((i + 0.5) / Math.max(1, cats.length)) * 0.48;
    const a = i * golden;
    placed.set(c.index, { x: margin + w * (0.5 + r * Math.cos(a)), y: margin + h * (0.5 + r * Math.sin(a)) });
  });
  return nodes.map(n => {
    let x;
    let y;
    if (n.kind === 'category') ({ x, y } = placed.get(n.index));
    else {
      const p = placed.get(n.parent) ?? { x: margin + w / 2, y: margin + h / 2 };
      const a = rand() * Math.PI * 2;
      const d = 30 + rand() * 40;
      x = p.x + Math.cos(a) * d;
      y = p.y + Math.sin(a) * d;
    }
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return {
      ...n,
      x: clamp(x, margin, width - margin),
      y: clamp(y, margin, height - margin),
      vx: (rand() - 0.5) * 0.3,
      vy: (rand() - 0.5) * 0.3,
    };
  });
}

/** A line's opacity for two nodes `d` apart: full-ish when close, fading to 0 at LINK_DISTANCE and beyond. */
export function linkOpacity(d, maxDistance = LINK_DISTANCE, peak = 0.6) {
  if (!Number.isFinite(d) || d < 0 || d >= maxDistance) return 0;
  return peak * (1 - d / maxDistance) ** 1.5;
}

/** Pairs of node indexes to join, with their opacity (only near pairs). A listing always joins its own category. */
export function links(nodes, maxDistance = LINK_DISTANCE) {
  const out = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      const family = (nodes[i].kind === 'listing' && nodes[i].parent === nodes[j].index)
        || (nodes[j].kind === 'listing' && nodes[j].parent === nodes[i].index);
      const o = linkOpacity(d, family ? maxDistance * 1.5 : maxDistance);
      if (o > 0) out.push({ a: i, b: j, opacity: o });
    }
  }
  return out;
}

/**
 * One step of the drift, pure: each node moves by its velocity (scaled by `dt`, 1 = one 30 fps frame), nodes nearer
 * than MIN_SPACING ease apart, nodes near the pointer lean toward it, a listing is drawn gently back toward its
 * category, and nodes bounce off the edges so they stay in the box. Returns new nodes.
 * @param {{ width: number, height: number, pointer?: { x: number, y: number } | null, dt?: number }} opts
 */
export function step(nodes, { width, height, pointer = null, dt = 1 } = {}) {
  const margin = 12;
  const next = nodes.map(n => ({ ...n }));
  for (let i = 0; i < next.length; i += 1) {
    const n = next[i];
    let ax = 0;
    let ay = 0;
    for (let j = 0; j < next.length; j += 1) {
      if (i === j) continue;
      const dx = n.x - nodes[j].x;
      const dy = n.y - nodes[j].y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < MIN_SPACING) {
        const push = ((MIN_SPACING - d) / MIN_SPACING) * 0.08;
        ax += (dx / d) * push;
        ay += (dy / d) * push;
      }
    }
    if (n.kind === 'listing' && Number.isInteger(n.parent)) {
      const p = nodes.find(m => m.kind === 'category' && m.index === n.parent);
      if (p) {
        const d = Math.hypot(p.x - n.x, p.y - n.y);
        if (d > LINK_DISTANCE) {
          ax += ((p.x - n.x) / d) * 0.02;
          ay += ((p.y - n.y) / d) * 0.02;
        }
      }
    }
    if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
      const dx = pointer.x - n.x;
      const dy = pointer.y - n.y;
      const d = Math.hypot(dx, dy);
      if (d > 1 && d < POINTER_RADIUS) {
        const lean = ((POINTER_RADIUS - d) / POINTER_RADIUS) * 0.05;
        ax += (dx / d) * lean;
        ay += (dy / d) * lean;
      }
    }
    // Ease: a little friction so the drift stays slow, then a gentle speed limit.
    n.vx = (n.vx + ax * dt) * 0.98;
    n.vy = (n.vy + ay * dt) * 0.98;
    const speed = Math.hypot(n.vx, n.vy);
    const maxSpeed = 0.6;
    if (speed > maxSpeed) {
      n.vx = (n.vx / speed) * maxSpeed;
      n.vy = (n.vy / speed) * maxSpeed;
    }
    // Keep a slow drift going, so the network never stops dead.
    if (speed < 0.04) {
      n.vx += (n.index % 2 === 0 ? 0.02 : -0.02);
      n.vy += (n.index % 3 === 0 ? 0.02 : -0.02);
    }
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    if (n.x < margin) { n.x = margin; n.vx = Math.abs(n.vx); }
    if (n.x > width - margin) { n.x = width - margin; n.vx = -Math.abs(n.vx); }
    if (n.y < margin) { n.y = margin; n.vy = Math.abs(n.vy); }
    if (n.y > height - margin) { n.y = height - margin; n.vy = -Math.abs(n.vy); }
  }
  return next;
}

/** The node nearest (x, y) within `radius`, or -1. */
export function nearestNode(nodes, x, y, radius = HIT_RADIUS) {
  let best = -1;
  let bestD = radius;
  nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

/** One still picture instead of the drift: with reduced motion, or when the canvas can't draw. */
export function stillMode({ reducedMotion = false, hasCanvas = true } = {}) {
  return reducedMotion === true || hasCanvas !== true;
}

/** Whether to draw now: never faster than 30 frames a second. */
export function shouldDraw(now, last, frameMs = FRAME_MS) {
  return !Number.isFinite(last) || now - last >= frameMs - 0.5;
}

/** After a frame: how many slow frames in a row, and whether to drop to fewer nodes now. */
export function frameCheck(frameMs, slowInARow) {
  const slow = frameMs > SLOW_FRAME_MS ? slowInARow + 1 : 0;
  return { slowInARow: slow >= SLOW_FRAMES_TO_DROP ? 0 : slow, drop: slow >= SLOW_FRAMES_TO_DROP };
}

/** Whether to run the loop at all: not while hidden or off screen. */
export function shouldRun({ hidden = false, onScreen = true, still = false } = {}) {
  return !hidden && onScreen && !still;
}

// ---- the browser part -------------------------------------------------------------------------------------------

/** The list's links as items (the only source of nodes). */
function readList(nav) {
  const items = [];
  const cats = [...nav.querySelectorAll('.network-category')];
  cats.forEach((li, k) => {
    const a = li.querySelector('a[data-node="category"]');
    if (a) items.push({ kind: 'category', label: a.textContent.trim(), href: a.getAttribute('href'), el: a });
    for (const l of li.querySelectorAll('a[data-node="listing"]')) {
      items.push({ kind: 'listing', label: l.textContent.trim(), href: l.getAttribute('href'), category: k, el: l });
    }
  });
  return items;
}

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function start(nav) {
  const items = readList(nav);
  if (items.length === 0) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'network-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx2d = canvas.getContext && canvas.getContext('2d');
  const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  if (!ctx2d) return; // no canvas: the list is the whole thing
  nav.insertBefore(canvas, nav.firstChild);
  nav.classList.add('has-canvas');

  const colors = {
    category: token('--color-primary', 'cyan'),
    listing: token('--color-gold', 'orange'),
    accent: token('--color-accent', 'pink'),
    text: token('--color-text', 'white'),
    line: token('--color-primary', 'cyan'),
  };
  let width = 0;
  let height = 0;
  let slowSteps = 0;
  let nodes = [];
  let pointer = null;
  let lit = -1;
  let running = false;
  let onScreen = true;
  let last = NaN;
  let slowInARow = 0;

  function layout() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
    const picked = pickNodes(items, nodeCap(width, { slowSteps }));
    nodes = initialPositions(picked, width, height);
  }

  function draw() {
    ctx2d.clearRect(0, 0, width, height);
    const near = lit >= 0 ? nodes[lit] : null;
    for (const l of links(nodes)) {
      const on = l.a === lit || l.b === lit;
      ctx2d.globalAlpha = on ? Math.min(1, l.opacity + 0.35) : l.opacity;
      ctx2d.strokeStyle = on ? colors.accent : colors.line;
      ctx2d.lineWidth = on ? 1.6 : 1;
      ctx2d.beginPath();
      ctx2d.moveTo(nodes[l.a].x, nodes[l.a].y);
      ctx2d.lineTo(nodes[l.b].x, nodes[l.b].y);
      ctx2d.stroke();
    }
    nodes.forEach((n, i) => {
      const on = i === lit;
      const r = n.kind === 'category' ? 6 : 3.5;
      ctx2d.globalAlpha = 1;
      ctx2d.shadowColor = on ? colors.accent : (n.kind === 'category' ? colors.category : colors.listing);
      ctx2d.shadowBlur = on ? 16 : 8;
      ctx2d.fillStyle = on ? colors.accent : (n.kind === 'category' ? colors.category : colors.listing);
      ctx2d.beginPath();
      ctx2d.arc(n.x, n.y, on ? r + 2 : r, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.shadowBlur = 0;
      if (n.kind === 'category' || on) {
        ctx2d.font = `${n.kind === 'category' ? 700 : 600} ${LABEL_PX}px "Fira Sans Condensed", "Arial Narrow", Arial, sans-serif`;
        ctx2d.fillStyle = colors.text;
        ctx2d.textAlign = 'center';
        ctx2d.fillText(n.label, n.x, n.y - r - 6);
      }
    });
    ctx2d.globalAlpha = 1;
    if (near) canvas.style.cursor = 'pointer';
    else canvas.style.cursor = 'default';
  }

  function frame(now) {
    if (!running) return;
    window.requestAnimationFrame(frame);
    if (!shouldDraw(now, last)) return;
    const dt = Number.isFinite(last) ? Math.min(3, (now - last) / FRAME_MS) : 1;
    const t0 = performance.now();
    nodes = step(nodes, { width, height, pointer, dt });
    draw();
    const check = frameCheck(performance.now() - t0 + (Number.isFinite(last) ? Math.max(0, now - last - FRAME_MS) : 0), slowInARow);
    slowInARow = check.slowInARow;
    if (check.drop && nodeCap(width, { slowSteps: slowSteps + 1 }) < nodes.length) {
      slowSteps += 1;
      nodes = nodes.slice(0, nodeCap(width, { slowSteps }));
    }
    last = now;
  }

  const still = stillMode({ reducedMotion: reduced, hasCanvas: true });
  function update() {
    const run = shouldRun({ hidden: document.hidden, onScreen, still });
    if (run && !running) {
      running = true;
      last = NaN;
      window.requestAnimationFrame(frame);
    } else if (!run) {
      running = false;
    }
  }

  layout();
  draw();

  // Pointer and tap: light the nearest node; nearby nodes lean toward the pointer; a click opens the node's page.
  const at = e => {
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  canvas.addEventListener('pointermove', e => {
    pointer = still ? null : at(e);
    const p = at(e);
    lit = nearestNode(nodes, p.x, p.y, POINTER_RADIUS / 2);
    if (still || !running) draw();
  });
  canvas.addEventListener('pointerleave', () => { pointer = null; lit = -1; draw(); });
  canvas.addEventListener('click', e => {
    const p = at(e);
    const i = nearestNode(nodes, p.x, p.y, HIT_RADIUS);
    if (i >= 0) window.location.assign(nodes[i].href);
  });
  // Keyboard: focusing a link in the list lights its node.
  nav.addEventListener('focusin', e => {
    const href = e.target?.getAttribute?.('href');
    lit = nodes.findIndex(n => n.href === href);
    draw();
  });
  nav.addEventListener('focusout', () => { lit = -1; draw(); });

  // Stop when the tab is hidden or the network is off screen.
  document.addEventListener('visibilitychange', update);
  if (typeof window.IntersectionObserver === 'function') {
    new IntersectionObserver(entries => {
      onScreen = entries.some(e => e.isIntersecting);
      update();
    }).observe(canvas);
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { layout(); draw(); }, 150);
  });
  // A change to reduced motion mid-visit stops the drift; the still picture stays.
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', ev => {
    if (ev.matches) { running = false; draw(); }
  });
  update();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const nav = document.querySelector('.home-network');
  if (nav) start(nav);
}
