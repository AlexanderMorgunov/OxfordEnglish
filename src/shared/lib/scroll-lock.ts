const locks = new WeakMap<HTMLElement, { count: number; previous: string }>();

export function lockBodyScroll(): () => void {
  const body = document.body;
  const lock = locks.get(body) ?? { count: 0, previous: body.style.overflow };
  lock.count += 1;
  locks.set(body, lock);
  body.style.overflow = 'hidden';
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    lock.count -= 1;
    if (lock.count) return;
    locks.delete(body);
    if (body.style.overflow === 'hidden') body.style.overflow = lock.previous;
  };
}
