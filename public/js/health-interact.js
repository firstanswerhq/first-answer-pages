// health-interact.js — canvas interactive drill-down for the health map.
// Progressive enhancement · keyboard accessible · respects prefers-reduced-motion.
const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const FAST = motion && motion.matches;
const COLORS = { good:'#4ADE80', partly:'#FBBF24', missing:'#F87171', not_checked:'#94A3B8', info:'#67E8F9' };
const BG_DARK = 'rgba(11,16,32,0.92)';
const TEXT_LIGHT = '#E2E8F0';
const TEXT_DIM = '#94A3B8';

function extractModel(section) {
  const groups = section.querySelectorAll('.health-group[data-main-id]');
  if (!groups.length) return null;
  const mains = [];
  for (const g of groups) {
    const id = g.dataset.mainId;
    const statusCls = [...g.classList].find(c => c.startsWith('health-') && c !== 'health-group');
    const status = statusCls ? statusCls.replace('health-', '') : 'not_checked';
    const h3 = g.querySelector('h3');
    const nameEl = h3 ? h3.querySelector('.health-group-name') : null;
    const statusEl = h3 ? h3.querySelector('.health-status') : null;
    const name = nameEl ? nameEl.textContent.replace(/:$/, '').trim() : id;
    const label = statusEl ? statusEl.textContent.trim() : '';
    const subs = [];
    for (const row of g.querySelectorAll('.health-row[data-drill-sub]')) {
      const subName = row.dataset.drillSub;
      const subStatusCls = [...row.classList].find(c => c.startsWith('health-') && c !== 'health-row');
      const subStatus = subStatusCls ? subStatusCls.replace('health-', '') : 'not_checked';
      const subLabel = row.querySelector('.health-status');
      const panel = row.querySelector('.health-drill-panel');
      subs.push({
        name: subName,
        status: subStatus,
        label: subLabel ? subLabel.textContent.trim() : '',
        panelHtml: panel ? panel.innerHTML : '',
      });
    }
    mains.push({ id, name, status, label, subs });
  }
  return { mains };
}

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function nodePositions(mains, w, h) {
  const scale = Math.min(w, h) / 1000;
  const cx = w / 2;
  const cy = h / 2;
  const rMain = 280 * scale;
  const rNode = 86 * scale;
  const rSubAt = 150 * scale;
  const rSub = 18 * scale;
  const n = mains.length;
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const deg = -90 + (i * 360) / n;
    const [x, y] = polar(cx, cy, rMain, deg);
    const subs = mains[i].subs;
    const spread = subs.length > 1 ? Math.min(150, 9 * (subs.length - 1)) : 0;
    const subNodes = [];
    for (let k = 0; k < subs.length; k++) {
      const a = subs.length > 1 ? deg - spread / 2 + (k * spread) / (subs.length - 1) : deg;
      const [sx, sy] = polar(x, y, rSubAt, a);
      subNodes.push({ x: sx, y: sy, r: rSub, angle: a, ...subs[k] });
    }
    nodes.push({ x, y, r: rNode, deg, subNodes, ...mains[i] });
  }
  return { nodes, cx, cy, scale, rMain, rNode };
}

function initInteract() {
  const section = document.querySelector('.health');
  if (!section) return;
  if (section.dataset.interactStarted === '1') return;

  const model = extractModel(section);
  if (!model || model.mains.length === 0) return;

  const artHost = section.querySelector('.health-art');
  if (!artHost) return;

  section.dataset.interactStarted = '1';

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:2;pointer-events:auto;cursor:pointer;';
  artHost.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const panelOverlay = document.createElement('div');
  panelOverlay.className = 'interact-panel';
  panelOverlay.hidden = true;
  panelOverlay.setAttribute('role', 'dialog');
  panelOverlay.setAttribute('aria-label', 'Health check details');
  panelOverlay.setAttribute('tabindex', '-1');
  artHost.parentNode.appendChild(panelOverlay);

  let activeMain = null;
  let activeSub = null;
  let animT = 0;
  let targetT = 0;
  let subAnimT = 0;    // 0 = subs hidden, 1 = subs visible
  let subTargetT = 0;
  let frameId = null;
  let lastTime = 0;
  let pulseAngle = 0;
  let subOrbitAngle = 0;

  // Size the canvas
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = artHost.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, dpr };
  }

  // ---- Drawing ----

  function draw(now) {
    frameId = requestAnimationFrame(draw);
    if (now - lastTime < 33) return; // 30fps cap
    lastTime = now;

    const { w, h, dpr } = resize();
    ctx.clearRect(0, 0, w, h);

    // Advance animation
    const dt = FAST ? 1 : 0.08;
    if (animT < targetT) animT = Math.min(animT + dt, targetT);
    else if (animT > targetT) animT = Math.max(animT - dt, targetT);
    if (subAnimT < subTargetT) subAnimT = Math.min(subAnimT + dt * 0.7, subTargetT);
    else if (subAnimT > targetT) subAnimT = Math.max(subAnimT - dt, 0);
    pulseAngle += 0.04;
    subOrbitAngle += 0.012;

    if (animT < 0.01 && targetT === 0) return; // nothing to draw in idle state

    const layout = nodePositions(model.mains, w, h);
    const { nodes, cx, cy, scale } = layout;

    // Draw dimmed state for non-active nodes
    for (const node of nodes) {
      const isActive = activeMain && node.id === activeMain.id;

      if (animT > 0 && !isActive) {
        // Fade non-active nodes
        const alpha = 0.15 * animT;
        ctx.save();
        ctx.globalAlpha = alpha;
        drawNodeCircle(ctx, node, scale, false);
        ctx.restore();
      }

      if (isActive && animT > 0) {
        // Draw active node with glow
        ctx.save();
        drawActiveNode(ctx, node, scale, animT);

        // Draw sub-nodes if drilled
        if (subAnimT > 0) {
          drawSubNodes(ctx, node, scale, subAnimT);
        }
        ctx.restore();
      }
    }

    // If nothing is active but animT is decaying, draw the idle highlight hints
    if (!activeMain && animT < 0.01) {
      // Subtle glow hints on hover-able nodes
    }
  }

  function drawNodeCircle(ctx, node, scale, active) {
    const color = COLORS[node.status] || COLORS.not_checked;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // Name text
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `${Math.round(14 * scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, node.x, node.y);
  }

  function drawActiveNode(ctx, node, scale, t) {
    const color = COLORS[node.status] || COLORS.not_checked;
    const pulse = 1 + 0.06 * Math.sin(pulseAngle) * t;
    const r = node.r * pulse;

    // Outer glow rings
    for (let i = 3; i > 0; i--) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + i * 8 * scale * t, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.08 * t * (4 - i) / 3;
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Main ring
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * scale * t;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20 * scale * t;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill with semi-transparent dark
    ctx.beginPath();
    ctx.arc(node.x, node.y, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = BG_DARK;
    ctx.globalAlpha = 0.7 * t;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Name text (brighter when active)
    ctx.fillStyle = TEXT_LIGHT;
    ctx.font = `bold ${Math.round(16 * scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, node.x, node.y - 8 * scale);

    // Status label
    ctx.fillStyle = color;
    ctx.font = `${Math.round(13 * scale)}px system-ui, sans-serif`;
    ctx.fillText(node.label, node.x, node.y + 14 * scale);
  }

  function drawSubNodes(ctx, node, scale, t) {
    const subs = node.subNodes;
    if (!subs || !subs.length) return;

    const spread = subs.length > 1 ? Math.min(150, 9 * (subs.length - 1)) : 0;
    const rOrbit = (100 + 50 * t) * scale;

    for (let k = 0; k < subs.length; k++) {
      const sub = subs[k];
      const baseAngle = subs.length > 1
        ? node.deg - spread / 2 + (k * spread) / (subs.length - 1)
        : node.deg;
      // Slight orbital drift for life
      const angle = baseAngle + Math.sin(subOrbitAngle + k * 0.7) * 3;
      const [sx, sy] = polar(node.x, node.y, rOrbit, angle);
      sub._drawX = sx;
      sub._drawY = sy;
      sub._drawR = sub.r * t;

      const color = COLORS[sub.status] || COLORS.not_checked;
      const isActiveSub = activeSub && activeSub.name === sub.name;

      // Connection line from main to sub
      ctx.beginPath();
      const [lx1, ly1] = polar(node.x, node.y, node.r + 4 * scale, angle);
      const [lx2, ly2] = polar(node.x, node.y, rOrbit - sub.r * t - 2, angle);
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3 * t;
      ctx.lineWidth = 1.5 * scale;
      ctx.setLineDash([4 * scale, 4 * scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Sub node circle
      const subPulse = isActiveSub ? 1 + 0.08 * Math.sin(pulseAngle * 1.5) : 1;
      const sr = sub.r * t * subPulse;

      // Glow
      ctx.beginPath();
      ctx.arc(sx, sy, sr + 4 * scale, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = (isActiveSub ? 0.2 : 0.08) * t;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Ring
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = (isActiveSub ? 2.5 : 1.5) * scale;
      if (isActiveSub) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 * scale;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill
      ctx.beginPath();
      ctx.arc(sx, sy, sr - 1, 0, Math.PI * 2);
      ctx.fillStyle = BG_DARK;
      ctx.globalAlpha = 0.8 * t;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Status symbol
      const symbols = { good: '✓', partly: '!', missing: '✕', not_checked: '?', info: 'i' };
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(12 * scale * t)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbols[sub.status] || '?', sx, sy);
    }
  }

  // ---- Hit testing ----

  function getNodeAt(px, py) {
    const { w, h } = resize();
    const layout = nodePositions(model.mains, w, h);
    for (const node of layout.nodes) {
      const dx = px - node.x;
      const dy = py - node.y;
      if (dx * dx + dy * dy <= node.r * node.r) return { type: 'main', node };
    }
    // If drilled, check sub-nodes
    if (activeMain) {
      const mainNode = layout.nodes.find(n => n.id === activeMain.id);
      if (mainNode && mainNode.subNodes) {
        for (const sub of mainNode.subNodes) {
          if (sub._drawX === undefined) continue;
          const dx = px - sub._drawX;
          const dy = py - sub._drawY;
          const r = sub._drawR || sub.r;
          if (dx * dx + dy * dy <= (r + 10) * (r + 10)) return { type: 'sub', node: sub, mainNode };
        }
      }
    }
    return null;
  }

  // ---- Panel ----

  function showPanel(sub) {
    if (!sub.panelHtml) return;
    activeSub = sub;
    panelOverlay.innerHTML = `<div class="interact-panel-inner">
      <button type="button" class="interact-panel-close" aria-label="Close">×</button>
      <h4 class="interact-panel-title"><span class="interact-dot interact-dot-${sub.status}"></span>${escapeText(sub.name)}</h4>
      <p class="interact-panel-label">${escapeText(sub.label)}</p>
      <div class="interact-panel-body">${sub.panelHtml}</div>
    </div>`;
    panelOverlay.hidden = false;
    panelOverlay.focus();

    const closeBtn = panelOverlay.querySelector('.interact-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hidePanel();
      });
    }
  }

  function hidePanel() {
    activeSub = null;
    panelOverlay.hidden = true;
  }

  function escapeText(s) {
    const d = document.createElement('span');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  // ---- Interaction ----

  function activate(mainNode) {
    if (activeMain && activeMain.id === mainNode.id) {
      deactivate();
      return;
    }
    activeMain = mainNode;
    activeSub = null;
    hidePanel();
    targetT = 1;
    subTargetT = 1;
    section.classList.add('health-paused', 'health-drilled');

    // Also trigger the HTML drill for screen readers
    const htmlGroup = section.querySelector(`.health-group[data-main-id="${mainNode.id}"]`);
    if (htmlGroup) {
      for (const g of section.querySelectorAll('.health-group[data-main-id]')) {
        if (g === htmlGroup) {
          g.classList.add('drill-expanded');
          g.setAttribute('aria-expanded', 'true');
        } else {
          g.classList.add('drill-faded');
        }
      }
    }
  }

  function deactivate() {
    activeMain = null;
    activeSub = null;
    targetT = 0;
    subTargetT = 0;
    hidePanel();
    section.classList.remove('health-paused', 'health-drilled');
    for (const g of section.querySelectorAll('.health-group[data-main-id]')) {
      g.classList.remove('drill-expanded', 'drill-faded');
      g.removeAttribute('aria-expanded');
    }
  }

  // ---- Events ----

  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return [(e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr];
  }

  canvas.addEventListener('click', (e) => {
    const [px, py] = canvasXY(e);
    const hit = getNodeAt(px, py);
    if (!hit) {
      if (activeMain) deactivate();
      return;
    }
    if (hit.type === 'main') {
      e.preventDefault();
      e.stopPropagation();
      activate(hit.node);
    } else if (hit.type === 'sub') {
      e.preventDefault();
      e.stopPropagation();
      showPanel(hit.node);
    }
  });

  // Hover cursor
  canvas.addEventListener('mousemove', (e) => {
    const [px, py] = canvasXY(e);
    const hit = getNodeAt(px, py);
    canvas.style.cursor = hit ? 'pointer' : 'default';
  });

  // Keyboard: use the SVG node links as keyboard targets
  for (const link of artHost.querySelectorAll('.health-node-link')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const branch = link.closest('[data-main]');
      if (!branch) return;
      const mainId = branch.dataset.main;
      const mainData = model.mains.find(m => m.id === mainId);
      if (mainData) activate(mainData);
    });
  }

  // Escape
  section.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (activeSub) { hidePanel(); e.stopPropagation(); }
      else if (activeMain) { deactivate(); e.stopPropagation(); }
    }
  });

  // Click outside panel closes it
  panelOverlay.addEventListener('click', (e) => {
    if (e.target === panelOverlay) hidePanel();
  });

  // Start the draw loop
  if (!FAST) {
    frameId = requestAnimationFrame(draw);
  }
}

// Run on load and reinitialise if the DOM changes (rechecks swap content).
initInteract();
if (window.MutationObserver) {
  new MutationObserver(() => {
    if (!document.querySelector('.health[data-interact-started="1"]')) {
      initInteract();
    }
  }).observe(document.body, { childList: true, subtree: true });
}
