// Client motion layer: scroll-reveal (staggered), count-up numbers, and a
// header that condenses on scroll. All respect prefers-reduced-motion.

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initReveal(): void {
  const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (reduce()) { els.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        const delay = el.dataset.revealDelay;
        if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);
        el.classList.add('in');
        io.unobserve(el);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );
  els.forEach((el) => io.observe(el));
}

export function initCountUp(): void {
  const els = document.querySelectorAll<HTMLElement>('[data-count]');
  const run = (el: HTMLElement) => {
    const target = parseFloat(el.dataset.count || '0');
    const decimals = parseInt(el.dataset.countDecimals || '0', 10);
    const prefix = el.dataset.countPrefix || '';
    const suffix = el.dataset.countSuffix || '';
    if (reduce()) { el.textContent = prefix + target.toFixed(decimals) + suffix; return; }
    const dur = 1100;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = target * eased;
      el.textContent = prefix + val.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { run(e.target as HTMLElement); io.unobserve(e.target); }
  }, { threshold: 0.5 });
  els.forEach((el) => io.observe(el));
}

export function initHeader(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

export function initAll(): void {
  initReveal();
  initCountUp();
  initHeader();
}
