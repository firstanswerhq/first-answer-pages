// health-orb.js: turns small particles behind the still orb of the report's health map (high-tech-look 2.4).
// Decoration only: the map is aria-hidden and every fact is in the plain list in the page's HTML, so nothing is lost
// without this script. It does nothing when the visitor asks for reduced motion or the browser has no canvas.
// There is never more than one drawing loop per orb, and a loop stops for good when its orb leaves the page (the
// report swaps its content in place while a recheck runs). Off screen, the loop and the CSS dots pause.

const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
// Every running orb: host -> its stop(). An orb swapped out while paused (no frame queued) is stopped by init (W1).
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

  const COUNT = 140;
  const points = [];
  for (let i = 0; i < COUNT; i += 1) {
    // Points spread evenly over a sphere (a Fibonacci sphere).
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = i * 2.399963;
    points.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }

  let angle = 0;
  let frame = 0;
  let onScreen = true;
  let stopped = false;

  const draw = () => {
    if (!host.isConnected) { stop(); return; }
    frame = 0;
    const size = Math.max(1, Math.round(host.clientWidth * (window.devicePixelRatio || 1)));
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const half = size / 2;
    ctx.clearRect(0, 0, size, size);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [x, y, z] of points) {
      const rx = x * cos + z * sin;
      const rz = z * cos - x * sin;
      const depth = (rz + 1) / 2; // 0 at the back, 1 at the front
      ctx.globalAlpha = 0.15 + depth * 0.6;
      ctx.fillStyle = '#67E8F9';
      ctx.beginPath();
      ctx.arc(half + rx * half * 0.86, half + y * half * 0.86, (0.6 + depth * 1.4) * (size / 220), 0, Math.PI * 2);
      ctx.fill();
    }
    angle += 0.004; // slow
    loop();
  };

  // One loop only: any frame already asked for is cancelled before a new one is asked for.
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
  loop();
}

function init() {
  // First stop every orb whose host left the page, so it drops its listeners and its old page at once (W1).
  for (const [host, stop] of [...orbs]) if (!host.isConnected) stop();
  for (const host of document.querySelectorAll('[data-health-orb]')) start(host);
}

init();
// The report page may swap its content in place (a recheck or a scan finishing); start the new orb when it does.
// The old orb's loop stops by itself on its next frame, because its host is no longer in the page.
if (window.MutationObserver) {
  new MutationObserver(init).observe(document.body, { childList: true, subtree: true });
}
