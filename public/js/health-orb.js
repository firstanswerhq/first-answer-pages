// health-orb.js: turns small particles behind the still orb of the report's health map (high-tech-look 2.4).
// Decoration only: the map is aria-hidden and every fact is in the plain list in the page's HTML, so nothing is lost
// without this script. It does nothing when the visitor asks for reduced motion or the browser has no canvas.

const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function start(host) {
  if (!host || host.dataset.orbStarted === '1') return;
  if (motion && motion.matches) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return;
  host.dataset.orbStarted = '1';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

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
  const draw = () => {
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
    frame = window.requestAnimationFrame(draw);
  };
  frame = window.requestAnimationFrame(draw);

  const stop = () => {
    window.cancelAnimationFrame(frame);
    canvas.remove();
    host.dataset.orbStarted = '';
  };
  if (motion && motion.addEventListener) motion.addEventListener('change', e => { if (e.matches) stop(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.cancelAnimationFrame(frame);
    else if (host.dataset.orbStarted === '1') frame = window.requestAnimationFrame(draw);
  });
}

function init() {
  for (const host of document.querySelectorAll('[data-health-orb]')) start(host);
}

init();
// The report page may swap its content in place (a recheck finishing); start the orb again when it does.
if (window.MutationObserver) {
  const main = document.querySelector('main') ?? document.body;
  new MutationObserver(init).observe(main.parentNode ?? document.body, { childList: true, subtree: true });
}
