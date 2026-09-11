import { useEffect, useRef } from 'react';

/**
 * Scroll-reveal for landing sections. Elements are armed only after mount, so without JS (or without
 * IntersectionObserver) the content stays visible instead of being stuck at opacity 0. The motion
 * itself is disabled by the global prefers-reduced-motion rule in app.css.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    root.classList.add('reveal-armed');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('reveal-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}
