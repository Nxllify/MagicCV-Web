// Soft falling dots behind the page (the Genshin Optimizer look). Stops when the tab is hidden or the user prefers reduced motion.
export function snow(canvas) {
  const ctx = canvas.getContext('2d');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let w, h, flakes = [], raf;
  const size = () => { w = canvas.width = innerWidth; h = canvas.height = innerHeight; };
  size(); addEventListener('resize', size);
  flakes = Array.from({ length: 70 }, () => ({ x: Math.random() * w, y: Math.random() * h, r: .8 + Math.random() * 2.4, v: .15 + Math.random() * .45, d: Math.random() * 6.28 }));
  let col = '#dfeaff', n = 0;
  const frame = () => {
    if (n++ % 30 === 0) col = getComputedStyle(document.documentElement).getPropertyValue('--snow').trim() || col;
    ctx.clearRect(0, 0, w, h);
    for (const f of flakes) {
      f.y += f.v; f.d += .008; f.x += Math.sin(f.d) * .25;
      if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
      ctx.globalAlpha = .25 + f.r / 5;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  frame();
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) frame(); });
}
