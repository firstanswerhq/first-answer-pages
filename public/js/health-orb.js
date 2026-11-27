// health-orb.js: a glowing wireframe sphere behind the health map (high-tech-look 2.4).
// Decoration only: the map is aria-hidden and every fact is in the plain list in the page's HTML, so nothing is lost
// without this script. It does nothing when the visitor asks for reduced motion or the browser has no canvas.
// There is never more than one drawing loop per orb, and a loop stops for good when its orb leaves the page (the
// report swaps its content in place while a recheck runs). Off screen, the loop and the CSS dots pause.

const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const orbs = new Map();

function start(host) {
  if (!host || host.dataset.orbStarted === '1') return;
  if (motion && motion.matches) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return;
  host.dataset.orbStarted = '1';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const section = host.closest('.health');

  // Wireframe sphere: latitude rings + longitude meridians + orbiting arcs
  const LAT_COUNT = 7;    // horizontal rings
  const LON_COUNT = 10;   // vertical meridians
  const ARC_COUNT = 3;    // glowing orbiting arcs
  const POINTS_PER_RING = 60;

  // Pre-compute ring geometries
  function ringPoints(latAngle) {
    const pts = [];
    const r = Math.cos(latAngle);
    const y = Math.sin(latAngle);
    for (let i = 0; i <= POINTS_PER_RING; i++) {
      const t = (i / POINTS_PER_RING) * Math.PI * 2;
      pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
    }
    return pts;
  }

  function meridianPoints(lonAngle) {
    const pts = [];
    for (let i = 0; i <= POINTS_PER_RING; i++) {
      const lat = (i / POINTS_PER_RING) * Math.PI - Math.PI / 2;
      const r = Math.cos(lat);
      const y = Math.sin(lat);
      pts.push([Math.cos(lonAngle) * r, y, Math.sin(lonAngle) * r]);
    }
    return pts;
  }

  // Build all rings and meridians
  const latRings = [];
  for (let i = 1; i < LAT_COUNT; i++) {
    latRings.push(ringPoints((i / LAT_COUNT) * Math.PI - Math.PI / 2));
  }
  const lonMeridians = [];
  for (let i = 0; i < LON_COUNT; i++) {
    lonMeridians.push(meridianPoints((i / LON_COUNT) * Math.PI));
  }

  // Orbiting glow arcs: tilted great circles that sweep around the sphere
  const arcs = [];
  for (let i = 0; i < ARC_COUNT; i++) {
    const tilt = (i / ARC_COUNT) * Math.PI * 0.6 + 0.3;
    const pts = [];
    for (let j = 0; j <= POINTS_PER_RING; j++) {
      const t = (j / POINTS_PER_RING) * Math.PI * 2;
      const x = Math.cos(t);
      const z = Math.sin(t);
      // Rotate by tilt around X axis
      const ry = z * Math.sin(tilt);
      const rz = z * Math.cos(tilt);
      pts.push([x, ry, rz]);
    }
    arcs.push(pts);
  }

  // Scatter particles on sphere surface for sparkle
  const PARTICLE_COUNT = 80;
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = i * 2.399963;
    particles.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }

  let angle = 0;
  let arcOffset = 0;
  let frame = 0;
  let onScreen = true;
  let stopped = false;
  let lastTime = 0;

  function rotateY(x, y, z, cos, sin) {
    return [x * cos + z * sin, y, z * cos - x * sin];
  }

  function project(x, y, z, half, scale) {
    return [half + x * half * scale, half + y * half * scale, z];
  }

  function drawLine(ctx, pts, cos, sin, half, scale, alpha, color, lineWidth) {
    ctx.beginPath();
    let started = false;
    for (const [x, y, z] of pts) {
      const [rx, ry, rz] = rotateY(x, y, z, cos, sin);
      const depth = (rz + 1) / 2;
      const [px, py] = project(rx, ry, rz, half, scale);
      // Only draw front-facing segments
      if (depth > 0.3) {
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      } else {
        started = false;
      }
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  const draw = (now) => {
    if (!host.isConnected) { stop(); return; }
    // 15fps cap (easy on slower machines)
    if (now - lastTime < 66) { frame = 0; loop(); return; }
    lastTime = now;
    frame = 0;

    const size = Math.max(1, Math.round(host.clientWidth * (window.devicePixelRatio || 1)));
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const half = size / 2;
    const scale = 0.86;
    ctx.clearRect(0, 0, size, size);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // 1. Faint outer glow
    const gradient = ctx.createRadialGradient(half, half, half * 0.5, half, half, half * 0.95);
    gradient.addColorStop(0, 'rgba(103, 232, 249, 0.03)');
    gradient.addColorStop(0.7, 'rgba(103, 232, 249, 0.06)');
    gradient.addColorStop(1, 'rgba(103, 232, 249, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // 2. Wireframe latitude rings
    for (const ring of latRings) {
      drawLine(ctx, ring, cos, sin, half, scale, 0.12, '#67E8F9', size / 400);
    }

    // 3. Wireframe longitude meridians
    for (const meridian of lonMeridians) {
      drawLine(ctx, meridian, cos, sin, half, scale, 0.1, '#67E8F9', size / 500);
    }

    // 4. Glowing orbiting arcs
    const arcColors = ['#67E8F9', '#FBBF24', '#4ADE80'];
    for (let a = 0; a < arcs.length; a++) {
      const arc = arcs[a];
      const speed = 0.7 + a * 0.3;
      const offset = arcOffset * speed + a * 2;
      // Draw only a sweeping segment of the arc
      const segStart = Math.floor((offset % (Math.PI * 2)) / (Math.PI * 2) * POINTS_PER_RING);
      const segLen = Math.floor(POINTS_PER_RING * 0.35);
      ctx.beginPath();
      let started = false;
      for (let j = 0; j < segLen; j++) {
        const idx = (segStart + j) % POINTS_PER_RING;
        const [x, y, z] = arc[idx];
        const [rx, ry, rz] = rotateY(x, y, z, cos, sin);
        const depth = (rz + 1) / 2;
        const [px, py] = project(rx, ry, rz, half, scale);
        if (depth > 0.25) {
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        } else {
          started = false;
        }
      }
      // Fade along the arc length
      const fadeAlpha = 0.4 + Math.sin(offset * 2) * 0.2;
      ctx.globalAlpha = fadeAlpha;
      ctx.strokeStyle = arcColors[a];
      ctx.lineWidth = size / 180;
      ctx.lineWidth = size / 120;
      ctx.stroke();
    }

    // 5. Sparkle particles
    for (const [x, y, z] of particles) {
      const [rx, ry, rz] = rotateY(x, y, z, cos, sin);
      const depth = (rz + 1) / 2;
      const [px, py] = project(rx, ry, rz, half, scale);
      ctx.globalAlpha = 0.1 + depth * 0.5;
      ctx.fillStyle = '#67E8F9';
      ctx.beginPath();
      ctx.arc(px, py, (0.4 + depth * 1.2) * (size / 250), 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Pulsing core glow
    const pulse = 0.04 + Math.sin(now / 1200) * 0.02;
    const coreGlow = ctx.createRadialGradient(half, half, 0, half, half, half * 0.6);
    coreGlow.addColorStop(0, `rgba(103, 232, 249, ${pulse})`);
    coreGlow.addColorStop(1, 'rgba(103, 232, 249, 0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = coreGlow;
    ctx.fillRect(0, 0, size, size);

    angle += 0.003;
    arcOffset += 0.025;
    loop();
  };

  function loop() {
    if (stopped || !onScreen || document.hidden) return;
    if (frame) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(draw);
  }
  function pause() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function onVisibility() {
    if (!host.isConnected) { stop(); return; }
    if (document.hidden) pause();
    else loop();
  }
  function onMotion(e) {
    if (e.matches) stop();
  }

  let watcher = null;
  if (section && window.IntersectionObserver) {
    watcher = new IntersectionObserver(entries => {
      if (!host.isConnected) { stop(); return; }
      onScreen = entries.some(e => e.isIntersecting);
      section.classList.toggle('health-paused', !onScreen);
      if (onScreen) loop();
      else pause();
    });
    watcher.observe(section);
  }

  function stop() {
    stopped = true;
    pause();
    canvas.remove();
    host.dataset.orbStarted = '';
    orbs.delete(host);
    document.removeEventListener('visibilitychange', onVisibility);
    if (motion && motion.removeEventListener) motion.removeEventListener('change', onMotion);
    if (watcher) watcher.disconnect();
  }

  document.addEventListener('visibilitychange', onVisibility);
  if (motion && motion.addEventListener) motion.addEventListener('change', onMotion);
  orbs.set(host, stop);
  // Start paused — the IntersectionObserver will trigger loop() when visible.
  // This prevents the canvas from choking the page during initial load.
  if (!watcher) loop();
}

function init() {
  for (const [host, stop] of [...orbs]) if (!host.isConnected) stop();
  for (const host of document.querySelectorAll('[data-health-orb]')) start(host);
}

init();
if (window.MutationObserver) {
  new MutationObserver(init).observe(document.body, { childList: true, subtree: true });
}
