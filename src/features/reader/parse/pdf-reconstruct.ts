/** One text run from a PDF page, in PDF user space (origin bottom-left, y grows upward). */
export type TextItem = { str: string; x: number; y: number; width: number; height: number };
type Line = { text: string; x: number; y: number; height: number };

function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Low percentile — a robust baseline line-pitch that paragraph gaps (the outliers) don't inflate. */
function lowPercentile(ns: number[], p = 0.3): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)]!;
}

/** Join a line's runs left-to-right, inserting a space only where there's a real horizontal gap. */
function toLine(items: TextItem[]): Line {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const h = median(items.map((i) => i.height)) || 10;
  let text = '';
  let prevEnd = -Infinity;
  for (const it of sorted) {
    if (text && it.x - prevEnd > h * 0.25 && !/\s$/.test(text) && !/^\s/.test(it.str)) {
      text += ' ';
    }
    text += it.str;
    prevEnd = it.x + it.width;
  }
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    x: sorted[0]?.x ?? 0,
    y: median(items.map((i) => i.y)),
    height: h,
  };
}

/** Cluster runs into lines by baseline (y), top of page first. */
export function groupLines(items: TextItem[], tol = 0.6): Line[] {
  const sorted = items
    .filter((i) => i.str !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  let cur: TextItem[] = [];
  let curY = Infinity;
  for (const it of sorted) {
    const h = it.height || 10;
    if (cur.length && Math.abs(it.y - curY) > h * tol) {
      lines.push(cur);
      cur = [];
    }
    if (cur.length === 0) curY = it.y;
    cur.push(it);
  }
  if (cur.length) lines.push(cur);
  return lines.map(toLine).filter((l) => l.text !== '');
}

const isPageNumber = (s: string) => /^[\s\-—–]*\d{1,4}[\s\-—–]*$/.test(s);
/** A run of dot leaders ("Chapter 1 . . . . 5") — an unmistakable table-of-contents/index line. */
const isLeaderLine = (s: string) => /(?:\.\s*){5,}/.test(s);
const normEdge = (s: string) => s.replace(/\d+/g, '#').trim().toLowerCase();

/** Drop page numbers and running headers/footers (edge lines repeated across many pages). */
export function stripRunningLines(pages: Line[][]): Line[][] {
  const n = pages.length;
  const dropAlways = (l: Line) => isPageNumber(l.text) || isLeaderLine(l.text);
  if (n < 3) {
    return pages.map((ls) => ls.filter((l) => !dropAlways(l)));
  }
  const freq = new Map<string, number>();
  for (const ls of pages) {
    if (ls.length === 0) continue;
    const edges = ls.length === 1 ? [ls[0]!] : [ls[0]!, ls[ls.length - 1]!];
    for (const l of edges) {
      const k = normEdge(l.text);
      if (k) freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(n * 0.4));
  const running = new Set(
    [...freq].filter(([, c]) => c >= threshold).map(([k]) => k)
  );
  return pages.map((ls) =>
    ls.filter((l, i) => {
      if (dropAlways(l)) return false;
      const edge = i === 0 || i === ls.length - 1;
      return !(edge && running.has(normEdge(l.text)));
    })
  );
}

const endsHyphen = (s: string) => /[A-Za-zА-Яа-яЁё]-$/.test(s);
const endsSentence = (s: string) => /[.!?…"»”)]$/.test(s);
const startsLower = (s: string) => /^[a-zа-яё]/.test(s);

function appendLine(buf: string, next: string): string {
  return endsHyphen(buf) ? buf.slice(0, -1) + next : buf + ' ' + next;
}

/** Group a page's lines into paragraphs by vertical gap; de-hyphenate line-break splits. */
export function linesToParagraphs(lines: Line[]): string[] {
  if (lines.length === 0) return [];
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    pitches.push(Math.abs(lines[i - 1]!.y - lines[i]!.y));
  }
  const pitch = lowPercentile(pitches) || lines[0]!.height * 1.2;
  const paras: string[] = [];
  let buf = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isBreak = i > 0 && Math.abs(lines[i - 1]!.y - line.y) > pitch * 1.6;
    if (isBreak && buf) {
      paras.push(buf.trim());
      buf = '';
    }
    buf = buf ? appendLine(buf, line.text) : line.text;
  }
  if (buf) paras.push(buf.trim());
  return paras;
}

/** Flatten pages into paragraphs, merging a paragraph that flows across a page break. */
export function assembleParagraphs(pageParas: string[][]): string[] {
  const out: string[] = [];
  for (const paras of pageParas) {
    paras.forEach((p, idx) => {
      const last = out[out.length - 1];
      const seam = idx === 0; // only a page's first paragraph can continue the previous page
      if (seam && last && !endsSentence(last) && startsLower(p)) {
        out[out.length - 1] = appendLine(last, p);
      } else {
        out.push(p);
      }
    });
  }
  return out;
}

/** Full text-layer reconstruction: page runs → lines → de-headered → paragraphs. */
export function reconstruct(pages: TextItem[][]): string[] {
  const lines = stripRunningLines(pages.map((p) => groupLines(p)));
  return assembleParagraphs(lines.map(linesToParagraphs));
}
