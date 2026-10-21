export type ReadingPosition = {
  version: 1;
  pageId: string;
  scrollY: number;
  word?: string;
  lineOffset?: number;
};

export function readReadingPosition(raw: string | null, pageId: string): ReadingPosition | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 ? { version: 1, pageId, scrollY: value } : null;
    }
    if (!value || typeof value !== 'object') return null;
    const p = value as Record<string, unknown>;
    if (p.version !== 1 || p.pageId !== pageId || typeof p.scrollY !== 'number' || !Number.isFinite(p.scrollY) || p.scrollY < 0) return null;
    const result: ReadingPosition = { version: 1, pageId, scrollY: p.scrollY };
    if (typeof p.word === 'string' && p.word.length < 60 && /^\d+:\d+:\d+$/.test(p.word) && typeof p.lineOffset === 'number' && Number.isFinite(p.lineOffset)) {
      result.word = p.word;
      result.lineOffset = Math.max(-4, Math.min(4, p.lineOffset));
    }
    return result;
  } catch { return null; }
}

function lineHeight(word: HTMLElement): number {
  const height = Number.parseFloat(getComputedStyle(word.closest('[data-para]') ?? word).lineHeight);
  return Number.isFinite(height) && height > 0 ? height : Math.max(1, word.getBoundingClientRect().height);
}

export function captureReadingPosition(root: HTMLElement, pageId: string): ReadingPosition {
  const result: ReadingPosition = { version: 1, pageId, scrollY: Math.max(0, window.scrollY) };
  const bounds = root.getBoundingClientRect();
  if (bounds.top > 0 || bounds.bottom <= 0) return result;
  for (const paragraph of root.querySelectorAll<HTMLElement>('[data-para]')) {
    const bounds = paragraph.getBoundingClientRect();
    if (bounds.bottom <= 0) continue;
    if (bounds.top >= window.innerHeight) break;
    const word = [...paragraph.querySelectorAll<HTMLElement>('[data-widx]')].find(w => {
      const r = w.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!word?.dataset.widx) continue;
    result.word = word.dataset.widx;
    result.lineOffset = Math.max(-4, Math.min(4, word.getBoundingClientRect().top / lineHeight(word)));
    break;
  }
  return result;
}

export function restoreReadingPosition(root: HTMLElement, position: ReadingPosition): void {
  const word = position.word ? root.querySelector<HTMLElement>(`[data-widx="${position.word}"]`) : null;
  const top = word && position.lineOffset !== undefined
    ? window.scrollY + word.getBoundingClientRect().top - position.lineOffset * lineHeight(word)
    : position.scrollY;
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}
